// ══════════════════════════════════════════════════════════════════
//  PARSE.JS
//  Everything that turns raw external data (Google Sheets CSV exports,
//  Clash Royale API JSON) into the structured state in state.js, plus
//  loadAll() — the top-level orchestrator that fetches from both
//  sources and kicks off the first render(). refreshAll() (the
//  "Refresh" button handler) lives in main.js and just calls loadAll()
//  again.
//
//  Load AFTER config.js/state.js. Load BEFORE main.js, since main.js's
//  bootstrap call at the bottom (loadAll()) must run last.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  LOADER UTILITIES
// ══════════════════════════════════════════════════════

// Update the loading bar and status message during data fetch
function setLoader(pct, msg) {
  document.getElementById('loader-bar').style.width = pct + '%';
  document.getElementById('loader-status').textContent = msg;
  updateLoaderCurtain(pct); // main.js -- sweeps the curtain to match real progress
}

// Fade out the loader overlay and reveal the app
function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('app').style.opacity = '1';
  // #loader's opacity transition (index.html) is 0.5s -- wait for it to
  // finish before showing the offline modal, so it appears once the app
  // is actually visible instead of popping in over the fading loader.
  if (!navigator.onLine) setTimeout(showOfflineModal, 500);
}

// ══════════════════════════════════════════════════════
//  CSV UTILITIES
// ══════════════════════════════════════════════════════

// Minimal CSV parser — handles quoted fields with commas inside.
// Returns a 2D array: rows[r][c] = string value.
function parseCSV(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

// Fetch and parse a CSV sheet URL.
// Returns null on network error or if Google returns an HTML error page.
async function fetchCSV(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const text = await resp.text();
    // Google Sheets returns an HTML error page when a sheet tab doesn't exist
    if (text.trim().startsWith('<')) return null;
    return parseCSV(text);
  } catch(e) {
    return null;
  }
}

// ══════════════════════════════════════════════════════
//  SHEET PARSERS / BUILDERS (v2 long-format schema)
//  Convert raw CSV 2D arrays into the structured state
//  (WARS, PLAYERS, WAR_STANDINGS, LIVE_SHEET_DATA) that
//  render() consumes — same shapes the old design used.
// ══════════════════════════════════════════════════════

// Strip Supercell color markup (<c6>name</c>) and trim. The API returns some
// names tagged, e.g. "<c6>Billitron" / "<c3>BabyJedi</c" — these must be cleaned
// or they silently break name-based matching between data sources.
function cleanName(name) {
  return String(name || '').replace(/<c\d+>/g, '').replace(/<\/c>?/g, '').trim();
}

// ── Parse WARS tab → ordered war registry ───────────────────────────────
// Columns: WAR_ID | CREATED_DATE | SEASON_ID | SECTION_INDEX | WAR_TYPE |
//          OUR_RANK | OUR_TROPHY_CHANGE | OUR_CLAN_FAME | FINALIZED_AT | SOURCE | NOTES
// Returns [{ id, label, warType, createdDate }] sorted by id ascending.
function parseWarsSheet(data) {
  if (!data || data.length < 2) return [];
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row[0] === '' || row[0] == null) continue;
    const id = parseInt(row[0]);
    if (isNaN(id)) continue;
    out.push({ id, label: 'War ' + id, warType: (row[4] || 'normal'), createdDate: row[1] || '' });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

// ── Pivot WAR_PLAYERS (long) → per-player score/deck arrays aligned to wars ──
// Columns: WAR_ID | PLAYER_TAG | PLAYER_NAME | FAME | DECKS_USED | BOAT_ATTACKS | SOURCE
// Keyed on PLAYER_TAG (stable across renames); display name = most-recent seen.
// A war's isAuto flag is set true iff ANY player has deck data for it (legacy
// migrated wars have no decks → isAuto=false → deck overlay shows "NA").
// Score semantics preserved from the old design: null = not in clan that war,
// 0 = in clan but played nothing.
function buildHistory(warsList, warPlayersData) {
  const warIndex = {};
  warsList.forEach((w, i) => { warIndex[w.id] = i; });
  const n = warsList.length;
  const warHasDecks = new Array(n).fill(false);
  const byKey = {};

  if (warPlayersData && warPlayersData.length > 1) {
    for (let r = 1; r < warPlayersData.length; r++) {
      const row = warPlayersData[r];
      if (!row || row[0] === '' || row[0] == null) continue;
      const warId = parseInt(row[0]);
      const col = warIndex[warId];
      if (col === undefined) continue;
      const tag = (row[1] || '').trim();
      const name = cleanName(row[2]);
      const fameRaw = row[3];
      const decksRaw = row[4];
      const fame = (fameRaw === '' || fameRaw == null) ? null : parseFloat(String(fameRaw).replace(/,/g, ''));
      const decks = (decksRaw === '' || decksRaw == null) ? null : parseInt(decksRaw);
      const key = tag || ('name:' + name.toLowerCase());
      if (!byKey[key]) byKey[key] = { name, tag, latestWar: -Infinity, scores: new Array(n).fill(null), decks: new Array(n).fill(null) };
      const rec = byKey[key];
      if (warId >= rec.latestWar) { rec.latestWar = warId; if (name) rec.name = name; }
      rec.scores[col] = (fame == null || isNaN(fame)) ? null : fame;
      if (decks != null && !isNaN(decks)) { rec.decks[col] = decks; warHasDecks[col] = true; }
    }
  }

  const wars = warsList.map((w, i) => ({ id: w.id, label: w.label, warType: w.warType, isAuto: warHasDecks[i], isLive: false }));
  const players = Object.keys(byKey).map(key => {
    const rec = byKey[key];
    return { name: rec.name, tag: rec.tag || '', pos: 'Member', scores: rec.scores, decks: rec.decks };
  });
  return { wars, players };
}

// ── Parse STANDINGS (v2 long) → { warId: [{clanTag,clanName,rank,trophyChange,fame,clanScore,isUs}] } ──
// Columns: WAR_ID | CLAN_TAG | CLAN_NAME | RANK | TROPHY_CHANGE | CLAN_FAME | CLAN_SCORE | IS_US | SOURCE
// NOTE: `fame` here is CLAN_FAME — boat-repair score on normal weeks, true fame on
// Colosseum weeks. It is used ONLY for placement/standings display, NEVER summed
// into the fame charts (those sum authoritative per-player WAR_PLAYERS fame).
function parseStandingsSheet(data) {
  if (!data || data.length < 2) return {};
  const result = {};
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row[0] === '' || row[0] == null) continue;
    const warId = String(parseInt(row[0]));
    if (warId === 'NaN') continue;
    const entry = {
      clanTag:      (row[1] || '').trim(),
      clanName:     cleanName(row[2]),
      rank:         parseInt(row[3]) || null,
      trophyChange: (row[4] === '' || row[4] == null) ? null : (parseInt(row[4]) || 0),
      fame:         parseInt(String(row[5] || '0').replace(/,/g, '')) || 0,
      clanScore:    parseInt(String(row[6] || '0').replace(/,/g, '')) || 0,
      isUs:         String(row[7] || '').trim().toUpperCase() === 'TRUE'
    };
    if (!result[warId]) result[warId] = [];
    result[warId].push(entry);
  }
  for (const w in result) result[w].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return result;
}

// Our clan's standings for a given war ID, or null.
function getOurStandingsForWar(warId) {
  const entries = WAR_STANDINGS[String(warId)];
  if (!entries) return null;
  return entries.find(e => e.isUs) || null;
}


// Our clan's standings for the most recent FINALIZED war (used on the Live page
// during training-day review, when the live API's clans[] has moved to the next race).
function getOurMostRecentStandings() {
  const finalizedWars = WARS.filter(w => !w.isLive);
  if (!finalizedWars.length) return null;
  const mostRecentFinalizedId = Math.max(...finalizedWars.map(w => w.id));
  const entry = getOurStandingsForWar(mostRecentFinalizedId);
  return entry ? { ...entry, warId: mostRecentFinalizedId } : null;
}

// ── Reconstruct LIVE_SHEET_DATA from SNAPSHOTS (v2 long) for the pending war ──
// Columns: TIMESTAMP | WAR_ID | PLAYER_TAG | PLAYER_NAME | CUM_FAME | CUM_DECKS |
//          DECKS_TODAY | BOAT_ATTACKS | PERIOD_INDEX | PERIOD_TYPE
// Produces the legacy contract the Live render expects, unchanged:
//   { lowerName: { name, days:[{decks,fame}×4], totalDecks, totalFame, counted } }
//   where days[d].decks = ISOLATED decks for war-day d (render sums them), and
//         days[d].fame  = CUMULATIVE fame THROUGH war-day d (render subtracts).
// War-days are grouped by PERIOD_INDEX (API increments it ~once/day); distinct
// periodIndexes sorted ascending → day 1..4. The end-of-day cumulative is the
// latest snapshot in each day bucket. `counted` implements the active-member
// rule for the avg-player metric: counted if present on day 1–2 OR any decks
// used; excluded only if first seen on day 3–4 with zero decks (locked-out late
// joiner). Falls back gracefully when snapshots are sparse.
function buildLiveFromSnapshots(data) {
  if (!data || data.length < 2) return {};
  const rows = [];
  const idsWithData = new Set();
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row[1] === '' || row[1] == null) continue;
    const warId = parseInt(row[1]);
    if (isNaN(warId)) continue;
    rows.push(row);
    // Real activity check for picking which war id to use, below.
    if ((parseFloat(row[4]) || 0) > 0 || (parseInt(row[5]) || 0) > 0) idsWithData.add(warId);
  }
  if (!rows.length) return {};
  // Use the highest war id that actually has real snapshot data, not just
  // the highest id present. The Apps Script starts writing snapshot rows
  // for the NEXT war's id the moment its training period begins -- before
  // any battle has happened, so every value is 0 -- so blindly taking the
  // max id can land on an all-zero "hasn't started yet" war and hide the
  // last real completed war's data during exactly the training-day gap
  // this fallback exists to cover.
  const candidateIds = idsWithData.size ? [...idsWithData] : rows.map(row => parseInt(row[1]));
  const pending = Math.max(...candidateIds);
  const live = rows.filter(row => parseInt(row[1]) === pending);
  if (!live.length) return {};

  // Exclude periods that are a "the previous war just ended" transition
  // blip, not a real war day. The Apps Script's own warActive check
  // (recordLiveSnapshot_) can be briefly fooled right when a war ends: the
  // live API sometimes still reports the OLD war's periodType/periodIndex
  // for one or two polls before it catches up to reporting "training",
  // so a couple of leftover snapshot rows can get written under the NEW
  // pending war's id with a period number that's numerically unrelated to
  // (and can sort after) the real Day 1/Day 2/etc. periods, corrupting the
  // day sequence. A period where every single row is 0 fame/0 decks AND
  // has only a handful of distinct snapshot timestamps is that blip, not
  // a genuine day -- a real day accumulates many snapshot cycles across
  // its ~24h span well before the war reaches its next day, so this can
  // never mistake a real, just-started day for one of these artifacts.
  const periodStats = {};
  for (const row of live) {
    const period = parseInt(row[8]);
    if (isNaN(period)) continue;
    if (!periodStats[period]) periodStats[period] = { hasRealData: false, timestamps: new Set() };
    periodStats[period].timestamps.add(String(row[0] || ''));
    if ((parseFloat(row[4]) || 0) > 0 || (parseInt(row[5]) || 0) > 0) periodStats[period].hasRealData = true;
  }
  const periods = Object.keys(periodStats)
    .map(Number)
    .filter(p => periodStats[p].hasRealData || periodStats[p].timestamps.size >= 5)
    .sort((a, b) => a - b);
  const dayOfPeriod = {};
  periods.forEach((p, i) => { dayOfPeriod[p] = Math.min(i, WAR_DAYS - 1); });

  const byKey = {};
  // Track: for each period, the latest snapshot (for the day it belongs to)
  // AND the earliest snapshot (used as prior-day truth if next period started).
  // Key insight: if a player's battles land in the gap between the last hourly
  // snapshot of Day N and the first snapshot of Day N+1, the cumulative values
  // will appear in the earliest Day N+1 snapshot — which correctly reflects
  // the true end-of-Day-N state.
  const earliestByPeriod = {}; // key -> period -> {ts, cumFame, cumDecks}
  for (const row of live) {
    const tag = (row[2] || '').trim();
    const name = cleanName(row[3]);
    const key = tag || ('name:' + name.toLowerCase());
    const period = parseInt(row[8]);
    const day = (dayOfPeriod[period] != null) ? dayOfPeriod[period] : null;
    if (day === null) continue;
    const ts = String(row[0] || '');
    const cumFame = parseFloat(row[4]) || 0;
    const cumDecks = parseInt(row[5]) || 0;
    if (!byKey[key]) byKey[key] = { name, perDay: {} };
    if (name) byKey[key].name = name;
    const pd = byKey[key].perDay;
    // Latest snapshot of this period's day = most complete same-day picture
    if (!pd[day] || ts > pd[day].ts) pd[day] = { ts, cumFame, cumDecks };
    // Earliest snapshot per period — used below to backfill prior day
    if (!earliestByPeriod[key]) earliestByPeriod[key] = {};
    if (!earliestByPeriod[key][period] || ts < earliestByPeriod[key][period].ts) {
      earliestByPeriod[key][period] = { ts, cumFame, cumDecks };
    }
  }

  // Precise backfill: handle players who were present during Day D (appeared
  // in snapshots with 0 decks) but played their battles in the final window
  // before the period rolled over — too late for any Day D snapshot to catch them.
  //
  // Condition: player WAS seen during Day D (has snapshots for that period)
  //            AND their latest Day D cumDecks == 0
  //            AND earliest Day D+1 snapshot shows cumDecks > 0
  //
  // This correctly backfills Rahul (24 Day1 snapshots all showing 0, then 4
  // decks at the first Day2 snapshot = played in the final gap before rollover).
  //
  // It correctly EXCLUDES:
  //   - 神ET米尼拥 (had Day1 snapshots with decks > 0 — those Day1 decks are real)
  //   - "ABL„Yosif (never appeared in Day1 snapshots at all — not in war Day1)
  //
  // Track whether each player was seen during each period (had any snapshot)
  const seenInPeriod = {}; // key -> Set of periods
  for (const row of live) {
    const tag = (row[2] || '').trim();
    const name = cleanName(row[3]);
    const key = tag || ('name:' + name.toLowerCase());
    const period = parseInt(row[8]);
    if (!seenInPeriod[key]) seenInPeriod[key] = new Set();
    seenInPeriod[key].add(period);
  }

  for (const key in byKey) {
    const pd = byKey[key].perDay;
    const ep = earliestByPeriod[key] || {};
    const seen = seenInPeriod[key] || new Set();
    for (let d = 0; d < WAR_DAYS - 1; d++) {
      const thisPeriod = periods[d];
      const nextPeriod  = periods[d + 1];
      if (thisPeriod == null || nextPeriod == null) continue;
      // Player must have been seen during Day D (i.e. was in the war that day)
      if (!seen.has(thisPeriod)) continue;
      // Their latest Day D snapshot must show 0 decks
      if (pd[d] && pd[d].cumDecks > 0) continue;
      // Earliest Day D+1 snapshot must show decks > 0
      const earliest = ep[nextPeriod];
      if (!earliest || earliest.cumDecks === 0) continue;
      // All conditions met: player was present in Day D, showed 0 decks all day,
      // then appeared with decks at Day D+1 start = played in the final gap.
      pd[d] = { ts: earliest.ts, cumFame: earliest.cumFame, cumDecks: earliest.cumDecks };
    }
  }

  const result = {};
  for (const key in byKey) {
    const rec = byKey[key];
    const days = [];
    let prevCumDecks = 0, lastCumFame = 0, lastCumDecks = 0, firstDay = null;
    for (let d = 0; d < WAR_DAYS; d++) {
      const end = rec.perDay[d];
      if (end) {
        if (firstDay === null) firstDay = d;
        days.push({ decks: Math.max(0, end.cumDecks - prevCumDecks), fame: end.cumFame });
        prevCumDecks = end.cumDecks;
        lastCumFame = end.cumFame;
        lastCumDecks = end.cumDecks;
      } else {
        days.push({ decks: 0, fame: lastCumFame }); // carry cumulative forward, 0 isolated
      }
    }
    const counted = (firstDay !== null && firstDay <= 1) || lastCumDecks > 0;
    result[(rec.name || key).toLowerCase()] = { name: rec.name, days, totalDecks: lastCumDecks, totalFame: lastCumFame, counted };
  }
  return result;
}

// ── Parse BATTLE_LOG → per-player day detail (current war) + all-time deck stats ──
// Columns: WAR_ID | PLAYER_TAG | PLAYER_NAME | DAY_INDEX | BATTLE_TIME |
//          BATTLE_TYPE | RESULT | CROWNS_FOR | CROWNS_AGAINST | DECK |
//          OPPONENT_CLAN_TAG | OPPONENT_CLAN_NAME
// Unlike SNAPSHOTS, this sheet is never pruned -- it holds every war ever
// recorded since this feature went live, specifically so deck performance
// can be tracked long-term. Returns TWO views over the same rows in one
// pass:
//   - byPlayerDay: scoped to just the CURRENT war (highest WAR_ID present --
//     same "pick the max id with real data" trick buildLiveFromSnapshots
//     uses for SNAPSHOTS; the Apps Script always writes both sheets under
//     the identical pendingWarId, so this stays aligned with whatever war
//     the Live tab is showing without cross-referencing the two). Powers
//     the per-day battle breakdown.
//   - byPlayerDeck: spans EVERY war recorded, grouped by unique deck
//     composition (card set, order-independent) per player. Powers the
//     aggregate Usage/Wins/Draws/Losses view -- deliberately not scoped to
//     "this war" since the whole point of never pruning this sheet is
//     long-term deck performance, and this should keep growing richer as
//     more wars accumulate rather than needing rework later.
// BASELINE_TYPE marker rows (the Apps Script's own no-backfill bookkeeping,
// DAY_INDEX 0) are real rows in the sheet but never real battles, so
// they're dropped from both views.
// River Race Duels play 2-3 games back-to-back, each consuming its OWN one
// of a player's 4 daily deck-uses (confirmed: a duel is never a single
// deck-use no matter how many games it takes). The Apps Script writes one
// row per game (sharing the same BATTLE_TIME) going forward, so each game
// is pushed as its own entry below, same as any normal battle. Rows
// recorded before that fix still have the whole duel merged into ONE row
// with a 16/24-card DECK cell (a real, confirmed Supercell API quirk on
// the old per-duel-not-per-game fetch) -- both views handle that legacy
// shape too by splitting it into 8-card chunks.
function parseBattleLogSheet(data) {
  if (!data || data.length < 2) return { byPlayerDay: {}, byPlayerDeck: {} };
  const rows = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row[0] === '' || row[0] == null) continue;
    const warId = parseInt(row[0]);
    if (isNaN(warId)) continue;
    rows.push({ warId, row });
  }
  if (!rows.length) return { byPlayerDay: {}, byPlayerDeck: {} };
  const maxWarId = Math.max(...rows.map(r => r.warId));

  const byPlayerDay = {};
  const byPlayerDeck = {};
  for (const { warId, row } of rows) {
    const battleType = row[5] || '';
    if (battleType === 'baseline') continue; // marker row, not a real battle

    const name = cleanName(row[2]);
    const key  = name.toLowerCase();
    // DECK cells look like "Skeletons:evo|Hunter|Royal Ghost:hero|..." --
    // ":evo"/":hero" is only present on a card actually equipped that way
    // in THIS battle (see the Apps Script's own comment on why that's not
    // the same as merely being evolution/champion-CAPABLE as a card).
    const deckStr = row[9] || '';
    const deck = deckStr ? deckStr.split('|').map(token => {
      const [cardName, special] = token.split(':');
      return { name: cardName, special: special || null };
    }) : [];
    const result = row[6] || '';
    // Parsed once, reused by both the current-war-only byPlayerDay block
    // below AND the all-time byPlayerDeck aggregation further down --
    // DAY_INDEX is a real column on every row, not just the current war's,
    // so the deck-history graph can plot real war-days from any war
    // BATTLE_LOG has ever recorded, not only the most recent one.
    const dayIndex = parseInt(row[3]);
    const hasValidDay = !isNaN(dayIndex) && dayIndex >= 1 && dayIndex <= WAR_DAYS;

    if (warId === maxWarId) {
      if (hasValidDay) {
        if (!byPlayerDay[key]) byPlayerDay[key] = { name, days: Array.from({ length: WAR_DAYS }, () => []) };
        if (name) byPlayerDay[key].name = name;
        // Each row is its OWN real deck-use/battle slot -- a River Race
        // Duel does NOT count as a single deck-use no matter how many
        // games it takes (confirmed: a player's 4 daily deck-uses can
        // split as e.g. 2 duel games + 2 normal battles, all 4 used).
        // Rows belonging to the same duel share one BATTLE_TIME (the Apps
        // Script writes them together) -- calcBattleDetail() (tab-live.js)
        // uses that to show "game N of the duel" context, but never to
        // collapse them into fewer slots than were actually played.
        byPlayerDay[key].days[dayIndex - 1].push({
          battleTime: row[4] || '',
          battleType, result,
          crownsFor: parseInt(row[7]) || 0,
          crownsAgainst: parseInt(row[8]) || 0,
          deck,
          opponentClanName: cleanName(row[11])
        });
      }
    }

    // River Race Duels ("riverRaceDuel") are logged by Supercell as ONE
    // battle-log entry covering all 2-3 games of the duel, but the API
    // concatenates every game's 8-card deck into a single flat cards list
    // instead of returning them per-game (confirmed against a live duel
    // entry -- a real API quirk, not a parsing bug here). Split back into
    // individual 8-card decks so each one is credited as its own deck
    // rather than one bogus 16/24-card "deck" that will never match a
    // real composition again. The overall result/crowns are for the whole
    // duel, not attributable to any one game, so merged-duel decks count
    // toward usage only -- never wins/draws/losses.
    const isMergedDuel = deck.length > 8 && deck.length % 8 === 0;
    const deckChunks = [];
    for (let c = 0; c < deck.length; c += 8) deckChunks.push(deck.slice(c, c + 8));
    for (const chunk of deckChunks) {
      if (!chunk.length) continue;
      // Canonical, order-independent identity for "the same deck" -- card
      // NAMES only (Supercell doesn't guarantee a stable card order per
      // battle), deliberately ignoring which slot was evolved. Which card
      // you choose to evolve is a real strategic choice, but treating
      // every evo variant as a genuinely different "deck" would fragment
      // usage/win-loss stats across near-duplicates instead of tracking
      // the actual 8-card composition's performance as a whole.
      const deckKey = chunk.map(c2 => c2.name).sort().join('|');
      if (!byPlayerDeck[key]) byPlayerDeck[key] = { name, decks: {} };
      if (name) byPlayerDeck[key].name = name;
      const decks = byPlayerDeck[key].decks;
      if (!decks[deckKey]) {
        decks[deckKey] = {
          cards: chunk, usage: 0, wins: 0, draws: 0, losses: 0,
          // crownsFor/crownsAgainst/crownedGames: same "merged rows aren't
          // attributable" rule as wins/draws/losses above -- a merged-duel
          // row's crowns are a duel-WIDE total, not this specific chunk's
          // own result, so only real single-game rows (a normal battle, or
          // a REAL per-game duel row) count toward either average.
          crownsFor: 0, crownsAgainst: 0, crownedGames: 0,
          // lastUsed: latest battleTime this exact deck was played, ACROSS
          // every usage including merged-duel chunks -- unlike wins/losses,
          // "was this deck played recently" is still a real, known fact
          // even for a chunk whose individual result isn't attributable.
          // Used for the deck history modal's "Active" sort mode.
          lastUsed: '',
          // byDay: per-real-war-day {warId, dayIndex, wins, draws, losses,
          // usage} -- powers the deck history modal's win-rate-over-time
          // graph, keyed by "warId_dayIndex" so it can span every war
          // BATTLE_LOG has ever recorded, not just the current one.
          // Flattened to a chronologically-sorted array (dayHistory) once
          // every row's been seen, below -- days the deck wasn't used
          // simply never get an entry, so the graph naturally skips gaps
          // (a training week, a war with no duel, etc.) instead of the
          // trend line flattening across them.
          byDay: {}
        };
      }
      const d = decks[deckKey];
      d.usage++;
      if (row[4] && row[4] > d.lastUsed) d.lastUsed = row[4];
      let dayEntry = null;
      if (hasValidDay) {
        const dayKey = warId + '_' + dayIndex;
        if (!d.byDay[dayKey]) d.byDay[dayKey] = { warId, dayIndex, wins: 0, draws: 0, losses: 0, usage: 0 };
        dayEntry = d.byDay[dayKey];
        dayEntry.usage++;
      }
      if (!isMergedDuel) {
        if (result === 'win') { d.wins++; if (dayEntry) dayEntry.wins++; }
        else if (result === 'loss') { d.losses++; if (dayEntry) dayEntry.losses++; }
        else if (result === 'draw') { d.draws++; if (dayEntry) dayEntry.draws++; }
        const crownsFor = parseInt(row[7]);
        const crownsAgainst = parseInt(row[8]);
        if (!isNaN(crownsFor) && !isNaN(crownsAgainst)) {
          d.crownsFor += crownsFor; d.crownsAgainst += crownsAgainst; d.crownedGames++;
        }
      }
    }
  }

  // Oldest-first within each day, matching real deck-slot order.
  for (const key in byPlayerDay) {
    byPlayerDay[key].days.forEach(day => day.sort((a, b) => a.battleTime.localeCompare(b.battleTime)));
  }
  // Flatten each player's deck map to an array, most-used first, and each
  // deck's byDay map to a chronologically-sorted array (dayHistory) for
  // the win-rate-over-time graph.
  for (const key in byPlayerDeck) {
    const decks = Object.values(byPlayerDeck[key].decks);
    decks.forEach(d => {
      d.dayHistory = Object.values(d.byDay).sort((a, b) => a.warId - b.warId || a.dayIndex - b.dayIndex);
      delete d.byDay;
    });
    byPlayerDeck[key].decks = decks.sort((a, b) => b.usage - a.usage);
  }

  return { byPlayerDay, byPlayerDeck };
}

// ── Append a live in-progress war column from the CR API (LIVE_DATA) ──────
// Mirrors the old WAR_N_LIVE column: always added when a war is active; the
// "include live" toggle controls visibility via effectiveWars() filtering isLive.
function appendLiveColumn() {
  const hasLive = Object.values(LIVE_DATA).some(p => (p.fame || 0) > 0 || (p.decksUsed || 0) > 0);
  if (!hasLive) return;
  const pendingId = (WARS.length ? Math.max(...WARS.map(w => w.id)) : 0) + 1;
  WARS.push({ id: pendingId, label: 'Live', warType: 'normal', isAuto: true, isLive: true });
  const col = WARS.length - 1;
  PLAYERS.forEach(p => { p.scores.push(null); p.decks.push(null); });
  const byName = {};
  PLAYERS.forEach(p => { byName[p.name.toLowerCase()] = p; });
  for (const k in LIVE_DATA) {
    const ld = LIVE_DATA[k];
    const nm = cleanName(ld.name);
    let p = byName[nm.toLowerCase()];
    if (!p) {
      p = { name: nm, tag: ld.tag || '', pos: 'Member', scores: new Array(col + 1).fill(null), decks: new Array(col + 1).fill(null) };
      PLAYERS.push(p);
      byName[nm.toLowerCase()] = p;
    }
    // Only assign a score if the player actually participated.
    // Non-participants (fame=0, decksUsed=0) stay null (shows as ·, not ✗).
    // A red ✗ means "was in clan, scored zero" — which shouldn't happen mid-war
    // for players who simply haven't been assigned yet.
    const participated = (ld.fame || 0) > 0 || (ld.decksUsed || 0) > 0;
    p.scores[col] = participated ? (ld.fame || 0) : null;
    p.decks[col]  = participated ? (ld.decksUsed || 0) : null;
  }
}

// ══════════════════════════════════════════════════════
//  CR API — fetch + parse Clash Royale clan data
// ══════════════════════════════════════════════════════

// Current clan member roles keyed by lowercase player name.
// Populated on each load/refresh from the CR API members endpoint.
let LIVE_ROLES = {};

// Fetch clan members (for current roles) and the live river race (for fame/decks)
// in parallel via the CF Worker proxy.
async function fetchClanData() {
  const tag = encodeURIComponent('#' + CLAN_TAG);
  const [membersResp, raceResp] = await Promise.all([
    fetch(`${CR_PROXY}/clans/${tag}/members`),
    fetch(`${CR_PROXY}/clans/${tag}/currentriverrace`)
  ]);
  const members = membersResp.ok ? await membersResp.json() : null;
  const race    = raceResp.ok    ? await raceResp.json()    : null;
  return { members, race };
}

// Clan war-trophy rank, US/home-country and world -- powers the two
// ranking header banners (replaced the old Total Wars/Active/Best Avg/Clan
// Avg banners, which moved to the Data tab's clan summary row instead).
// Cached in localStorage for 24h: each rankings list is a ~200KB JSON array
// of ~999 clans that only meaningfully changes about once a day, so
// refetching it on every single page load/refresh would be wasteful.
async function fetchClanRankings() {
  const CACHE_KEY = 'uc-rank-cache';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) return cached.data;
  } catch(e) {}

  const tag = encodeURIComponent('#' + CLAN_TAG);
  const clanResp = await fetch(`${CR_PROXY}/clans/${tag}`);
  if (!clanResp.ok) return { usRank: null, worldRank: null };
  const clan = await clanResp.json();
  const homeLocationId = clan?.location?.id;

  const findRank = json => {
    const entry = json?.items?.find(c => c.tag === ('#' + CLAN_TAG));
    return entry ? entry.rank : null;
  };

  const [homeResp, worldResp] = await Promise.all([
    homeLocationId ? fetch(`${CR_PROXY}/locations/${homeLocationId}/rankings/clanwars`) : Promise.resolve(null),
    fetch(`${CR_PROXY}/locations/${WORLD_LOCATION_ID}/rankings/clanwars`)
  ]);
  const homeJson  = homeResp?.ok  ? await homeResp.json()  : null;
  const worldJson = worldResp?.ok ? await worldResp.json() : null;

  const data = { usRank: homeJson ? findRank(homeJson) : null, worldRank: findRank(worldJson) };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
  return data;
}

// Convert the CR API members list into a { lowercaseName → displayRole } map.
function parseClanMembers(json) {
  const roleMap = { 'leader': 'Leader', 'coLeader': 'Co-leader', 'elder': 'Elder', 'member': 'Member' };
  const result = {};
  if (!json?.items) return result;
  for (const m of json.items) {
    const key = cleanName(m.name).toLowerCase();
    result[key] = roleMap[m.role] || 'Member';
  }
  return result;
}

// Convert the currentriverrace response into LIVE_DATA and populate LIVE_PARTICIPANTS.
// Each entry: { fame (cumulative), decksUsed (total war), decksUsedToday, tag, name }
function parseLiveWar(json) {
  const result = {};
  LIVE_PARTICIPANTS.clear();
  if (!json?.clan?.participants) return result;
  for (const p of json.clan.participants) {
    const nm  = cleanName(p.name);
    const key = nm.toLowerCase();
    result[key] = {
      fame:           p.fame           || 0,
      decksUsed:      p.decksUsed      || 0,
      decksUsedToday: p.decksUsedToday || 0,
      tag:  p.tag,
      name: nm
    };
    LIVE_PARTICIPANTS.add(key);
  }
  return result;
}

// Extract all clans competing in this week's river race (including us), sorted by
// fame descending. Used to compute our current placement/rank in the war.
// Each entry: { tag, name, fame, clanScore }
function parseRaceClans(json) {
  if (!json?.clans || !Array.isArray(json.clans)) return [];
  return [...json.clans]
    .map(c => ({ tag: c.tag, name: cleanName(c.name), fame: c.fame || 0, clanScore: c.clanScore || 0 }))
    .sort((a, b) => b.fame - a.fame);
}

// Returns our clan's 1-indexed rank (1st-5th) in the current river race, or null
// if race data isn't available.
function getOurRank() {
  if (!LIVE_RACE_CLANS.length) return null;
  const idx = LIVE_RACE_CLANS.findIndex(c => c.tag === ('#' + CLAN_TAG));
  return idx === -1 ? null : idx + 1;
}

// ══════════════════════════════════════════════════════
//  CARD ART PREFETCH
//  Warms the service worker's cache for every card-art image up front,
//  once, shortly after the app finishes its own critical load -- so by
//  the time a user opens their first battle-detail deck popup (Live tab),
//  every image it needs is already cached instead of being fetched cold
//  at that moment. service-worker.js's cacheFirst() handler already
//  caches assets/cards/* the first time each is requested; this just
//  moves "the first time" earlier, off the critical path, rather than
//  changing HOW caching works. A card/evo image already cached from a
//  prior visit resolves instantly here (cacheFirst checks the cache
//  before ever touching the network), so this is cheap on repeat visits.
// ══════════════════════════════════════════════════════
let cardArtPrefetched = false;
function prefetchCardArt() {
  if (cardArtPrefetched) return; // once per page load is enough -- CACHE_NAME only changes on a real deploy
  cardArtPrefetched = true;

  const urls = ALL_CARD_SLUGS.map(s => `assets/cards/${s}.png`)
    .concat(EVO_CARD_SLUGS.map(s => `assets/cards/evo/${s}.png`))
    .concat(['assets/crowns/blue.png', 'assets/crowns/red.png']);

  // Fetched in small sequential batches, not all ~150 at once -- this is
  // pure background prefetch with nothing waiting on it, so there's no
  // reason to compete for a mobile connection's limited concurrent
  // connections against anything the user is actually doing right now.
  // Any single image failing (offline mid-prefetch, one bad file) is
  // swallowed and simply skipped -- this is best-effort warmup, never a
  // blocking or required step.
  const BATCH_SIZE = 8;
  let i = 0;
  function nextBatch() {
    if (i >= urls.length) return;
    const batch = urls.slice(i, i + BATCH_SIZE);
    i += BATCH_SIZE;
    Promise.allSettled(batch.map(u => fetch(u))).then(() => {
      if (i < urls.length) setTimeout(nextBatch, 150);
    });
  }
  nextBatch();
}

// Runs prefetchCardArt() once the browser is idle (or after a fallback
// delay if requestIdleCallback isn't supported), so it never competes
// with the initial data fetch/render for bandwidth or main-thread time.
function scheduleCardArtPrefetch() {
  if ('requestIdleCallback' in window) requestIdleCallback(prefetchCardArt, { timeout: 5000 });
  else setTimeout(prefetchCardArt, 2000);
}

// ══════════════════════════════════════════════════════
//  LOAD
// ══════════════════════════════════════════════════════
async function loadAll(showLoader = true) {
  // Tracks whether this call actually pulled fresh data, so lastDataUpdate
  // only advances on a genuine fetch — not on a service-worker cache
  // fallback served while offline (see the two try blocks below).
  let sheetFetchOk = false;
  let apiFetchOk   = false;

  // 1. Sheets (v2 long-format schema: WARS / WAR_PLAYERS / STANDINGS / SNAPSHOTS)
  try {
    setLoader(20, 'FETCHING WAR RECORDS...');
    const [warsCSV, warPlayersCSV, standingsCSV, snapshotsCSV, swappersCSV, battleLogCSV] = await Promise.all([
      fetchCSV(WARS_URL), fetchCSV(WAR_PLAYERS_URL), fetchCSV(STANDINGS_URL), fetchCSV(SNAPSHOTS_URL),
      fetchCSV(SWAPPERS_URL).catch(() => null),  // graceful — tab may not exist yet
      fetchCSV(BATTLE_LOG_URL).catch(() => null) // graceful — same reason, newer sheet
    ]);
    if (!warsCSV) throw new Error('WARS sheet returned no data');
    const warsList = parseWarsSheet(warsCSV);
    const hist = buildHistory(warsList, warPlayersCSV || []);
    WARS    = hist.wars;
    PLAYERS = hist.players;
    LIVE_SHEET_DATA = snapshotsCSV ? buildLiveFromSnapshots(snapshotsCSV) : {};
    WAR_STANDINGS   = standingsCSV ? parseStandingsSheet(standingsCSV) : {};
    const battleLogParsed = battleLogCSV ? parseBattleLogSheet(battleLogCSV) : { byPlayerDay: {}, byPlayerDeck: {} };
    BATTLE_LOG  = battleLogParsed.byPlayerDay;
    DECK_STATS  = battleLogParsed.byPlayerDeck;
    // Parse swapper overrides — one player name per row, first column
    SWAPPER_NAMES = new Set();
    if (swappersCSV && swappersCSV.length > 1) {
      swappersCSV.slice(1).forEach(row => {
        const name = (row[0] || '').trim().toLowerCase();
        if (name) SWAPPER_NAMES.add(name);
      });
    }

    ALL_SCORES_FLAT.length = 0;
    PLAYERS.forEach(p => p.scores.forEach(s => { if (s !== null && s > 0) ALL_SCORES_FLAT.push(s); }));

    sheetFetchOk = true;
    document.getElementById('st-sheet').className = 's-ok';
    document.getElementById('st-sheet').textContent = `${WARS.length} wars — ${PLAYERS.length} players`;
  } catch(e) {
    document.getElementById('st-sheet').className = 's-err';
    document.getElementById('st-sheet').textContent = 'Sheet error: ' + e.message;
    console.error(e);
  }

  // 2. CR API — clan members (roles) + live war (fame)
  setLoader(60, 'CONNECTING TO CLASH ROYALE API...');
  try {
    const { members, race } = await fetchClanData();
    LIVE_ROLES = members ? parseClanMembers(members) : {};
    LIVE_DATA  = race    ? parseLiveWar(race)         : {};
    LIVE_RACE_CLANS = race ? parseRaceClans(race) : [];

    // Append the live in-progress war as a column (visibility gated by the
    // "include live" toggle via effectiveWars()). Must run after PLAYERS/WARS
    // are built and LIVE_DATA is populated.
    appendLiveColumn();

    // Overwrite positions for current clan members
    for (const p of PLAYERS) {
      const key = p.name.toLowerCase().trim();
      if (LIVE_ROLES[key]) p.pos = LIVE_ROLES[key];
      // Swapper override: always applied after API role assignment
      if (SWAPPER_NAMES.has(key)) p.pos = 'Swapper';
    }

    apiFetchOk = true;
    const roleCount = Object.keys(LIVE_ROLES).length;
    const fameCount = Object.keys(LIVE_DATA).length;
    document.getElementById('st-api').className = 's-ok';
    document.getElementById('st-api').textContent = `${roleCount} members synced — ${fameCount} in live war`;
  } catch(e) {
    LIVE_DATA  = {};
    LIVE_ROLES = {};
    document.getElementById('st-api').className = 's-err';
    document.getElementById('st-api').textContent = 'CR API unavailable';
    console.warn('CR API:', e);
  }

  // navigator.onLine is false the moment the device has no active network
  // interface at all (airplane mode, wifi+cell both off) -- exactly the
  // offline case that must NOT advance the timestamp. It can still read true
  // on a connected-but-no-internet network, but that's not the scenario here:
  // without it, a networkFirst() fetch served from the service-worker's cache
  // fallback resolves as a normal successful Response with no exception, so
  // sheetFetchOk/apiFetchOk alone can't tell "fresh network data" apart from
  // "SW quietly handed back what it cached last time".
  if (navigator.onLine && (sheetFetchOk || apiFetchOk)) {
    lastDataUpdate = new Date();
  }

  // 3. Clan war-trophy rankings (US/home-country + world) -- own try/catch,
  // never blocks the rest of the app if the rankings lists are slow/down.
  setLoader(80, 'FETCHING CLAN RANKINGS...');
  try {
    CLAN_RANKINGS = await fetchClanRankings();
  } catch(e) {
    CLAN_RANKINGS = { usRank: null, worldRank: null };
    console.warn('Clan rankings:', e);
  }

  setLoader(90, 'RENDERING...');
  try {
    render();
  } catch(e) {
    console.error('render() threw:', e);
    setLoader(100, 'ERROR: ' + e.message);
    const main = document.getElementById('main');
    if (main) main.innerHTML =
      `<div style="padding:40px;font-family:monospace;color:#e05252;font-size:13px">
        <b>Render error:</b> ${e.message}<br><br>
        <pre style="white-space:pre-wrap;font-size:11px;color:#aab3c4">${e.stack}</pre>
      </div>`;
    hideLoader();
    return;
  }
  setLoader(100, 'READY');
  if (showLoader) setTimeout(hideLoader, 400);
  scheduleCardArtPrefetch();
}

