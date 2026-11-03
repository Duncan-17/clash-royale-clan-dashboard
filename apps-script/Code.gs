// ════════════════════════════════════════════════════════════════
//  United Clash — Google Apps Script (Code.gs)
//  Runs hourly to track war data → LIVE sheet, AUTO sheet.
// ════════════════════════════════════════════════════════════════

const CLAN_TAG    = 'P0Q2Y8UG';
const API_KEY     = 'YOUR_API_KEY_HERE'; // paste your JWT here
const PROXY       = 'https://proxy.royaleapi.dev/v1';

// Highest war number in the RAW sheet. AUTO wars continue from RAW_LAST_WAR + 1.
const RAW_LAST_WAR = 23;

// ── ENTRY POINT ────────────────────────────────────────────────
// Called every hour via trigger. Routes to the correct handler
// based on the current river race state.
function fetchWarData() {
  const tag = encodeURIComponent('#' + CLAN_TAG);
  const resp = UrlFetchApp.fetch(`${PROXY}/clans/${tag}/currentriverrace`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    console.log('API error ' + resp.getResponseCode() + ': ' + resp.getContentText());
    return;
  }

  const race        = JSON.parse(resp.getContentText());
  const participants = race.clan.participants;
  const periodIndex  = race.periodIndex;
  const state        = race.state;

  console.log(`State: ${state} | Period: ${periodIndex} | Players: ${participants.length}`);

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const autoSheet = ss.getSheetByName('AUTO');
  const liveSheet = getOrCreateSheet(ss, 'LIVE');

  // "War is active" = either official warDay state, or players already have fame
  // (handles edge case where state briefly reports 'full' mid-war).
  const warIsActive = state === 'warDay' ||
    (state === 'full' && participants.some(p => (p.fame || 0) > 0));

  if (warIsActive) {
    updateLiveTracking(liveSheet, autoSheet, participants, periodIndex);
  } else if (state === 'ended') {
    finalizeWar(autoSheet, liveSheet, participants);
  } else {
    console.log('No active war — training / preparation day, skipping.');
  }
}

// ── SHEET HELPER ───────────────────────────────────────────────
function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ── WAR-WEEK IDENTIFICATION ────────────────────────────────────
//
// IMPORTANT: The CR API periodIndex increments once per war DAY,
// not once per war week. A 4-day war produces periodIndexes 10, 11, 12, 13.
//
// We compute a stable "war start period" (the periodIndex on Day 1) so
// that all four days of a war map to the same identity:
//
//   warStartPeriod = periodIndex − (currentDay − 1)
//   Day 1: 10−0=10  Day 2: 11−1=10  Day 3: 12−2=10  Day 4: 13−3=10
//
// This lets us detect "new war week" correctly and keeps a single
// WAR_N_LIVE column in AUTO throughout the war (instead of four).

// Called on each warDay run. Sets/reads the stable war-week identifier
// and returns whether this is a genuinely new war (→ wipe LIVE sheet).
function resolveWarWeek(periodIndex, currentDay) {
  const props = PropertiesService.getScriptProperties();
  const storedStart = props.getProperty('warStartPeriod');
  const estimatedStart = periodIndex - (currentDay - 1);

  let warStartPeriod;
  let isNewWar = false;

  if (currentDay === 1) {
    // On Day 1 the current periodIndex IS the war start — authoritative.
    warStartPeriod = periodIndex;
    if (storedStart && parseInt(storedStart) !== periodIndex) {
      isNewWar = true; // Previous war had a different start period.
    }
    props.setProperty('warStartPeriod', periodIndex.toString());
  } else if (storedStart) {
    // Days 2–4: use the value stored on Day 1 — do NOT re-estimate.
    warStartPeriod = parseInt(storedStart);
  } else {
    // Missed Day 1 — estimate and store (works because periodIndex increments daily).
    warStartPeriod = estimatedStart;
    props.setProperty('warStartPeriod', warStartPeriod.toString());
  }

  return { warStartPeriod, isNewWar };
}

// Returns the sequential war number (24, 25, 26 …) for a given war-start period.
// Assigns a new number on first encounter and persists it in Script Properties.
function getWarNumber(autoSheet, warStartPeriod) {
  const props = PropertiesService.getScriptProperties();
  const key   = `warNum_${warStartPeriod}`;
  const stored = props.getProperty(key);
  if (stored) return parseInt(stored);

  // Count existing finalized WAR_N columns to find the next number.
  const lastCol = autoSheet.getLastColumn();
  let maxWarNum = RAW_LAST_WAR;
  if (lastCol >= 2) {
    const headers = autoSheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (const h of headers) {
      const m = String(h).match(/^WAR_(\d+)(?:_DECKS)?$/);
      if (m) maxWarNum = Math.max(maxWarNum, parseInt(m[1]));
    }
  }
  const warNum = maxWarNum + 1;
  props.setProperty(key, warNum.toString());
  console.log(`Assigned WAR_${warNum} to war starting at period ${warStartPeriod}`);
  return warNum;
}

// ── DAY DETECTION ──────────────────────────────────────────────
// Uses decksUsedToday to distinguish "playing today" vs "day just rolled over".
// See CLAUDE.md — decksUsedToday resets to 0 at midnight, which previously
// caused the Day 1 zeroing bug.
function detectWarDay(participants) {
  const anyPlayingToday = participants.some(p => (p.decksUsedToday || 0) > 0);
  const maxDecksUsed    = Math.max(...participants.map(p => p.decksUsed || 0));

  if (maxDecksUsed === 0) return 1; // War just started, no decks used yet.

  if (anyPlayingToday) {
    // Someone has played today — total decks across the war tell us the day.
    return Math.min(Math.ceil(maxDecksUsed / 4), 4);
  } else {
    // Day just rolled over — decksUsedToday reset to 0 at midnight.
    // Move to next day based on completed days.
    const completedDay = Math.min(Math.floor(maxDecksUsed / 4), 4);
    return Math.min(completedDay + 1, 4);
  }
}

// ── LIVE SHEET TRACKING ────────────────────────────────────────
// Called every hour during war days. Writes per-day data to LIVE sheet
// and keeps a single mid-war snapshot column in AUTO.
//
// LIVE sheet fame columns store CUMULATIVE totals (running sum through
// the end of each day). The dashboard derives per-day isolated values
// by subtracting the previous day's cumulative. Cumulative storage is
// more resilient: a missed hourly run can't corrupt past-day totals.
function updateLiveTracking(liveSheet, autoSheet, participants, periodIndex) {
  const currentDay                = detectWarDay(participants);
  const { warStartPeriod, isNewWar } = resolveWarWeek(periodIndex, currentDay);
  const warNum                    = getWarNumber(autoSheet, warStartPeriod);

  console.log(`Day ${currentDay} | WAR_${warNum} | warStartPeriod=${warStartPeriod}${isNewWar ? ' [NEW WAR]' : ''}`);

  // Wipe LIVE sheet only when a new war week is detected — NOT on each new day.
  if (isNewWar) {
    console.log('New war detected — clearing LIVE sheet.');
    liveSheet.clearContents();
  }

  ensureLiveHeaders(liveSheet);

  // Read existing LIVE data so we never touch past-day columns.
  const lastRow   = liveSheet.getLastRow();
  const nameList  = lastRow > 1
    ? liveSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(n => String(n).trim())
    : [];
  let nextRow = lastRow + 1;

  // Column positions: PLAYER(1) | DAY1_DECKS(2) DAY1_FAME(3) | DAY2_DECKS(4) … | TOTAL_DECKS(10) TOTAL_FAME(11)
  const dayDecksCol = 2 + (currentDay - 1) * 2;
  const dayFameCol  = 3 + (currentDay - 1) * 2;

  for (const p of participants) {
    let rowIdx = nameList.indexOf(p.name);
    let row;
    if (rowIdx === -1) {
      row = nextRow++;
      liveSheet.getRange(row, 1).setValue(p.name);
      nameList.push(p.name);
    } else {
      row = rowIdx + 2;
    }

    // Store today's battles (API gives today-only count — already isolated).
    liveSheet.getRange(row, dayDecksCol).setValue(p.decksUsedToday || 0);

    // Store CUMULATIVE fame through today (not just today's contribution).
    // The dashboard subtracts the previous day's cumulative to isolate each day.
    liveSheet.getRange(row, dayFameCol).setValue(p.fame || 0);

    // Running totals — always the latest API values.
    liveSheet.getRange(row, 10).setValue(p.decksUsed || 0);
    liveSheet.getRange(row, 11).setValue(p.fame || 0);
  }

  // Keep a single mid-war snapshot column in AUTO for the Data-mode "Live" toggle.
  updateLiveSnapshot(autoSheet, participants, warNum);
  console.log(`LIVE updated — ${participants.length} players, day ${currentDay}, WAR_${warNum}`);
}

// ── AUTO SHEET LIVE SNAPSHOT ───────────────────────────────────
// Writes/updates a single WAR_N_LIVE column in AUTO with each player's
// current cumulative fame. Replaced by WAR_N when the war finalizes.
function updateLiveSnapshot(autoSheet, participants, warNum) {
  const colHeader = `WAR_${warNum}_LIVE`;
  ensureAutoHeaders(autoSheet);

  const lastCol = autoSheet.getLastColumn();
  const headers = lastCol > 0 ? autoSheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  let col = headers.indexOf(colHeader) + 1;
  if (col === 0) {
    col = lastCol + 1;
    autoSheet.getRange(1, col).setValue(colHeader);
  }

  let lastRow = autoSheet.getLastRow();
  for (const p of participants) {
    const row = getOrAddPlayerRow(autoSheet, p.name, lastRow);
    if (row > lastRow) lastRow = row;
    autoSheet.getRange(row, 2).setValue(new Date().toLocaleDateString());
    autoSheet.getRange(row, col).setValue(p.fame || 0);
  }
}

// ── WAR FINALIZATION ───────────────────────────────────────────
// Runs when state = 'ended'. Appends WAR_N (total fame) and WAR_N_DECKS
// (total battles) to AUTO, removes ALL orphaned _LIVE columns (there can
// be up to four from the daily periodIndex incrementing), then clears
// the LIVE sheet for the next war.
function finalizeWar(autoSheet, liveSheet, participants) {
  const props = PropertiesService.getScriptProperties();

  // Use the warStartPeriod stored during daily tracking.
  const storedStart = props.getProperty('warStartPeriod');
  if (!storedStart) {
    console.log('No warStartPeriod stored — cannot finalize safely. Run will retry next hour.');
    return;
  }
  const warNum         = getWarNumber(autoSheet, parseInt(storedStart));
  const warColHeader   = `WAR_${warNum}`;
  const decksColHeader = `WAR_${warNum}_DECKS`;

  ensureAutoHeaders(autoSheet);

  // Guard against double-finalization.
  const lastCol = autoSheet.getLastColumn();
  const headers = lastCol > 0 ? autoSheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (headers.includes(warColHeader)) {
    console.log(`${warColHeader} already finalized — skipping.`);
    return;
  }

  // Remove ALL _LIVE columns. Because periodIndex increments daily, there may be
  // up to four orphaned _LIVE columns (WAR_N_LIVE was written each day but only
  // ONE of those column names is correct — it doesn't matter, remove them all).
  const finalHeaders = autoSheet.getRange(1, 1, 1, autoSheet.getLastColumn()).getValues()[0];
  for (let c = finalHeaders.length - 1; c >= 0; c--) {
    if (String(finalHeaders[c]).endsWith('_LIVE')) {
      autoSheet.deleteColumn(c + 1);
      console.log(`Removed _LIVE column: ${finalHeaders[c]}`);
    }
  }

  // Append WAR_N (total fame) and WAR_N_DECKS (battles out of 16).
  const newLastCol = autoSheet.getLastColumn();
  const fameCol    = newLastCol + 1;
  const decksCol   = newLastCol + 2;
  autoSheet.getRange(1, fameCol).setValue(warColHeader);
  autoSheet.getRange(1, decksCol).setValue(decksColHeader);

  let lastRow = autoSheet.getLastRow();
  for (const p of participants) {
    const row = getOrAddPlayerRow(autoSheet, p.name, lastRow);
    if (row > lastRow) lastRow = row;
    autoSheet.getRange(row, 2).setValue(new Date().toLocaleDateString());
    autoSheet.getRange(row, fameCol).setValue(p.fame || 0);
    autoSheet.getRange(row, decksCol).setValue(p.decksUsed || 0);
  }

  // Clear LIVE sheet — the war is over.
  liveSheet.clearContents();
  // Clear the stored warStartPeriod so next war gets a fresh assignment.
  props.deleteProperty('warStartPeriod');

  console.log(`WAR_${warNum} finalized — ${participants.length} players. LIVE sheet cleared.`);
}

// ── ONE-TIME CLEANUP ───────────────────────────────────────────
// Run this ONCE manually to remove the orphaned _LIVE columns
// that accumulated from this past war. Going forward, finalizeWar
// handles cleanup automatically.
function cleanupOrphanedLiveColumns() {
  const autoSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AUTO');
  const lastCol   = autoSheet.getLastColumn();
  if (lastCol < 1) return;
  const headers = autoSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let removed = 0;
  for (let c = headers.length - 1; c >= 0; c--) {
    if (String(headers[c]).endsWith('_LIVE')) {
      autoSheet.deleteColumn(c + 1);
      console.log(`Removed: ${headers[c]}`);
      removed++;
    }
  }
  console.log(`Done — removed ${removed} orphaned _LIVE column(s).`);
}

// ── SHEET STRUCTURE HELPERS ────────────────────────────────────
function ensureLiveHeaders(sheet) {
  if (sheet.getLastRow() > 0 && sheet.getRange(1, 1).getValue() === 'PLAYER') return;
  const headers = [
    'PLAYER',
    'DAY1_DECKS', 'DAY1_FAME',
    'DAY2_DECKS', 'DAY2_FAME',
    'DAY3_DECKS', 'DAY3_FAME',
    'DAY4_DECKS', 'DAY4_FAME',
    'TOTAL_DECKS', 'TOTAL_FAME'
  ];
  headers.forEach((h, i) => sheet.getRange(1, i + 1).setValue(h));
}

function ensureAutoHeaders(sheet) {
  if (sheet.getLastRow() > 0 && sheet.getRange(1, 1).getValue() === 'PLAYER') return;
  sheet.getRange(1, 1).setValue('PLAYER');
  sheet.getRange(1, 2).setValue('LAST_SEEN');
}

// Returns the row number for a player, adding a new row if not found.
function getOrAddPlayerRow(sheet, name, lastRow) {
  if (lastRow >= 2) {
    const players = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const idx = players.indexOf(name);
    if (idx !== -1) return idx + 2;
  }
  const newRow = lastRow + 1;
  sheet.getRange(newRow, 1).setValue(name);
  return newRow;
}
