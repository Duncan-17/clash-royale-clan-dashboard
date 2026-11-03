// ══════════════════════════════════════════════════════════════════
//  TAB-LIVE.JS
//  The "Live" tab: active-war tracker (4 day columns, summary stat
//  cards, projection widget, bottom summary table). Also covers
//  "reviewing last war" mode (isSheetReview/usingSheetFallback) for
//  when the CR API has moved on to a new race but the last war's data
//  should still display. renderLive() is the entry point.
//
//  Depends on calculations.js (getAdjustedRank for placement display,
//  calcAvg/calcTrend etc. for the projection widget).
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  RENDER — LIVE MODE
// ══════════════════════════════════════════════════════

function setLiveWindow(n) {
  liveWindowSize = n;
  document.querySelectorAll('#grp-live-window .btn').forEach((b, i) => {
    b.classList.toggle('active', [3, 5, 10, 0][i] === n);
  });
  renderLive();
}

function setLiveSort(s) {
  liveSort = s;
  document.querySelectorAll('#grp-live .btn-group .btn').forEach((b, i) => {
    b.classList.toggle('active', ['score', 'alpha'][i] === s);
  });
  renderLive();
}

// Determine current war day from live API data.
// Uses the max total decks used across all participants:
//   decks 1–4 → Day 1,  5–8 → Day 2,  9–12 → Day 3,  13–16 → Day 4
// Returns 1 before anyone has played (pre-war or training day).
function computeCurrentDay(liveData) {
  const maxDecksUsed = Math.max(...Object.values(liveData).map(p => p.decksUsed || 0), 0);
  return maxDecksUsed === 0 ? 1 : Math.min(Math.ceil(maxDecksUsed / DECKS_PER_DAY), WAR_DAYS);
}

// Placeholder version of the summary box shown on Days 1-3, before the
// real metrics are meaningful. Mirrors the same 6-card layout with "-"
// values so the page doesn't visually jump once Day 4 arrives.
function buildWarSummaryPlaceholder() {
  const stat = (label) => `
    <div class="live-stat-card">
      <div class="live-stat-label">${label}</div>
      <div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:var(--text-dim)">-</div>
      <div class="live-stat-sub">war in progress</div>
    </div>`;

  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
    ${stat('Battles Missed')}
    ${stat('War Placement')}
    ${stat('Cumulative Score')}
    ${stat('Score vs Avg')}
    ${stat('Avg Player Score')}
    ${stat('Player Avg vs Avg')}
    ${stat('War Grade')}
  </div>`;
}

// Build the top-of-page summary box for Live mode: shows war-wide metrics at a glance
// (% battles missed, cumulative score, score vs avg, avg player score vs avg, letter grade placeholder).
// currentDay/warStarted determine how far through the war we are for the missed-battle calc.
// Pure calculation for the Live tab's 7-card summary box — computes every
// number, threshold color, and label the cards display, with zero HTML.
// buildWarSummaryBox() below just renders this object; if you need one of
// these numbers anywhere else (e.g. a future export or a different card
// layout), call this instead of re-deriving it.
function calcWarSummary(sortedPlayers, currentDay, isSheetReview = false) {
  // ── Use SNAPSHOT totals as source of truth ───────────────────────────────
  // LIVE_SHEET_DATA is built from SNAPSHOTS (hourly GAS writes), which store
  // genuine CUM_FAME/CUM_DECKS from the CR API — correctly cumulative across
  // all 4 days including Colosseum weeks. The raw LIVE_DATA API values for
  // decksUsed/decksUsedToday are ambiguous mid-day and wrong when a period
  // rolls over, so we derive totals from snapshots whenever available.
  const snapshotEntries = Object.values(LIVE_SHEET_DATA);
  const snapshotParticipants = snapshotEntries.filter(s => (s.totalDecks || 0) > 0 || (s.totalFame || 0) > 0);
  const useSnapshots = !isSheetReview && snapshotParticipants.length > 0;

  let totalDecksUsed, totalFameNow;
  if (useSnapshots) {
    totalDecksUsed = snapshotParticipants.reduce((a, s) => a + (s.totalDecks || 0), 0);
    totalFameNow   = snapshotParticipants.reduce((a, s) => a + (s.totalFame  || 0), 0);
  } else {
    totalDecksUsed = sortedPlayers.reduce((a, p) => a + (p.decksUsed || 0), 0);
    totalFameNow   = sortedPlayers.reduce((a, p) => a + (p.fame    || 0), 0);
  }
  const maxTotalDecks = WAR_BATTLE_CAP; // 800 = 200/day × 4 days

  // ── % of war battles missed ──────────────────────────────────────────────
  // For a completed/review war: missed = max possible minus actually used.
  // For an active war on Day N: all N days have elapsed (including today on
  // Day 4), so completedDays = currentDay. We read per-player past-day decks
  // from snapshot data (reliable) rather than API decksUsedToday (ambiguous).
  let missedDecksTotal, decksExpectedSoFar;
  if (isSheetReview) {
    decksExpectedSoFar = maxTotalDecks;
    missedDecksTotal   = Math.max(0, maxTotalDecks - totalDecksUsed);
  } else {
    // On the final day, treat all days as elapsed.
    const completedDays = currentDay >= WAR_DAYS ? WAR_DAYS : currentDay - 1;
    decksExpectedSoFar  = Math.min(completedDays * DAILY_BATTLE_CAP, maxTotalDecks);

  if (useSnapshots) {
    // Only count actual participants — not all snapshotted clan members.
    missedDecksTotal = snapshotParticipants.reduce((acc, s) => {
      const expected = completedDays * DECKS_PER_DAY;
      return acc + Math.max(0, expected - (s.totalDecks || 0));
    }, 0);
  } else {
    missedDecksTotal = sortedPlayers.reduce((acc, p) => {
      if (completedDays <= 0) return acc;
      const pastDayMax    = completedDays * DECKS_PER_DAY;
      const pastDecksUsed = Math.max(0, (p.decksUsed || 0) - (p.decksUsedToday || 0));
      return acc + Math.max(0, pastDayMax - pastDecksUsed);
    }, 0);
  }
  }
  const pctMissed = decksExpectedSoFar > 0 ? (missedDecksTotal / decksExpectedSoFar) * 100 : 0;
  const missedColor = pctMissed <= 5 ? C_GREEN : pctMissed <= 15 ? '#f5b731' : C_RED;

  // ── Historical clan total avg, scaled to the liveWindowSize toggle (3/5/10/All) ──
  const completedWarsForAvg = WARS.filter(w => !w.isLive);
  const windowedWars = liveWindowSize === 0
    ? completedWarsForAvg
    : completedWarsForAvg.slice(-liveWindowSize);
  const warTotals = windowedWars.map(w => {
    const idx = WARS.findIndex(x => x.id === w.id && !x.isLive);
    if (idx === -1) return null;
    const scores = PLAYERS.map(p => p.scores[idx]).filter(s => s !== null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0);
  }).filter(t => t !== null);
  const historicalClanTotalAvg = warTotals.length
    ? warTotals.reduce((a, b) => a + b, 0) / warTotals.length
    : 0;

  // ── Historical avg PLAYER score, scaled to the same window ──────────────
  // Only count players who actually scored > 0 in each war (true participants).
  // Including 0-score non-participants would deflate the historical baseline,
  // making the current war look better than it really is by comparison.
  const warPlayerAvgs = windowedWars.map(w => {
    const idx = WARS.findIndex(x => x.id === w.id && !x.isLive);
    if (idx === -1) return null;
    const scores = PLAYERS.map(p => p.scores[idx]).filter(s => s !== null && s > 0);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }).filter(v => v !== null);
  const historicalPlayerAvg = warPlayerAvgs.length
    ? warPlayerAvgs.reduce((a, b) => a + b, 0) / warPlayerAvgs.length
    : 0;

  // ── This war's current numbers ───────────────────────────────────────────
  // Avg PLAYER score: divide totalFameNow by counted players only.
  // "counted" = present on Day 1–2 OR used any decks (excludes late locked-out
  // joiners). The snapshot's `counted` flag is the authoritative source.
  // When snapshots are available, use snapshot entries for the denominator so
  // late-day API ambiguity (decksUsedToday=0 for players done earlier) doesn't
  // drop players from the count and inflate the average.
  //
  // Cap at WAR_ROSTER_CAP (50, the in-game max contributors/day): real
  // contributors are ALWAYS included in full (never dropped, even if churn
  // across the 4 days pushes them past 50 -- e.g. war 29 had 55 distinct
  // contributors due to mid-war swaps). Zero-battle members (in the clan
  // during the war but never played) are added on top only while there's
  // still room under the 50 cap. This keeps the average representing "the
  // roster that actually fought this war," not every name that ever cycled
  // through a war slot -- sortedPlayers itself still includes everyone (for
  // card display), this only scopes the summary-box average's denominator.
  let countedPlayers;
  if (useSnapshots) {
    countedPlayers = snapshotParticipants; // already filtered to decks>0 or fame>0
  } else {
    // Real contributors first, based on actual decks/fame -- NOT the looser
    // `counted` flag (that flag's "present Day 1-2" clause was only ever
    // meaningful back when sortedPlayers was pre-filtered to real
    // contributors upstream; now that sortedPlayers includes every
    // zero-battle roster member too, using `counted` here would just let
    // those same zero-battle members back in as "contributors").
    const contributors = sortedPlayers.filter(p => (p.decksUsed || 0) > 0 || (p.fame || 0) > 0);
    const zeroBattle = sortedPlayers.filter(p => !((p.decksUsed || 0) > 0 || (p.fame || 0) > 0));
    const roomLeft = Math.max(0, WAR_ROSTER_SIZE - contributors.length);
    countedPlayers = contributors.concat(zeroBattle.slice(0, roomLeft));
  }
  const currentPlayerAvg = countedPlayers.length ? totalFameNow / countedPlayers.length : 0;

  const totalVsAvgPct  = historicalClanTotalAvg > 0 ? ((totalFameNow - historicalClanTotalAvg) / historicalClanTotalAvg) * 100 : 0;
  const playerVsAvgPct = historicalPlayerAvg > 0 ? ((currentPlayerAvg - historicalPlayerAvg) / historicalPlayerAvg) * 100 : 0;

  const totalVsAvgColor  = totalVsAvgPct  >= 0 ? C_GREEN : C_RED;
  const playerVsAvgColor = playerVsAvgPct >= 0 ? C_GREEN : C_RED;
  const totalVsAvgSign   = totalVsAvgPct  >= 0 ? '+' : '';
  const playerVsAvgSign  = playerVsAvgPct >= 0 ? '+' : '';

  const windowLabel = liveWindowSize === 0 ? 'All-Time' : liveWindowSize + 'W';

  // ── War rank among the 5 competing clans (1st-5th) ───────────────────────
  // Rank must reflect the war actually being displayed. When LIVE (a war is
  // currently in progress), use the live API's clans[] array directly --
  // it's real-time and always correct for the active race.
  // When reviewing a past/completed war (training day fallback), the live
  // API's clans[] array has already moved on to the NEW race, so we instead
  // look up the most recently FINALIZED war's standings from the STANDINGS
  // sheet, which the Apps Script now writes at the moment each war ends.
  let ourRank, rankOf, rankClanCount;
  if (isSheetReview) {
    const recentStandings = getOurMostRecentStandings();
    rankClanCount = recentStandings ? (WAR_STANDINGS[String(recentStandings.warId)] || []).length : 0;
    const recentWar = recentStandings ? WARS.find(w => w.id === recentStandings.warId) : null;
    ourRank = recentStandings
      ? getAdjustedRank(recentStandings, WAR_STANDINGS[String(recentStandings.warId)], recentWar && recentWar.warType)
      : null;
  } else {
    rankClanCount = LIVE_RACE_CLANS.length;
    const rawRank = getOurRank();
    // Same tie-for-1st check for an in-progress war's live standings (these
    // aren't in WAR_STANDINGS yet, so build an equivalent {rank,fame} shape
    // from LIVE_RACE_CLANS on the fly).
    if (rawRank && LIVE_RACE_CLANS.length) {
      const us = LIVE_RACE_CLANS.find(c => c.tag === ('#' + CLAN_TAG));
      const liveStandings = LIVE_RACE_CLANS.map((c, i) => ({ rank: i + 1, fame: c.fame }));
      ourRank = us ? getAdjustedRank({ rank: rawRank, fame: us.fame }, liveStandings) : rawRank;
    } else {
      ourRank = rawRank;
    }
  }
  const rankMedal  = ourRank === 1 ? '🥇' : ourRank === 2 ? '🥈' : ourRank === 3 ? '🥉' : '';
  const rankColor  = ourRank === 1 ? '#ffd700' : ourRank === 2 ? '#c0c0c0' : ourRank === 3 ? '#cd7f32' : C_RED;
  const rankOrdinal = ourRank === 1 ? '1st' : ourRank === 2 ? '2nd' : ourRank === 3 ? '3rd' : ourRank ? ourRank + 'th' : '—';
  const rankSublabel = rankClanCount ? `of ${rankClanCount} clans` : (isSheetReview ? 'not recorded for this war' : 'no race data');

  // ── Distribution evenness (coefficient of variation across player scores) ──
  // Lower CV = more even contribution across the roster. Used only as a small
  // modifier on the grade, never a primary factor.
  const fameVals = (useSnapshots
    ? snapshotParticipants.map(s => s.totalFame)
    : sortedPlayers.map(p => p.fame || 0).filter(f => f > 0));
  let distributionCV = null;
  if (fameVals.length > 1) {
    const mean = fameVals.reduce((a, b) => a + b, 0) / fameVals.length;
    const variance = fameVals.reduce((a, b) => a + (b - mean) ** 2, 0) / fameVals.length;
    const stdDev = Math.sqrt(variance);
    distributionCV = mean > 0 ? stdDev / mean : null;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  WAR GRADE ALGORITHM (v1)
  //  Core score out of 100, built from the two heaviest factors (battles
  //  missed and war rank), plus a smaller weight for performance vs our own
  //  history. Distribution evenness is then applied as a small +/-5 modifier
  //  on top -- it nudges the grade but never decides it outright.
  //
  //    Battles missed   -> 40 pts (0% missed = 40, scales to 0 at >=25% missed)
  //    War rank (1st-5th)-> 40 pts (1st=40, 2nd=30, 3rd=20, 4th=10, 5th=0)
  //    Score vs own avg  -> 20 pts (at/above avg = 20, scales to 0 at -30%)
  //    Distribution CV   -> +/-5 pt modifier (low CV = more even = bonus)
  //
  //  Letter scale is intentionally top-heavy since a real war is very
  //  unlikely to bottom out near 0 given these weights:
  //    95-105 S | 85-94 A | 75-84 B | 65-74 C | 50-64 D | <50 F
  // ════════════════════════════════════════════════════════════════════════
  const missedPts = Math.max(0, 40 * (1 - Math.min(pctMissed, 25) / 25));

  const vsAvgClamped = Math.max(-30, Math.min(totalVsAvgPct, 0)); // only penalize being below avg; being above caps the bonus at full 20
  const vsAvgPts = totalVsAvgPct >= 0 ? 20 : 20 * (1 - Math.abs(vsAvgClamped) / 30);

  let distributionModifier = 0;
  if (distributionCV !== null) {
    // CV below ~0.25 = quite even; above ~0.5 = quite uneven. Scale linearly between.
    const evenness = 1 - Math.min(Math.max((distributionCV - 0.25) / 0.25, 0), 1);
    distributionModifier = (evenness - 0.5) * 10; // ranges roughly -5 to +5
  }

  // Rank comes from the STANDINGS sheet (live API during an active war,
  // or the most recently finalized war's authoritative riverracelog-sourced
  // entry during training-day review). If genuinely unavailable for either
  // reason, do NOT inject a fake neutral score; instead rescale the
  // remaining factors (missed + vsAvg, normally 60pts combined) up to fill
  // the full 100pt range so the grade stays meaningful without an invented rank.
  let gradeScoreRaw, rankPts, rankUnknown = (ourRank === null);
  if (rankUnknown) {
    rankPts = null;
    const scaleFactor = 100 / 60; // missedPts + vsAvgPts max out at 60 without rank
    gradeScoreRaw = (missedPts + vsAvgPts) * scaleFactor + distributionModifier;
  } else {
    rankPts = ourRank === 1 ? 40 : ourRank === 2 ? 30 : ourRank === 3 ? 20 : ourRank === 4 ? 10 : 0;
    gradeScoreRaw = missedPts + rankPts + vsAvgPts + distributionModifier;
  }
  const gradeScore = Math.max(0, Math.round(gradeScoreRaw));

  let letterGrade, gradeColor;
  if (gradeScore >= 95)      { letterGrade = 'S'; gradeColor = '#ffd700'; }
  else if (gradeScore >= 85) { letterGrade = 'A'; gradeColor = C_GREEN; }
  else if (gradeScore >= 75) { letterGrade = 'B'; gradeColor = '#8bc34a'; }
  else if (gradeScore >= 65) { letterGrade = 'C'; gradeColor = '#f5b731'; }
  else if (gradeScore >= 50) { letterGrade = 'D'; gradeColor = C_ORANGE; }
  else                       { letterGrade = 'F'; gradeColor = C_RED; }

  return {
    pctMissed, missedColor, missedDecksTotal, decksExpectedSoFar,
    totalFameNow, windowLabel,
    historicalClanTotalAvg, totalVsAvgPct, totalVsAvgColor, totalVsAvgSign,
    currentPlayerAvg, countedPlayersCount: countedPlayers.length,
    historicalPlayerAvg, playerVsAvgPct, playerVsAvgColor, playerVsAvgSign,
    rankMedal, rankColor, rankOrdinal, rankSublabel, rankUnknown,
    gradeScore, letterGrade, gradeColor
  };
}

// Render the Live tab's 7-card summary box from calcWarSummary()'s output.
// Pure HTML building — no computation belongs in here; add new numbers to
// calcWarSummary() instead of deriving them inline in a template string.
function buildWarSummaryBox(sortedPlayers, currentDay, isSheetReview = false) {
  const s = calcWarSummary(sortedPlayers, currentDay, isSheetReview);

  const stat = (label, valueHtml, sublabel = '') => `
    <div class="live-stat-card">
      <div class="live-stat-label">${label}</div>
      ${valueHtml}
      ${sublabel ? `<div class="live-stat-sub">${sublabel}</div>` : ''}
    </div>`;

  return `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
    ${stat(
      'Battles Missed',
      `<div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:${s.missedColor}">${s.pctMissed.toFixed(1)}%</div>`,
      `${s.missedDecksTotal} of ${s.decksExpectedSoFar} expected`
    )}
    ${stat(
      'War Placement',
      `<div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:${s.rankColor}">${s.rankMedal ? s.rankMedal + ' ' : ''}${s.rankOrdinal}</div>`,
      s.rankSublabel
    )}
    ${stat(
      'Cumulative Score',
      `<div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:${C_GOLD}">${Math.round(s.totalFameNow).toLocaleString()}</div>`,
      `vs ${s.windowLabel} avg`
    )}
    ${stat(
      'Score vs Avg',
      `<div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:${s.totalVsAvgColor}">${s.totalVsAvgSign}${s.totalVsAvgPct.toFixed(1)}%</div>`,
      `avg: ${Math.round(s.historicalClanTotalAvg).toLocaleString()}`
    )}
    ${stat(
      'Avg Player Score',
      `<div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:${C_GOLD}">${Math.round(s.currentPlayerAvg).toLocaleString()}</div>`,
      `${s.countedPlayersCount} active`
    )}
    ${stat(
      'Player Avg vs Avg',
      `<div style="font-family:Orbitron,monospace;font-size:22px;font-weight:700;color:${s.playerVsAvgColor}">${s.playerVsAvgSign}${s.playerVsAvgPct.toFixed(1)}%</div>`,
      `avg: ${Math.round(s.historicalPlayerAvg).toLocaleString()}`
    )}
    ${stat(
      'War Grade',
      `<div style="font-family:Orbitron,monospace;font-size:28px;font-weight:900;color:${s.gradeColor}">${s.letterGrade}</div>`,
      s.rankUnknown ? `score: ${s.gradeScore}/100 (rank unknown)` : `score: ${s.gradeScore}/100`
    )}
  </div>`;
}

// Build the HTML for one day column (dayIdx 0–3) in the live war grid.
// Includes a header with a cumulative battle counter and one card per player.
// Pure calculation for one day column (dayIdx 0-3) in the live war grid —
// header aggregate stats (battles/fame/contributors for the day) plus a
// per-player data array (decks/fame/tag/status classes). Zero HTML.
// buildLiveDayColumn() below just renders this object.
function calcDayColumn(dayIdx, sortedPlayers, currentDay, warStarted, isSheetReview = false) {
  const dayLabels   = ['Day 1', 'Day 2', 'Day 3', 'Day 4'];
  const label       = dayLabels[dayIdx];
  const dayNum      = dayIdx + 1;
  // In sheet-review (war over), all days are DONE — no day is "today" or future.
  const isPast      = isSheetReview ? true : dayNum < currentDay;
  const isToday     = isSheetReview ? false : dayNum === currentDay && warStarted;
  const isFuture    = !isPast && !isToday;
  const headerClass = isToday ? 'today' : isFuture ? 'future' : 'past';
  const statusLabel = isToday ? 'LIVE' : isFuture ? 'UPCOMING' : 'DONE';

  // ── Battle counters ────────────────────────────────────
  // dayBattles  = decks used on THIS day only (for x/200 left display)
  // cumBattles  = cumulative decks through end of this day (for x/N*200 right display)
  // dayFame     = fame earned THIS day only (for centre display)
  let dayBattles = 0, cumBattles = 0, dayFame = 0;
  sortedPlayers.forEach(p => {
    const sheet = LIVE_SHEET_DATA[p.name.toLowerCase()];
    if (isSheetReview && sheet) {
      // Cumulative through this day
      let cum = 0;
      for (let pd = 0; pd <= dayIdx; pd++) cum += sheet.days[pd].decks || 0;
      cumBattles += cum;
      // This day's isolated decks
      const prevCum = dayIdx > 0
        ? (() => { let c=0; for(let pd=0;pd<dayIdx;pd++) c+=sheet.days[pd].decks||0; return c; })()
        : 0;
      dayBattles += Math.max(0, cum - prevCum);
      // This day's isolated fame (sheet.days[d].fame is cumulative)
      const prevCumFame = dayIdx > 0 ? (sheet.days[dayIdx - 1]?.fame || 0) : 0;
      dayFame += Math.max(0, (sheet.days[dayIdx].fame || 0) - prevCumFame);
    } else if (isToday) {
      let pastDecks = 0;
      for (let pd = 0; pd < dayIdx; pd++) {
        if (sheet && sheet.days[pd].decks > 0) pastDecks += sheet.days[pd].decks;
        else if (pd === dayIdx - 1) pastDecks += Math.max(0, (p.decksUsed||0) - (p.decksUsedToday||0));
      }
      dayBattles  += p.decksUsedToday || 0;
      cumBattles  += pastDecks + (p.decksUsedToday || 0);
      // Today's fame: API cumulative minus last snapshot of yesterday
      const prevDayCumFame = dayIdx > 0 ? (sheet?.days[dayIdx - 1]?.fame || 0) : 0;
      dayFame += Math.max(0, (p.fame || 0) - prevDayCumFame);
    } else if (isPast) {
      if (sheet && sheet.days[dayIdx] != null) {
        // Always prefer snapshot data for past days — avoids the API estimation
        // error where decksUsed - decksUsedToday overcounts because Day N+1
        // battles played before the next refresh inflate Day N's counter.
        let cum = 0;
        for (let pd = 0; pd <= dayIdx; pd++) cum += sheet.days[pd].decks || 0;
        cumBattles += cum;
        const prevCum = dayIdx > 0
          ? (() => { let c=0; for(let pd=0;pd<dayIdx;pd++) c+=sheet.days[pd].decks||0; return c; })()
          : 0;
        dayBattles += Math.max(0, cum - prevCum);
        const prevCumFame = dayIdx > 0 ? (sheet.days[dayIdx - 1]?.fame || 0) : 0;
        dayFame += Math.max(0, (sheet.days[dayIdx].fame || 0) - prevCumFame);
      } else if (dayIdx === currentDay - 2) {
        // Only fall back to API estimate if no snapshot exists for this player
        const d = Math.max(0, (p.decksUsed||0) - (p.decksUsedToday||0));
        dayBattles += d; cumBattles += d;
      }
    }
  });

  const dayCap        = DAILY_BATTLE_CAP;                   // 200 per day
  const cumCap        = DAILY_BATTLE_CAP * dayNum;          // 200, 400, 600, 800
  const MEMBER_CAP    = 50;                                  // max contributors/day
  const dayFillRatio  = isFuture ? 0 : dayBattles / dayCap;
  const counterColor  = isFuture           ? 'var(--text-dim)'
    : dayFillRatio >= 1.0  ? 'var(--green)'
    : dayFillRatio >= 0.66 ? 'var(--gold)'
    : dayFillRatio >= 0.33 ? 'var(--orange)'
    : 'var(--red)';

  let dayContributors = 0;
  if (!isFuture) {
    sortedPlayers.forEach(p => {
      const key = p.name.toLowerCase();
      // Count anyone with real decks this day, regardless of current roster
      // status. The in-game 50-contributor cap is enforced by Supercell, not
      // by us -- gating on CURRENT LIVE_ROLES/SWAPPER_NAMES membership here
      // used to silently drop players who battled that day but have since
      // been kicked (mid-war or after the war ended), undercounting a day
      // that was actually fully (or more) contributed to. dayBattles (the
      // x/200 number) never had this gate; this count now matches it.
      const sheet = LIVE_SHEET_DATA[key];
      let d = 0;
      if (isSheetReview && sheet) {
        d = sheet.days[dayIdx].decks || 0;
      } else if (isToday) {
        d = p.decksUsedToday || 0;
      } else if (isPast && sheet && sheet.days[dayIdx] != null) {
        d = sheet.days[dayIdx].decks || 0;
      } else if (isPast && dayIdx === currentDay - 2) {
        // API fallback only when no snapshot exists
        d = Math.max(0, (p.decksUsed || 0) - (p.decksUsedToday || 0));
      }
      if (d > 0) dayContributors++;
    });
  }
  const memberFillRatio = dayContributors / MEMBER_CAP;
  const memberColor = isFuture ? 'rgba(255,255,255,0.5)'
    : memberFillRatio >= 1.0  ? 'var(--green)'
    : memberFillRatio >= 0.80 ? 'var(--gold)'
    : memberFillRatio >= 0.50 ? 'var(--orange)'
    : 'var(--red)';

  const fameColor = isFuture ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.95)';

  // ── Per-player data (no HTML) ────────────────────────
  const players = sortedPlayers.map((p, idx) => {
    const sheet = LIVE_SHEET_DATA[p.name.toLowerCase()];
    let decks = 0, fame = 0;

    if (isSheetReview && sheet) {
      decks = sheet.days[dayIdx].decks || 0;
      const prevCumFame = dayIdx > 0 ? (sheet.days[dayIdx - 1]?.fame || 0) : 0;
      fame  = Math.max(0, (sheet.days[dayIdx].fame || 0) - prevCumFame);
    } else if (isToday) {
      decks = p.decksUsedToday || 0;
      const prevDayCumFame = dayIdx > 0 ? (sheet?.days[dayIdx - 1]?.fame || 0) : 0;
      fame = Math.max(0, (p.fame || 0) - prevDayCumFame);
    } else if (isPast && sheet && sheet.days[dayIdx] != null) {
      // Prefer snapshot data for past days (Fix: was only entering here if decks>0,
      // but now we use the backfilled snapshot which may have correct decks even
      // for the most-recent past day that previously fell through to API estimate).
      decks = sheet.days[dayIdx].decks || 0;
      const prevCumFame = dayIdx > 0 ? (sheet.days[dayIdx - 1]?.fame || 0) : 0;
      fame  = Math.max(0, (sheet.days[dayIdx].fame || 0) - prevCumFame);
    } else if (isPast && dayIdx === currentDay - 2) {
      // API estimate fallback — only used when no snapshot exists for this player
      decks = Math.max(0, (p.decksUsed || 0) - (p.decksUsedToday || 0));
      fame  = 0;
    }

    const isMatch = searchStr && p.name.toLowerCase().includes(searchStr.toLowerCase());
    const isComplete = decks >= DECKS_PER_DAY;
    const isPartial  = !isComplete && decks > 0;
    const cardClass  = (isFuture && warStarted) ? 'future-day'
      : isComplete ? 'complete'
      : isPartial  ? 'partial'
      : 'incomplete';
    const decksClass  = decks >= DECKS_PER_DAY ? 'full' : decks > 0 ? 'partial' : 'empty';

    // Look up the PLAYERS entry for tag detection. isSheetReview uses
    // playerTagForWarReview() instead of playerTag() -- see that function's
    // comment for why the plain REMOVED check is wrong during training day.
    const playerObj = PLAYERS.find(pl => pl.name.toLowerCase() === p.name.toLowerCase());
    const cardKey = p.name.toLowerCase();
    const tagFn = isSheetReview ? playerTagForWarReview : playerTag;
    const tag = playerObj ? tagFn(playerObj)
      : SWAPPER_NAMES.has(cardKey) ? 'swapper'
      : (isSheetReview ? (LIVE_SHEET_DATA[cardKey] ? 'removed' : null) : (!LIVE_ROLES[cardKey] ? 'removed' : null));

    return { name: p.name, decks, fame, tag, isMatch, cardClass, decksClass };
  });

  return {
    label, statusLabel, headerClass, isFuture, isToday,
    dayBattles, dayCap, cumBattles, cumCap, dayFame, fameColor,
    dayContributors, MEMBER_CAP, memberColor,
    showDash: isFuture && warStarted,
    players
  };
}

// Render one day column (dayIdx 0-3) from calcDayColumn()'s output.
// Pure HTML building — add new numbers to calcDayColumn() instead of
// deriving them inline here.
function buildLiveDayColumn(dayIdx, sortedPlayers, currentDay, warStarted, isSheetReview = false) {
  const d = calcDayColumn(dayIdx, sortedPlayers, currentDay, warStarted, isSheetReview);

  // Text styles — high contrast white on colored header backgrounds.
  // Lilita One throughout (numbers and labels alike) -- Orbitron's "0"
  // renders with a slash through it in this app's actual font stack,
  // which reads as a generic techy/robotic monospace, not the Supercell
  // house style this whole tracker is meant to match. Numbers and labels
  // stay visually distinct via size/weight/color, not a different font.
  const numStyle = `font-family:'Lilita One',system-ui,sans-serif;color:#ffffff`;
  const capStyle = `font-family:'Lilita One',system-ui,sans-serif;color:rgba(255,255,255,0.7)`;
  const lblStyle = `font-family:'Lilita One',system-ui,sans-serif;color:rgba(255,255,255,0.6)`;
  // Upcoming (isFuture) days used to render a single small "0/200"
  // counter here instead of this full battles/members + fame +
  // cumulative layout — structurally much shorter, so an upcoming day's
  // header ended up a different height than a live/past day's. Since
  // .live-war-grid stretches every column to match its tallest sibling
  // (flex default align-items:stretch), that header-height mismatch
  // alone was enough to make otherwise-identical-length day columns
  // report different total heights — which is what actually caused rows
  // landing in different places when swiping between days, not just a
  // rendering-timing issue. calcDayColumn() already zeroes dayBattles/
  // dayContributors/dayFame/cumBattles for a future day and already
  // computes dimmed placeholder colors for it (memberColor/fameColor),
  // so always using this one layout needs no extra isFuture branching
  // here — an upcoming day just naturally shows "0/200" etc. in dimmed
  // colors, same structure, same height, every time.
  const counterHtml = `<div class="live-day-label">${d.label} — ${d.statusLabel}</div>`
    + `<div class="live-day-counters-row" style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:2px">`
    + `<div style="display:flex;flex-direction:column;gap:3px">`
    + `<div class="live-day-battles" style="${numStyle};font-size:18px;line-height:1">${d.dayBattles}<span class="live-day-cap" style="${capStyle};font-size:11px">/${d.dayCap}</span></div>`
    + `<div class="live-day-members" style="${numStyle};font-size:13px;line-height:1;color:${d.memberColor}">${d.dayContributors}<span class="live-day-cap" style="${capStyle};font-size:10px">/${d.MEMBER_CAP} members</span></div>`
    + `</div>`
    + `<div class="live-day-fame-wrap" style="text-align:center;flex:1;padding:0 8px">`
    + `<div class="live-day-mini-lbl" style="${lblStyle};font-size:9px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:1px">fame</div>`
    + `<div class="live-day-fame-val" style="${numStyle};font-size:16px;line-height:1;color:${d.fameColor}">${d.dayFame > 0 ? d.dayFame.toLocaleString() : '—'}</div>`
    + `</div>`
    + `<div class="live-day-cum-wrap" style="text-align:right">`
    + `<div class="live-day-mini-lbl" style="${lblStyle};font-size:9px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:1px">cumulative</div>`
    + `<div class="live-day-cum-val" style="${numStyle};font-size:14px;line-height:1;color:rgba(255,255,255,0.85)">${d.cumBattles}<span class="live-day-cap" style="${capStyle};font-size:10px">/${d.cumCap}</span></div>`
    + `</div>`
    + `</div>`;

  // ── Player cards (with row number) ────────────────────
  const cards = d.players.map((p, idx) => {
    const todayClass = d.isToday ? 'today-card' : '';
    const matchClass = p.isMatch ? 'search-match' : '';

    // .live-card-inner carries the "raised" transform/background/shadow
    // (see .search-match CSS) -- .live-player-card itself (the element
    // hover/click logic actually targets) stays geometrically static so
    // its own position never needs recaching. See attachLiveCardHighlight()
    // (this file) for the full story on why that split exists.
    return `<div class="live-player-card ${p.cardClass} ${todayClass} ${matchClass}" data-name="${encodeURIComponent(p.name)}" data-day-idx="${dayIdx}" data-search-match="${p.isMatch ? '1' : '0'}">`
      + `<div class="live-card-inner">`
      + `<span class="live-card-rank">${idx + 1}</span>`
      + `<span class="live-card-name">${p.name}${playerTagHtml(p.tag, 'dot')}</span>`
      + `<div class="live-card-right">`
      + `<span class="live-card-decks ${p.decksClass}">${d.showDash ? '-/4' : `${p.decks}/4`}</span>`
      + `<span class="live-card-fame">${d.showDash ? '-' : p.fame > 0 ? p.fame.toLocaleString() : '0'}</span>`
      + `</div></div></div>`;
  }).join('');

  return `<div class="live-day-col">`
    + `<div class="live-day-header ${d.headerClass}">${counterHtml}</div>`
    + cards
    + `</div>`;
}

// Build the war summary table at the bottom of Live mode (total battles + fame per player).
function buildWarSummaryTable(sortedPlayers, currentDay, isSheetReview = false) {
  // Apply search filter — hide non-matching players (same behaviour as data/graphic tabs)
  const filtered = searchStr
    ? sortedPlayers.filter(p => p.name.toLowerCase().includes(searchStr.toLowerCase()))
    : sortedPlayers;

  const rows = filtered.map(p => {
    const totalDecks = p.decksUsed || 0;
    const totalFame  = p.fame      || 0;
    const maxSoFar   = currentDay * DECKS_PER_DAY;

    // Deck color class — same thresholds as avgDecksFracClass in buildRow
    const deckClass = totalDecks >= maxSoFar ? 'avg-s'
      : totalDecks >= maxSoFar * 0.85 ? 'avg-a'
      : totalDecks >= maxSoFar * 0.65 ? 'avg-b'
      : totalDecks > 0 ? 'avg-c'
      : 'avg-d';

    // Fame color class — same TIER thresholds as avgClass() on data page
    const fameClass = totalFame >= TIER_S ? 'avg-s'
      : totalFame >= TIER_A ? 'avg-a'
      : totalFame >= TIER_B ? 'avg-b'
      : totalFame >= TIER_C ? 'avg-c'
      : totalFame > 0 ? 'avg-d'
      : '';

    // Same tag lookup as the day-column cards (including the isSheetReview
    // swap to playerTagForWarReview()), so swappers/new/removed players
    // are identifiable here too, not just in the day columns.
    const playerObj = PLAYERS.find(pl => pl.name.toLowerCase() === p.name.toLowerCase());
    const rowKey = p.name.toLowerCase();
    const rowTagFn = isSheetReview ? playerTagForWarReview : playerTag;
    const rowTag = playerObj ? rowTagFn(playerObj)
      : SWAPPER_NAMES.has(rowKey) ? 'swapper'
      : (isSheetReview ? (LIVE_SHEET_DATA[rowKey] ? 'removed' : null) : (!LIVE_ROLES[rowKey] ? 'removed' : null));

    return `<tr>`
      + `<td><span class="player-name">${p.name}</span>${playerTagHtml(rowTag, 'dot')}</td>`
      + `<td class="td-avg" style="text-align:center"><span class="wcell ${deckClass}">${totalDecks}/16</span></td>`
      + `<td class="td-avg" style="text-align:center"><span class="wcell ${fameClass}">${totalFame > 0 ? totalFame.toLocaleString() : '—'}</span></td>`
      + `</tr>`;
  }).join('');

  const countNote = searchStr && filtered.length !== sortedPlayers.length
    ? `<div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);padding:6px 10px">Showing ${filtered.length} of ${sortedPlayers.length} players</div>`
    : '';

  return countNote + `<div class="table-wrap"><table class="live-summary-table">`
    + `<colgroup><col style="width:55%"><col style="width:22.5%"><col style="width:22.5%"></colgroup>`
    + `<thead><tr><th style="text-align:left">Player</th><th>Total Battles</th><th>Total Fame</th></tr></thead>`
    + `<tbody>${rows}</tbody>`
    + `</table></div>`;
}

// Build the projection SVG chart + accuracy label for the bottom of Live mode.
// Shows current fame vs projected end-of-war fame vs historical clan average.
// Pure calculation for the projection widget's headline numbers: current
// pace, projected final score, historical comparison, and accuracy. This
// does NOT cover the per-day chart data prep or SVG geometry below in
// buildProjectionWidget() — that's chart-drawing detail (not business
// data) and CLAUDE.md flags the perDayFame/projMax declaration order
// there as a past source of bugs, so it's left untouched rather than
// threaded through this split.
function calcProjection(sortedPlayers, currentDay, warComplete = false) {
  // Use SNAPSHOT totals as source of truth (same reasoning as buildWarSummaryBox).
  const snapshotEntries = Object.values(LIVE_SHEET_DATA);
  const snapshotParticipants = snapshotEntries.filter(s => (s.totalDecks || 0) > 0 || (s.totalFame || 0) > 0);
  const useSnapshots = snapshotParticipants.length > 0;

  let totalFameNow, totalDecksUsed;
  if (useSnapshots) {
    totalFameNow   = snapshotParticipants.reduce((a, s) => a + (s.totalFame  || 0), 0);
    totalDecksUsed = snapshotParticipants.reduce((a, s) => a + (s.totalDecks || 0), 0);
  } else {
    totalFameNow   = sortedPlayers.reduce((a, p) => a + (p.fame    || 0), 0);
    totalDecksUsed = sortedPlayers.reduce((a, p) => a + (p.decksUsed || 0), 0);
  }

  const maxTotalDecks  = WAR_BATTLE_CAP;
  const remainingDecks = Math.max(0, maxTotalDecks - totalDecksUsed);

  // completedDays: on Day 4 all days have elapsed, so use WAR_DAYS not WAR_DAYS-1.
  const completedDays = currentDay >= WAR_DAYS ? WAR_DAYS : currentDay - 1;

  // Fame-per-deck: penalise for missed past-day slots (participants only).
  let missedDecksTotal;
  if (useSnapshots && completedDays > 0) {
    missedDecksTotal = snapshotParticipants.reduce((acc, s) => {
      const expected = completedDays * DECKS_PER_DAY;
      return acc + Math.max(0, expected - (s.totalDecks || 0));
    }, 0);
  } else {
    missedDecksTotal = sortedPlayers.reduce((acc, p) => {
      if (completedDays <= 0) return acc;
      const pastDayMax    = completedDays * DECKS_PER_DAY;
      const pastDecksUsed = Math.max(0, (p.decksUsed || 0) - (p.decksUsedToday || 0));
      return acc + Math.max(0, pastDayMax - pastDecksUsed);
    }, 0);
  }
  const effectiveDecksForAvg = totalDecksUsed + missedDecksTotal;
  const currentFamePerDeck = effectiveDecksForAvg > 0 ? totalFameNow / effectiveDecksForAvg : 0;

  // Historical fame-per-deck: derived from the windowed clan avg total divided by max possible decks.
  // Uses the same per-war totals approach as historicalClanAvg below so both stay consistent.
  const _completedWarsForBlend = WARS.filter(w => !w.isLive);
  const _windowedWarsForBlend  = liveWindowSize === 0
    ? _completedWarsForBlend
    : _completedWarsForBlend.slice(-liveWindowSize);
  const _warTotalsForBlend = _windowedWarsForBlend.map(w => {
    const idx = WARS.findIndex(x => x.id === w.id && !x.isLive);
    if (idx === -1) return null;
    const scores = PLAYERS.map(p => p.scores[idx]).filter(s => s !== null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0);
  }).filter(t => t !== null);
  const _histAvgTotal = _warTotalsForBlend.length
    ? _warTotalsForBlend.reduce((a, b) => a + b, 0) / _warTotalsForBlend.length
    : 0;
  // Historical decks: average number of non-null (participating) players per war x max decks per player
  const _histAvgPlayers = _windowedWarsForBlend.map(w => {
    const idx = WARS.findIndex(x => x.id === w.id && !x.isLive);
    if (idx === -1) return 0;
    return PLAYERS.map(p => p.scores[idx]).filter(s => s !== null).length;
  });
  const _histAvgPlayerCount = _histAvgPlayers.length
    ? _histAvgPlayers.reduce((a, b) => a + b, 0) / _histAvgPlayers.length
    : WAR_ROSTER_SIZE;
  const historicalFamePerDeck = _histAvgTotal > 0 && _histAvgPlayerCount > 0
    ? _histAvgTotal / (_histAvgPlayerCount * MAX_DECKS_PER_WAR)
    : 0;

  // Blend current and historical rates based on battle completion %.
  // Early in war (low %) -> lean heavily on history. Late in war (high %) -> lean on current pace.
  const battlesCompletedPct = maxTotalDecks > 0 ? totalDecksUsed / maxTotalDecks : 0;
  const currentWeight     = battlesCompletedPct;
  const historicalWeight  = 1 - battlesCompletedPct;
  const famePerDeck = (currentFamePerDeck * currentWeight) + (historicalFamePerDeck * historicalWeight);

  // Projected final = current + (remaining decks x blended fame/deck rate)
  const projectedFame = Math.round(totalFameNow + remainingDecks * famePerDeck);

  // Historical clan avg — reuses the per-war totals already computed above for the blend,
  // so this stays in sync with the historicalFamePerDeck calculation.
  const historicalClanAvg = Math.round(_histAvgTotal);

  const noData = (totalDecksUsed === 0 && totalFameNow === 0);

  // War-complete comparison numbers (only meaningful when warComplete is true,
  // but cheap to always compute — mirrors the original's control flow, just moved)
  const finalColor = totalFameNow >= historicalClanAvg ? C_GREEN : C_RED;
  const vsAvgPct   = historicalClanAvg > 0 ? ((totalFameNow - historicalClanAvg) / historicalClanAvg * 100).toFixed(1) : '0.0';
  const vsAvgColor = totalFameNow >= historicalClanAvg ? C_GREEN : C_RED;

  const projColor     = projectedFame >= historicalClanAvg ? C_GREEN : C_RED;
  const projAccuracy  = maxTotalDecks > 0 ? (totalDecksUsed / maxTotalDecks) * 100 : 0;
  const accuracyColor = projAccuracy >= ACCURACY_HIGH ? C_GREEN
    : projAccuracy >= ACCURACY_MID  ? '#f5b731'
    : C_RED;

  const windowLabel = liveWindowSize === 0 ? 'All' : liveWindowSize + 'W';

  return {
    noData, totalFameNow, totalDecksUsed, maxTotalDecks, remainingDecks,
    famePerDeck, projectedFame, historicalClanAvg, windowLabel,
    finalColor, vsAvgPct, vsAvgColor,
    projColor, projAccuracy, accuracyColor
  };
}

// Render the projection widget from calcProjection()'s headline numbers.
// Still builds its own per-day chart data (perDayFame etc.) and SVG
// geometry directly — see the comment on calcProjection() for why.
function buildProjectionWidget(sortedPlayers, currentDay, warComplete = false) {
  const proj = calcProjection(sortedPlayers, currentDay, warComplete);

  // If no battles have been played yet, show a placeholder rather than a pure-history projection
  if (proj.noData) {
    return `<div style="display:flex;align-items:center;justify-content:center;height:200px;font-family:'Share Tech Mono',monospace;font-size:13px;color:${C_DIM};letter-spacing:2px;">NO BATTLE DATA YET</div>`;
  }

  // War complete — show final result vs historical avg, no projection bar needed
  if (warComplete) {
    const { totalFameNow, historicalClanAvg, finalColor, vsAvgPct, vsAvgColor, totalDecksUsed, maxTotalDecks, famePerDeck, windowLabel } = proj;
    const projMax      = Math.max(totalFameNow, historicalClanAvg) * 1.25 || 1;
    const chartW2      = PROJ_SVG_W - PROJ_PAD.left - PROJ_PAD.right;
    const chartH2      = PROJ_SVG_H - PROJ_PAD.top  - PROJ_PAD.bottom;
    const yScale2      = v => PROJ_PAD.top + chartH2 - (v / projMax * chartH2);
    const barW2        = chartW2 / 4;
    const b1x2         = PROJ_PAD.left + barW2 * 0.5;
    const avgY2        = yScale2(historicalClanAvg).toFixed(1);
    const b1y2         = yScale2(totalFameNow);
    const baseY2       = PROJ_PAD.top + chartH2;
    const svgFinal = `<svg width="100%" viewBox="0 0 ${PROJ_SVG_W} ${PROJ_SVG_H}" style="overflow:visible">`
      + [0.25, 0.5, 0.75, 1].map(f => {
          const y = yScale2(projMax * f).toFixed(1);
          return `<line x1="${PROJ_PAD.left}" y1="${y}" x2="${PROJ_SVG_W - PROJ_PAD.right}" y2="${y}" stroke="${C_BORDER}" stroke-width="1"/>`
            + `<text x="${PROJ_SVG_W - PROJ_PAD.right + 4}" y="${y}" fill="${C_DIM}" font-size="9" dominant-baseline="middle" font-family="monospace">${Math.round(projMax * f).toLocaleString()}</text>`;
        }).join('')
      + `<line x1="${PROJ_PAD.left}" y1="${avgY2}" x2="${PROJ_SVG_W - PROJ_PAD.right}" y2="${avgY2}" stroke="rgba(180,180,180,0.5)" stroke-width="2" stroke-dasharray="5,3"/>`
      + `<text x="${b1x2 + barW2 * 1.5}" y="${parseFloat(avgY2) - 6}" fill="rgba(180,180,180,0.7)" font-size="9" font-family="monospace">AVG ${historicalClanAvg.toLocaleString()}</text>`
      + `<rect x="${b1x2 - barW2 * 0.35}" y="${b1y2.toFixed(1)}" width="${(barW2 * 0.7).toFixed(1)}" height="${Math.max(2, chartH2 - (b1y2 - PROJ_PAD.top)).toFixed(1)}" fill="${finalColor}" opacity="0.85" rx="3"/>`
      + `<text x="${b1x2}" y="${(b1y2 - 6).toFixed(1)}" text-anchor="middle" fill="${finalColor}" font-size="12" font-weight="700" font-family="monospace">${totalFameNow.toLocaleString()}</text>`
      + `<text x="${b1x2}" y="${baseY2 + 14}" text-anchor="middle" fill="${C_DIM}" font-size="9" font-family="monospace" letter-spacing="1">FINAL</text>`
      + `</svg>`;
    return `<div class="projection-wrap">`
      + `<div class="projection-title">WAR RESULT`
      + `<div class="proj-legend"><div class="proj-legend-dot" style="background:${finalColor}"></div>Final Score</div>`
      + `<div class="proj-legend"><div class="proj-legend-dot" style="background:rgba(180,180,180,0.5)"></div>Hist. Avg (${windowLabel})</div>`
      + `</div>`
      + svgFinal
      + `<div style="margin-top:12px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-dim)">`
      + `${totalDecksUsed}/${maxTotalDecks} battles used · ${famePerDeck.toFixed(0)} fame/battle · `
      + `<span style="color:${vsAvgColor};font-weight:700">${totalFameNow >= historicalClanAvg ? '+' : ''}${vsAvgPct}%</span> vs historical avg`
      + `</div>`
      + `</div>`;
  }

  const { totalFameNow, totalDecksUsed, maxTotalDecks, remainingDecks, famePerDeck, projectedFame, historicalClanAvg, windowLabel, projColor, projAccuracy, accuracyColor } = proj;

  // SVG projection bar chart
  const chartW = PROJ_SVG_W - PROJ_PAD.left - PROJ_PAD.right;
  const chartH = PROJ_SVG_H - PROJ_PAD.top  - PROJ_PAD.bottom;

  // Per-day fame totals from snapshot data — must be declared before projMax
  const perDayFame = [0, 0, 0, 0]; // isolated fame per day
  for (const s of Object.values(LIVE_SHEET_DATA)) {
    if (!s.days) continue;
    for (let d = 0; d < WAR_DAYS; d++) {
      const prevCumFame = d > 0 ? (s.days[d-1]?.fame || 0) : 0;
      perDayFame[d] += Math.max(0, (s.days[d]?.fame || 0) - prevCumFame);
    }
  }
  // A day "has data" if any player has decks or fame for it
  const dayHasData = perDayFame.map((f, d) =>
    f > 0 || Object.values(LIVE_SHEET_DATA).some(s => (s.days?.[d]?.decks || 0) > 0)
  );
  // Cumulative fame per day (for dotted lines)
  const cumFameByDay = perDayFame.reduce((acc, f, i) => {
    acc.push((acc[i-1] || 0) + f);
    return acc;
  }, []);

  const projMax = Math.max(totalFameNow, projectedFame, historicalClanAvg, ...perDayFame) * 1.2 || 1;
  const yScale  = v => PROJ_PAD.top + chartH - (v / projMax * chartH);
  const barW    = chartW / 4;
  const b1x     = PROJ_PAD.left + barW * 0.5;
  const b2x     = PROJ_PAD.left + barW * 2.5;
  const baseY   = PROJ_PAD.top + chartH;
  const b1y     = yScale(totalFameNow);
  const b2y     = yScale(projectedFame);
  const avgY    = yScale(historicalClanAvg).toFixed(1);

  // 6 bars: Day1, Day2, Day3, Day4, Current(total so far), Projected
  // All 6 slots always render — unplayed days get a ghost placeholder so spacing stays even
  const N_BARS  = 6;
  const slotW   = chartW / N_BARS;
  const bW      = slotW * 0.6;  // bar width
  const barCx   = (i) => PROJ_PAD.left + slotW * i + slotW * 0.5; // centre x of slot i

  // Colours — daily bars are color-coded vs expected daily clan avg (total avg / 4 days)
  const dailyAvgExpected = historicalClanAvg / WAR_DAYS;
  const dayBarColor = (fame) => {
    if (fame <= 0) return 'rgba(100,160,240,0.15)';
    const ratio = dailyAvgExpected > 0 ? fame / dailyAvgExpected : 0;
    return ratio >= 1.10 ? 'rgba(38,194,129,0.80)'   // above avg → green
      : ratio >= 0.90 ? 'rgba(126,207,90,0.75)'       // near avg → yellow-green
      : ratio >= 0.70 ? 'rgba(240,180,41,0.80)'       // below avg → gold
      : ratio >= 0.45 ? 'rgba(207,115,32,0.80)'       // low → orange
      : 'rgba(224,82,82,0.80)';                        // very low → red
  };
  const dottedColors = ['#26c281','#26c281','#26c281','#26c281']; // will be overridden per-bar
  const labels = ['DAY 1','DAY 2','DAY 3','DAY 4','NOW','PROJ'];

  let svgBars = '';
  // Day 1-4 bars — always 4 slots; unplayed days show a faint ghost placeholder
  for (let d = 0; d < WAR_DAYS; d++) {
    const bx = barCx(d);
    if (dayHasData[d]) {
      const val = perDayFame[d];
      const by  = yScale(val);
      const col = dayBarColor(val);
      svgBars += `<rect x="${(bx - bW/2).toFixed(1)}" y="${by.toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.max(2, baseY - by).toFixed(1)}" fill="${col}" rx="2"/>`
        + `<text x="${bx.toFixed(1)}" y="${(by - 5).toFixed(1)}" text-anchor="middle" fill="${col}" font-size="9" font-weight="700" font-family="monospace">${val.toLocaleString()}</text>`;
    } else {
      // Ghost placeholder — faint empty bar so layout doesn't gap
      svgBars += `<rect x="${(bx - bW/2).toFixed(1)}" y="${(baseY - 6).toFixed(1)}" width="${bW.toFixed(1)}" height="6" fill="rgba(100,160,240,0.12)" rx="2"/>`;
    }
  }
  // Current bar
  const cIdx = 4;
  const cx = barCx(cIdx);
  const cy = yScale(totalFameNow);
  svgBars += `<rect x="${(cx - bW/2).toFixed(1)}" y="${cy.toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.max(2, baseY - cy).toFixed(1)}" fill="${C_BLUE}" opacity="0.85" rx="2"/>`
    + `<text x="${cx.toFixed(1)}" y="${(cy - 5).toFixed(1)}" text-anchor="middle" fill="${C_BLUE}" font-size="10" font-weight="700" font-family="monospace">${totalFameNow.toLocaleString()}</text>`;
  // Projected bar
  const pIdx = 5;
  const px = barCx(pIdx);
  const py = yScale(projectedFame);
  svgBars += `<rect x="${(px - bW/2).toFixed(1)}" y="${py.toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.max(2, baseY - py).toFixed(1)}" fill="${projColor}" opacity="0.85" rx="2"/>`
    + `<text x="${px.toFixed(1)}" y="${(py - 5).toFixed(1)}" text-anchor="middle" fill="${projColor}" font-size="10" font-weight="700" font-family="monospace">${projectedFame.toLocaleString()}</text>`;

  // Bottom labels — always show all 6
  labels.forEach((lbl, i) => {
    const labelColor = (i < WAR_DAYS && !dayHasData[i]) ? 'rgba(150,150,150,0.35)' : C_DIM;
    svgBars += `<text x="${barCx(i).toFixed(1)}" y="${baseY + 13}" text-anchor="middle" fill="${labelColor}" font-size="8" font-family="monospace" letter-spacing="0.5">${lbl}</text>`;
  });

  // Dotted horizontal lines for completed days — line only, color matches bar
  let svgDotted = '';
  for (let d = 0; d < WAR_DAYS; d++) {
    if (!dayHasData[d]) continue;
    const dayDone = warComplete || d < currentDay - 1;
    if (!dayDone) continue;
    const val = cumFameByDay[d];
    if (val <= 0) continue;
    const dy = yScale(val).toFixed(1);
    const lineColor = dayBarColor(perDayFame[d]);
    // Line only — score is already shown on top of each day's bar
    svgDotted += `<line x1="${PROJ_PAD.left}" y1="${dy}" x2="${PROJ_SVG_W - PROJ_PAD.right}" y2="${dy}" stroke="${lineColor}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.55"/>`;
  }

  const svgChart = `<svg width="100%" viewBox="0 0 ${PROJ_SVG_W} ${PROJ_SVG_H}" style="overflow:visible">`
    + [0.25, 0.5, 0.75, 1].map(f => {
        const y = yScale(projMax * f).toFixed(1);
        return `<line x1="${PROJ_PAD.left}" y1="${y}" x2="${PROJ_SVG_W - PROJ_PAD.right}" y2="${y}" stroke="${C_BORDER}" stroke-width="1"/>`
          + `<text x="${PROJ_SVG_W - PROJ_PAD.right + 4}" y="${y}" fill="${C_DIM}" font-size="9" dominant-baseline="middle" font-family="monospace">${Math.round(projMax * f).toLocaleString()}</text>`;
      }).join('')
    + svgDotted
    + `<line x1="${PROJ_PAD.left}" y1="${avgY}" x2="${PROJ_SVG_W - PROJ_PAD.right}" y2="${avgY}" stroke="rgba(180,180,180,0.5)" stroke-width="2" stroke-dasharray="5,3"/>`
    + `<text x="${PROJ_SVG_W - PROJ_PAD.right + 4}" y="${parseFloat(avgY) - 8}" fill="rgba(180,180,180,0.7)" font-size="9" font-family="monospace">AVG ${historicalClanAvg.toLocaleString()}</text>`
    + svgBars
    + `</svg>`;

  return `<div class="projection-wrap">`
    + `<div class="projection-title">WAR PROJECTION`
    + `<div class="proj-legend"><div class="proj-legend-dot" style="background:rgba(100,160,240,0.7)"></div>Daily Fame</div>`
    + `<div class="proj-legend"><div class="proj-legend-dot" style="background:${C_BLUE}"></div>Current Total</div>`
    + `<div class="proj-legend"><div class="proj-legend-dot" style="background:${projColor}"></div>Projected</div>`
    + `<div class="proj-legend"><div class="proj-legend-dot" style="background:rgba(180,180,180,0.5)"></div>Hist. Avg (${windowLabel})</div>`
    + `</div>`
    + svgChart
    + `<div style="margin-top:12px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-dim)">`
    + `${totalDecksUsed}/${maxTotalDecks} battles used · ${famePerDeck.toFixed(0)} fame/battle · ${remainingDecks} battles remaining`
    + `</div>`
    + `<div style="margin-top:8px;display:flex;align-items:center;gap:8px">`
    + `<span style="font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">Projection Accuracy</span>`
    + `<span style="font-family:Share Tech Mono,monospace;font-size:13px;font-weight:700;color:${accuracyColor}">${projAccuracy.toFixed(1)}%</span>`
    + `<span style="font-family:Share Tech Mono,monospace;font-size:9px;color:var(--text-dim)">(${totalDecksUsed} of ${maxTotalDecks} battles completed)</span>`
    + `</div>`
    + `</div>`;
}

// Main Live mode render -- calls the three section builders above.
function renderLive() {
  // See renderData()'s note -- the mobile controls are real elements
  // hosted inside #main, so they must be parked before it's replaced.
  parkTabControls();
  const ctrlBanner = tabControlBannerHtml('live');

  const apiWarStarted = warHasStarted();

  // The current CR API war data resets to 0 fame between wars (training day or
  // the gap before the next war's Day 1 begins). If that's the case but the LIVE
  // sheet still has last week's completed-war data, fall back to showing that
  // instead of an empty page -- this is what lets leaders review the past war
  // for a few days before the next one starts.
  const sheetHasData = Object.keys(LIVE_SHEET_DATA).length > 0
    && Object.values(LIVE_SHEET_DATA).some(s => (s.totalDecks || 0) > 0);

  if (!Object.keys(LIVE_DATA).length && !sheetHasData) {
    // Banner still rendered here: the sort/window/card-debug controls it
    // hosts on mobile are this tab's ONLY access point to them, so an
    // empty-data state must not strand them off-screen.
    document.getElementById('main').innerHTML = ctrlBanner
      + '<div class="graphic-placeholder"><span class="graphic-placeholder-icon">&#x26A1;</span>NO LIVE WAR DATA AVAILABLE<br><br>'
      + '<span style="font-size:11px;opacity:0.6">War runs Thursday-Sunday.</span></div>';
    mountTabControls();
    return;
  }

  // Decide which data source to render from:
  //  - If the API shows an active war (fame > 0 this period) -> use live API data.
  //  - Otherwise, if the LIVE sheet still has a completed war recorded -> show that
  //    as a read-only review of the most recent war.
  const usingSheetFallback = !apiWarStarted && sheetHasData;

  let sortedPlayers, currentDay, warStarted;

  if (usingSheetFallback) {
    // Keep a player here only if they battled at least once during the war
    // (real decks > 0, so someone who contributed Day 1 then left/was kicked
    // still shows), OR they're still a current member today (so someone who
    // stayed all war but had a bad week still shows). Drop anyone who both
    // never battled AND isn't in the clan anymore -- LIVE_SHEET_DATA can
    // carry a real 0-battle snapshot row for someone the whole war even when
    // they weren't a meaningful part of it, and showing that combined with
    // an OUT tag is exactly the confusing case this excludes.
    const rosterLoaded = Object.keys(LIVE_ROLES).length > 10;
    sortedPlayers = Object.values(LIVE_SHEET_DATA)
      .filter(s => {
        if ((s.totalDecks || 0) > 0) return true;
        if (!rosterLoaded) return true; // can't verify membership -- don't hide
        const key = s.name.toLowerCase();
        return !!LIVE_ROLES[key] || SWAPPER_NAMES.has(key);
      })
      .map(s => ({
        name: s.name,
        fame: s.totalFame || 0,
        decksUsed: s.totalDecks || 0,
        decksUsedToday: 0
      })).sort((a, b) =>
        liveSort === 'alpha' ? a.name.localeCompare(b.name) : b.fame - a.fame
      );
    currentDay = MAX_DECKS_PER_WAR / DECKS_PER_DAY; // last day -- war is complete
    warStarted = true; // treat as a completed war for card styling purposes
  } else {
    // The CR API includes all clan members in participants[], even those who
    // never played a single battle. Filter to actual war participants only.
    // Include ALL current clan members so leaders can see who hasn't battled yet.
    // Merge LIVE_DATA (has fame/deck info) with LIVE_ROLES (all current members).
    const liveByKey = {};
    // Start with LIVE_DATA: includes all war participants (current + kicked mid-war).
    // Keep kicked players (not in LIVE_ROLES) ONLY if they actually battled (Option A):
    // this preserves swapper accounts who join/leave mid-war with real decks.
    Object.values(LIVE_DATA).forEach(p => {
      const key = p.name.toLowerCase();
      const inRoster = !!LIVE_ROLES[key] || SWAPPER_NAMES.has(key);
      const hasBattled = (p.fame || 0) > 0 || (p.decksUsed || 0) > 0;
      if (inRoster || hasBattled) {
        liveByKey[key] = p;
      }
    });
    // Add current clan members missing from LIVE_DATA (haven't battled yet).
    Object.keys(LIVE_ROLES).forEach(key => {
      if (!liveByKey[key]) {
        const playerObj = PLAYERS.find(p => p.name.toLowerCase() === key);
        const displayName = playerObj ? playerObj.name : key;
        liveByKey[key] = { name: displayName, fame: 0, decksUsed: 0, decksUsedToday: 0 };
      }
    });
    sortedPlayers = Object.values(liveByKey)
      .sort((a, b) =>
        liveSort === 'alpha' ? a.name.localeCompare(b.name) : b.fame - a.fame
      );
    currentDay = computeCurrentDay(LIVE_DATA);
    warStarted = apiWarStarted;
  }

  const completeCount = sortedPlayers.filter(p => (p.decksUsed || 0) >= MAX_DECKS_PER_WAR).length;

  const dayCols = [0, 1, 2, 3]
    .map(dayIdx => buildLiveDayColumn(dayIdx, sortedPlayers, currentDay, warStarted, usingSheetFallback))
    .join('');

  const reviewBanner = usingSheetFallback
    ? '<div style="background:rgba(240,180,41,0.1);border:1px solid rgba(240,180,41,0.3);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-family:Share Tech Mono,monospace;font-size:11px;color:var(--gold);letter-spacing:1px">'
      + '&#x1F4CB; REVIEWING LAST WAR -- new battles have not started yet</div>'
    : '';

  // The summary box's metrics (battles missed %, placement, grade, etc.) are
  // only meaningful once the war is essentially complete -- showing them on
  // Day 1-3 produces misleading/premature numbers. Only render it once we're
  // on the final day (live, Day 4) or reviewing a fully completed past war.
  // The summary box's metrics (battles missed %, placement, grade, etc.) are
  // only meaningful once the war is essentially complete -- showing real
  // numbers on Day 1-3 would be premature/misleading. Instead of hiding the
  // section entirely, show the same card layout with "-" placeholders and a
  // note that the war is still in progress, so the page doesn't jump/shift
  // once Day 4 arrives.
  const showSummaryBox = usingSheetFallback || currentDay >= WAR_DAYS;
  const summaryBoxHtml = showSummaryBox
    ? buildWarSummaryBox(sortedPlayers, currentDay, usingSheetFallback)
    : buildWarSummaryPlaceholder();

  document.getElementById('main').innerHTML =
    ctrlBanner
    + reviewBanner
    + summaryBoxHtml
    + '<div class="live-war-grid">' + dayCols + '</div>'
    + buildProjectionWidget(sortedPlayers, currentDay, usingSheetFallback)
    + '<div class="g-section-hdr">War Summary -- ' + completeCount + '/' + sortedPlayers.length + ' completed all 16 battles</div>'
    + buildWarSummaryTable(sortedPlayers, currentDay, usingSheetFallback);

  mountTabControls(); // main.js -- fills the banner above on mobile
  attachLiveCardHighlight();
}

// Currently pinned (clicked) card element on the Live tab's day grid, or
// null. A single DOM element, not a player name -- the highlight is scoped
// to the exact card clicked (one specific player on one specific day), not
// every card that player has across other days. Module-level rather than
// per-container since there's only ever one grid on this tab (unlike the
// Graphic tab's several independent charts).
let LIVE_PINNED_CARD = null;

// Wires up the "hover or click a card to highlight it" interaction --
// reuses the exact .search-match visual the search box already applies
// (raised card + color tint per complete/partial/incomplete), just driven
// by hover/click instead of typed text. Purely a DOM class toggle: never
// touches searchStr or calls render(), so it can't affect the summary
// table's search-filtered row count or any other tab.
//
// Uses native, delegated mouseover/mouseout (bubbling equivalents of
// enter/leave) on the grid -- safe to do now because the "raised" visual
// (see .search-match CSS) transforms .live-card-inner, a CHILD, not
// .live-player-card itself. .live-player-card (the element these
// listeners actually target) never physically moves, so there is no
// feedback loop to guard against and no position cache needed at all.
//
// This replaced an earlier version that raised .live-player-card directly
// and hit-tested a bounding-box cache taken up front (to dodge exactly
// that feedback loop). That cache was a real, ongoing source of bugs: any
// scroll/resize/font-swap it didn't perfectly track in time desynced it
// from the live layout, and a reported bug (the highlighted card landing
// several rows from the cursor, while clicks -- native, uncached --
// still landed correctly) never fully went away across multiple attempts
// to patch the recache triggers. Moving the transform onto a child
// removes the cache's reason to exist instead of trying to keep it
// perfectly in sync -- there's nothing left that can desync.
function attachLiveCardHighlight() {
  const grid = document.querySelector('.live-war-grid');
  if (!grid) return;
  LIVE_PINNED_CARD = null;

  const showCard = (card) => card.classList.add('search-match');
  // Never un-highlight a card the SEARCH BOX itself matched -- only a card
  // highlighted purely by hover/pin should ever be removed here. Without
  // this, moving the mouse over/off a search-matched card would visually
  // un-select it, even though the search box's own filter never changed.
  const hideCard = (card) => { if (card.dataset.searchMatch !== '1') card.classList.remove('search-match'); };

  const allCards = [...grid.querySelectorAll('.live-player-card[data-name]')];
  allCards.forEach(card => {
    if (card.classList.contains('future-day')) {
      // Day hasn't started -- there's no battle to preview or drill into.
      // stopPropagation so a click doesn't even bubble up to the grid's
      // "click empty space closes the modal" handler below; otherwise
      // clicking a future card would silently close an open modal, which
      // isn't "nothing happens" either.
      card.addEventListener('click', (e) => e.stopPropagation());
    }
  });

  const cards = allCards.filter(c => !c.classList.contains('future-day'));

  let activeCard = null;
  grid.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.live-player-card');
    if (!card || card.classList.contains('future-day') || card === activeCard) return;
    if (activeCard && activeCard !== LIVE_PINNED_CARD) hideCard(activeCard);
    activeCard = card;
    showCard(activeCard);
  });
  grid.addEventListener('mouseout', (e) => {
    const from = e.target.closest('.live-player-card');
    if (!from || from !== activeCard) return;
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.live-player-card');
    if (from === to) return; // moved to a child of the same card -- still hovering it
    if (activeCard !== LIVE_PINNED_CARD) hideCard(activeCard);
    activeCard = null;
  });

  cards.forEach(card => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      if (LIVE_PINNED_CARD === card) {
        closeBattleDetailModal();
      } else {
        if (LIVE_PINNED_CARD) hideCard(LIVE_PINNED_CARD);
        LIVE_PINNED_CARD = card;
        showCard(card);
        showBattleDetailModal(decodeURIComponent(card.dataset.name), Number(card.dataset.dayIdx));
      }
    });
  });

  // Clicking empty grid space (not on a card) releases whatever's pinned --
  // the only dismissal path on touch devices, which have no hover.
  grid.addEventListener('click', () => closeBattleDetailModal());
}

// ══════════════════════════════════════════════════════
//  BATTLE DETAIL MODAL — click a player's card on a given day to see that
//  day's deck-by-deck breakdown (deck used, win/loss/draw, opponent clan),
//  fed by BATTLE_LOG (state.js) -- see parseBattleLogSheet() (parse.js) for
//  where that data comes from and its limits (current war only).
// ══════════════════════════════════════════════════════

// Pure calculation for one player's one-day battle breakdown. Zero HTML.
// Always returns exactly DECKS_PER_DAY slots, real battles first (oldest
// first, matching real deck-slot order) and any remaining slots marked
// unused -- so a partially-played day shows its real battles plus however
// many "not used" slots are left, and a day with zero data shows 4 unused
// slots plus hasAnyData:false for the empty-state message.
function calcBattleDetail(name, dayIdx) {
  const entry = BATTLE_LOG[name.toLowerCase()];
  const real = (entry && entry.days[dayIdx]) || [];
  // All-time per-deck usage/win/loss, keyed the same order-independent way
  // parseBattleLogSheet() (parse.js) builds DECK_STATS -- looked up per
  // slot so each real battle can show "how has THIS deck done overall",
  // not just this one result.
  const deckList = (DECK_STATS[name.toLowerCase()] || {}).decks || [];
  const lookupStats = cards => {
    const deckKey = cards.map(c => c.name).sort().join('|');
    return deckList.find(d => d.cards.map(c => c.name).sort().join('|') === deckKey);
  };
  const slots = Array.from({ length: DECKS_PER_DAY }, (_, i) => {
    const b = real[i];
    if (!b) return { used: false };

    // Legacy rows recorded before the Apps Script's per-round fix still
    // merge an entire duel's 2-3 games into ONE row with a 16/24-card deck
    // and one aggregate result (a real, confirmed Supercell API quirk on
    // the old per-duel-not-per-game fetch) -- split for display, but this
    // one row can only ever fill this one slot (the sheet never recorded
    // the other games as their own rows, so there's no way to recover how
    // many of the player's 4 daily deck-uses it actually cost).
    if (b.deck.length > 8) {
      const chunks = [];
      for (let c = 0; c < b.deck.length; c += 8) chunks.push(b.deck.slice(c, c + 8));
      const decks = chunks.map((cards, gi) => {
        const stats = lookupStats(cards);
        return {
          cards, result: gi === 0 ? b.result : null,
          crownsFor: gi === 0 ? b.crownsFor : null, crownsAgainst: gi === 0 ? b.crownsAgainst : null,
          deckUsage: stats ? stats.usage : 1, deckWins: stats ? stats.wins : 0, deckLosses: stats ? stats.losses : 0
        };
      });
      return {
        used: true, result: b.result, crownsFor: b.crownsFor, crownsAgainst: b.crownsAgainst,
        decks, opponentClanName: b.opponentClanName, duelContext: null
      };
    }

    const stats = lookupStats(b.deck);
    const decks = [{
      cards: b.deck, result: b.result, crownsFor: b.crownsFor, crownsAgainst: b.crownsAgainst,
      deckUsage: stats ? stats.usage : 1, deckWins: stats ? stats.wins : 0, deckLosses: stats ? stats.losses : 0
    }];

    // A River Race Duel plays 2-3 games back-to-back, each consuming its
    // OWN one of the day's 4 real deck-uses (confirmed: a duel is never a
    // single deck-use no matter how many games it takes -- a day can be,
    // say, 2 duel games + 2 separate normal battles, using all 4). So each
    // game is its own numbered slot here just like a normal battle, never
    // collapsed together. Games belonging to the same duel share one
    // BATTLE_TIME (the Apps Script writes them together) -- group by that
    // ONLY to show which game of the duel this is and the running score so
    // far, never to merge slots.
    const duelGames = real.filter(r => r.battleTime === b.battleTime);
    let duelContext = null;
    if (duelGames.length > 1) {
      const idx = duelGames.indexOf(b);
      const upToNow = duelGames.slice(0, idx + 1);
      duelContext = {
        gameNum: idx + 1, totalGames: duelGames.length,
        scoreWins: upToNow.filter(g => g.result === 'win').length,
        scoreLosses: upToNow.filter(g => g.result === 'loss').length
      };
    }

    return {
      used: true, result: b.result, crownsFor: b.crownsFor, crownsAgainst: b.crownsAgainst,
      decks, opponentClanName: b.opponentClanName, duelContext, battleTime: b.battleTime
    };
  });
  return { name, dayIdx, hasAnyData: !!entry, slots };
}

// Real Clash Royale crown icons (blue = ours, red = opponent's) supplied
// by Dunk -- assets/crowns/{blue,red}.png -- shown next to every crowns
// display (battle heading, and each individual game's own score within a
// duel) instead of a generic emoji/hand-drawn glyph.
function crownIconHtml(color, size) {
  return `<img class="battle-crown-icon" width="${size}" height="${Math.round(size * 0.75)}" src="assets/crowns/${color}.png" alt="">`;
}

// Elixir drop, drawn inline rather than shipped as an image: unlike the
// crowns (real supplied art, assets/crowns/), there's no elixir asset in
// this repo, and a drop is simple enough that an SVG needs no file, no
// cache entry, and no onerror fallback chain.
function elixirIconHtml(size) {
  return `<svg class="deck-elixir-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.2c4.6 5.2 7.2 8.7 7.2 12A7.2 7.2 0 0 1 12 21.4a7.2 7.2 0 0 1-7.2-7.2c0-3.3 2.6-6.8 7.2-12z" fill="#c452d6" stroke="#7d1f8c" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M9.4 13.6c0-2 1-3.7 2.3-5.3" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

// Average elixir cost of one deck, from CARD_ELIXIR (config.js).
// Averages only over cards with a known cost -- Mirror has no fixed cost
// at all (see CARD_ELIXIR's comment) and a brand-new card can legitimately
// be missing until the manifest is updated by hand, and in both cases the
// other cards' real average is more useful than no number. Returns null
// only when nothing in the deck is known.
function calcDeckAvgElixir(cards) {
  const costs = (cards || [])
    .map(c => CARD_ELIXIR[c.name])
    .filter(v => typeof v === 'number');
  if (!costs.length) return null;
  return costs.reduce((a, b) => a + b, 0) / costs.length;
}

// Maps a card's display name to its image filename slug, matching the
// convention used when the asset files (assets/cards/, .../evo/,
// .../tower/) were organized: lowercase, periods stripped (so
// "P.E.K.K.A" -> "pekka", "Mini P.E.K.K.A" -> "mini-pekka"), everything
// else collapsed to hyphens. Not every one of the 122 official cards has
// art yet -- see CLAUDE.md for the current gap list -- so this is never
// trusted blindly; every <img> using it has an onerror fallback below
// rather than checking a whitelist here.
function cardImageSlug(name) {
  return (name || '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Renders 8 (or however many) cards as a single scannable row. Each card is
// { name, special }, special being 'evo' | 'hero' | null (see
// parseBattleLogSheet(), parse.js). Real card art with a text-name
// fallback if a given card's image is missing (onerror, not a whitelist,
// so newly added art just works without a code change).
//
// Evolutions: assets/cards/evo/{slug}.png is NOT a small transparent decal
// meant to sit on top of the base art -- it's a full, standalone alternate
// card image (own scene, own baked-in frame/border), confirmed by opening
// one directly. Layering it over the base image (the original approach)
// showed both images' frames/edges at once, a real visible bug ("card
// displayed with the evo over the normal card img"). It now REPLACES the
// base image outright for an evo card, with onerror falling back to the
// base art and then to the text name, instead of drawing both at once.
// object-fit:cover (not contain) crops these full-card images to fill the
// slot -- most carry a lot of decorative padding around the actual
// character (confirmed by opening several), and contain was rendering the
// character noticeably smaller than a plain card's.
function buildDeckCardRow(cards) {
  const cardsHtml = cards.map(c => {
    const slug = cardImageSlug(c.name);
    const primarySrc = c.special === 'evo' ? `assets/cards/evo/${slug}.png` : `assets/cards/${slug}.png`;
    const baseSrc = `assets/cards/${slug}.png`;
    // onerror chain: evo art fails -> retry with base art (re-arming
    // onerror first so a base-art failure too falls through to the text
    // fallback, not a broken image icon) -> base art also fails -> hide
    // the <img> and reveal the sibling text-name fallback div.
    const onerror = c.special === 'evo'
      ? `onerror="this.onerror=function(){this.style.display='none'; this.nextElementSibling.style.display='flex';}; this.src='${baseSrc}';"`
      : `onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"`;
    // The special-flag badge (EVO/HERO) sits OUTSIDE .deck-card-slot, in
    // .deck-card-wrap's own padding-top -- .deck-card-slot needs
    // overflow:hidden to clip the card image to its rounded box, which
    // was clipping this badge too when it lived inside that box.
    const specialTag = c.special === 'evo' ? '<span class="deck-card-tag deck-card-tag-evo">EVO</span>'
      : c.special === 'hero' ? '<span class="deck-card-tag deck-card-tag-hero">HERO</span>' : '';
    return `<div class="deck-card-wrap">
      ${specialTag}
      <div class="deck-card-slot">
        <img class="deck-card-img${c.special === 'evo' ? ' deck-card-img-cover' : ''}" src="${primarySrc}" alt="${c.name}" ${onerror}>
        <div class="deck-card-fallback"><span class="deck-card-name">${c.name}</span></div>
      </div>
    </div>`;
  }).join('');
  return `<div class="deck-card-row">${cardsHtml}</div>`;
}

// Render the battle detail modal's inner box from calcBattleDetail()'s
// output. Structured as ONE card: a header banner for the player+day, and
// a body holding one row per battle -- each row's own heading (battle
// number / result / crowns) sits directly on the card body, with just the
// deck itself inside a separate dark-silver inlay well.
function buildBattleDetailModal(name, dayIdx) {
  const d = calcBattleDetail(name, dayIdx);

  // Slots the player genuinely didn't reach that day (e.g. only 3 of 4
  // real deck-uses happened) are skipped entirely now, not rendered as an
  // empty "Not used" placeholder bar -- per explicit feedback, a battle
  // that was never played shouldn't take up space in the popup at all.
  const usedSlots = d.slots.filter(s => s.used);

  // A REAL per-game duel (s.duelContext -- see calcBattleDetail()) writes
  // each of its 2-3 games as its OWN slot, sharing one BATTLE_TIME. Group
  // those consecutive slots together here, for DISPLAY only, so every game
  // in a duel renders inside ONE shared sunk inlay instead of each getting
  // its own separate one -- calcBattleDetail()/the slot data itself is
  // unchanged. A legacy merged-duel row (multiGame but no duelContext,
  // already a single slot) and every normal battle are untouched: each
  // still forms its own one-slot group below.
  const groups = [];
  usedSlots.forEach((s, i) => {
    const last = groups[groups.length - 1];
    if (s.duelContext && last && last.items[0].s.duelContext && last.items[0].s.battleTime === s.battleTime) {
      last.items.push({ s, i });
    } else {
      groups.push({ items: [{ s, i }] });
    }
  });

  // Renders ONE slot's own heading (label/result/crowns) + body (opponent
  // line, legacy note, deck row(s), usage bar) -- identical content/markup
  // to before this change, just factored out so a grouped duel can nest
  // several of these inside one shared inlay instead of each getting its
  // own. The result span always carries an explicit battle-result-{win|
  // loss|draw} class (see the matching CSS) rather than relying solely on
  // the ancestor .battle-row's own win/loss/draw class for color -- once a
  // duel's games are nested inside a shared wrapper whose OWN class is the
  // duel's FINAL result, a single game's own (possibly different) result
  // needs to color itself regardless of what the wrapper around it says.
  function renderSlotParts(s, i) {
    const resultClass = s.result === 'win' ? 'battle-win' : s.result === 'loss' ? 'battle-loss' : 'battle-draw';
    const resultLabel = s.result === 'win' ? 'WIN' : s.result === 'loss' ? 'LOSS' : 'DRAW';
    // s.decks has more than one entry ONLY for a legacy merged-duel row
    // (recorded before the Apps Script's per-round fix) -- split into
    // per-chunk "GAME n" sub-rows since there's no real per-chunk result
    // to show at a top-level heading instead. A real per-game duel row (or
    // a normal battle) always has exactly one deck here.
    const multiGame = s.decks.length > 1;
    // Any slot using more than one deck is a Duel (either a real per-game
    // duel row via s.duelContext, or a legacy merged row split into
    // chunks) -- labeled "DUEL" instead of "BATTLE N" with a soft gold
    // header, so it reads as visibly different from a normal battle.
    const isDuel = !!s.duelContext || multiGame;
    // A Duel is decided by GAMES WON out of 3 (first to 2), never by
    // crowns -- Dunk's own correction after an earlier version showed
    // total crowns here as if it were the duel score. s.duelContext (a
    // REAL per-game duel row -- see calcBattleDetail()) carries the
    // running games-won/lost tally through this specific game, shown
    // plainly in the row's own LABEL, with no crown icon anywhere near
    // it. This is separate from the heading's WIN/LOSS + crowns on the
    // right, which is this ONE game's own real result -- exactly like a
    // normal battle, per Dunk's explicit ask, and unrelated to the duel's
    // running score shown in the label.
    const rowLabel = s.duelContext ? `DUEL ${s.duelContext.scoreWins}-${s.duelContext.scoreLosses}`
      : isDuel ? 'DUEL' : `Battle ${i + 1}`;
    const duelLabel = s.duelContext ? ` · Game ${s.duelContext.gameNum}/${s.duelContext.totalGames}` : '';
    const oppHtml = s.opponentClanName ? `<div class="battle-slot-opp">vs ${s.opponentClanName}${duelLabel}</div>` : '';
    // multiGame with NO duelContext means this is a legacy merged-duel row
    // (recorded before the Apps Script's per-round fix) -- the sheet only
    // ever recorded ONE result/crowns figure for the WHOLE duel, so there
    // is genuinely no way to know which of these games individually won
    // or lost, or the real games-won score (a duel is decided by games
    // won, not crowns, and this row's crowns are a total-across-all-games
    // figure -- not even reliably the right sign for who actually won).
    // Say so plainly, and explain why each game's usage bar below can't
    // show a win/loss color either, instead of leaving both looking
    // broken with no explanation.
    const legacyNoteHtml = (multiGame && !s.duelContext)
      ? `<div class="battle-legacy-note">This duel was recorded before per-game tracking was live for this war -- only one overall result/crowns figure exists for the whole duel (shown above), not a real games-won score, and not attributable to any specific game below. Each deck's usage bar shows usage only, with no win/loss color, for the same reason. New duels will show real per-game data once the current Apps Script (apps-script/war-data-layer.gs) is pasted into the Apps Script editor -- this is a separate manual step from deploying the site.</div>` : '';

    const decksHtml = s.decks.map((deck, gi) => {
      // All-time win/loss split for THIS specific deck (draws excluded from
      // this bar on purpose -- a full win/draw/loss breakdown is planned as
      // a deeper Analyze-tab feature later, this is just a quick at-a-glance
      // signal). wlTotal 0 (deck's only result so far was a draw) renders an
      // empty track rather than dividing by zero.
      const wlTotal = deck.deckWins + deck.deckLosses;
      const deckWinPct = wlTotal ? (deck.deckWins / wlTotal) * 100 : 0;
      const deckLossPct = wlTotal ? 100 - deckWinPct : 0;
      const winPctLabel = wlTotal ? `${Math.round(deckWinPct)}%` : '—';
      const gameHeading = multiGame
        ? `<div class="battle-game-heading"><span class="battle-game-label">Game ${gi + 1}</span></div>` : '';
      return `${gameHeading}
        ${buildDeckCardRow(deck.cards)}
        <div class="deck-usage-row">
          <span class="deck-usage-count">${deck.deckUsage}</span>
          <div class="deck-usage-bar">
            <div class="deck-usage-bar-win"  style="width:${deckWinPct}%"></div>
            <div class="deck-usage-bar-loss" style="width:${deckLossPct}%"></div>
          </div>
          <span class="deck-usage-winpct">${winPctLabel}</span>
        </div>`;
    }).join('<div style="height:14px"></div>');

    const crownsHtml = `${crownIconHtml('blue', 22)}${s.crownsFor}-${s.crownsAgainst}${crownIconHtml('red', 22)}`;
    const headingHtml = `<div class="battle-row-heading">
        <span class="battle-row-num">${rowLabel}</span>
        <span class="battle-row-result battle-result-${s.result}">${resultLabel} <span class="battle-row-crowns">${crownsHtml}</span></span>
      </div>`;
    const bodyHtml = `${oppHtml}${legacyNoteHtml}${decksHtml}`;
    return { resultClass, isDuel, headingHtml, bodyHtml };
  }

  const slotsHtml = groups.map(g => {
    if (g.items.length === 1) {
      const { s, i } = g.items[0];
      const p = renderSlotParts(s, i);
      return `<div class="battle-row ${p.resultClass}${p.isDuel ? ' battle-duel' : ''}">
        ${p.headingHtml}
        <div class="battle-deck-inlay">${p.bodyHtml}</div>
      </div>`;
    }

    // A real grouped duel (2-3 games sharing one BATTLE_TIME): every
    // game's own heading + crowns + deck + win/loss bar (renderSlotParts,
    // unchanged) sits inside ONE shared inlay; the OUTER heading is new --
    // it shows the duel's FINAL games-won score (never a mid-duel running
    // score, never crowns -- a duel is decided by games won, not crowns),
    // taken from the last game's cumulative duelContext tally.
    const final = g.items[g.items.length - 1].s.duelContext;
    const finalResult = final.scoreWins > final.scoreLosses ? 'win' : final.scoreLosses > final.scoreWins ? 'loss' : 'draw';
    const finalLabel = finalResult === 'win' ? 'WIN' : finalResult === 'loss' ? 'LOSS' : 'DRAW';
    const innerHtml = g.items.map(({ s, i }) => {
      const p = renderSlotParts(s, i);
      return `${p.headingHtml}${p.bodyHtml}`;
    }).join('<div style="height:14px"></div>');

    return `<div class="battle-row battle-duel battle-${finalResult}">
      <div class="battle-row-heading">
        <span class="battle-row-num">DUEL ${final.scoreWins}-${final.scoreLosses}</span>
        <span class="battle-row-result battle-result-${finalResult}">${finalLabel}</span>
      </div>
      <div class="battle-deck-inlay">${innerHtml}</div>
    </div>`;
  }).join('');

  const emptyStateHtml = !usedSlots.length ? `<div class="battle-modal-empty">No battle data recorded</div>` : '';

  return `<div class="battle-modal-box" onclick="event.stopPropagation()">
    <div class="battle-modal-header">
      <span class="battle-modal-title">${d.name} — Day ${dayIdx + 1}</span>
      <button class="battle-modal-close" onclick="closeBattleDetailModal()">&times;</button>
    </div>
    <div class="battle-modal-content">
      ${emptyStateHtml}
      <div class="battle-slots">${slotsHtml}</div>
    </div>
  </div>`;
}

function showBattleDetailModal(name, dayIdx) {
  const overlay = document.getElementById('battle-detail-modal');
  if (!overlay) return;
  overlay.innerHTML = buildBattleDetailModal(name, dayIdx);
  overlay.classList.remove('hidden');
  syncPageScrollLock(); // main.js -- freeze the page behind the popup
}

// The modal and the pinned card's highlight are one concept, not two --
// closing the modal (× button, clicking outside it, clicking the same
// card again, or clicking empty grid space) always releases the pin too.
// Safe to call when nothing is open/pinned (e.g. clicking empty space with
// nothing pinned yet).
function closeBattleDetailModal() {
  const overlay = document.getElementById('battle-detail-modal');
  if (overlay) overlay.classList.add('hidden');
  syncPageScrollLock(); // main.js -- release the page (no-op if nothing was locked)
  if (LIVE_PINNED_CARD) {
    // Same search-match guard as hideCard() in attachLiveCardHighlight() --
    // don't undo the search box's own highlight just because the pin tied
    // to it is being released.
    if (LIVE_PINNED_CARD.dataset.searchMatch !== '1') LIVE_PINNED_CARD.classList.remove('search-match');
    LIVE_PINNED_CARD = null;
  }
}

// ══════════════════════════════════════════════════════
//  DECK HISTORY MODAL — Analysis tab's "Battle Info" button (buildCard(),
//  tab-analysis.js) opens this: every deck a player has EVER used
//  (all-time, from DECK_STATS -- the same all-time aggregation
//  calcBattleDetail() already looks up per-slot for "how has THIS deck
//  done overall"), each with the same usage count + win/loss-only bar
//  shown per-slot in the battle detail modal above. Lets a player scroll
//  back through everything they've played and how it performed, instead
//  of only ever seeing one specific day's decks. Reuses the same
//  .battle-modal-box/-header/-content chrome and buildDeckCardRow() for a
//  consistent look, but is a SEPARATE overlay (#deck-history-modal) with
//  its own show/close -- unlike battle-detail-modal, this one isn't tied
//  to a pinned Live-tab card's highlight state, so it needs none of that
//  bookkeeping.
// ══════════════════════════════════════════════════════

// Pure calculation: this player's all-time deck list, most-used first
// (DECK_STATS is already sorted that way -- see parseBattleLogSheet(),
// parse.js). Zero HTML.
function calcPlayerDeckHistory(name) {
  const entry = DECK_STATS[name.toLowerCase()];
  return { name, decks: entry ? entry.decks : [] };
}

// Tracks which player's modal is currently open so the sort buttons
// (setDeckHistorySort(), below) can re-render the SAME modal in place
// without needing the name threaded back through their own onclick.
let DECK_HISTORY_NAME = null;

// A 3-button group (like every other multi-way toggle in this app), not a
// single button that cycles blind through modes -- per explicit feedback,
// clicking one unknown state at a time with no visibility into the other
// options was a real, reported usability complaint.
function setDeckHistorySort(m) {
  deckHistorySortMode = m;
  if (DECK_HISTORY_NAME) showDeckHistoryModal(DECK_HISTORY_NAME);
}

// Pure sort -- doesn't mutate DECK_STATS' own array (which stays
// usage-sorted as the canonical order calcBattleDetail() also relies on).
function sortDeckHistoryList(decks, mode) {
  const arr = decks.slice();
  if (mode === 'winpct') {
    return arr.sort((a, b) => {
      const aTotal = a.wins + a.losses, bTotal = b.wins + b.losses;
      // A deck with zero decided games (win% undefined) sorts LAST, not
      // first -- -1 reads below any real 0%-100% win rate.
      const aPct = aTotal ? a.wins / aTotal : -1;
      const bPct = bTotal ? b.wins / bTotal : -1;
      return bPct !== aPct ? bPct - aPct : b.usage - a.usage;
    });
  }
  if (mode === 'active') {
    // Sorting purely by recency naturally puts a player's current ~4-deck
    // rotation at the top (their most recently played decks) with
    // everything else trailing off by last-used date -- no separate
    // "top 4" rule needed, that's just what this ordering produces.
    return arr.sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
  }
  return arr.sort((a, b) => b.usage - a.usage); // 'usage' (default)
}

// Small inline SVG line chart: one point per REAL war-day this deck had
// at least one decided (non-merged-duel) game, Y = that day's win rate
// (wins / (wins+losses), draws excluded same as the usage bar elsewhere).
// A day the deck wasn't used, or was only used in a merged-duel chunk
// with no attributable result, simply has no dayHistory entry (see
// parseBattleLogSheet(), parse.js) -- so a training week or a war this
// deck sat out never shows up as a flat run in the middle of the line,
// it's just skipped, keeping the trend itself readable. Line/dot color
// reflects the overall trend (second half of the points vs. the first
// half): green = improving, red = declining, gold = flat or too little
// data to tell. Native <title> tooltips per point need no JS hover wiring
// for a chart this small.
function buildDeckWinRateGraph(dayHistory) {
  const points = (dayHistory || [])
    .filter(d => d.wins + d.losses > 0)
    .map(d => ({ warId: d.warId, dayIndex: d.dayIndex, ratio: d.wins / (d.wins + d.losses) }));
  if (!points.length) return '<div class="deck-war-graph-empty">No decided games yet</div>';

  const W = 172, H = 62;
  const plotL = 26, plotR = W - 6, plotT = 6, plotB = H - 16;
  const n = points.length;
  const stepX = n > 1 ? (plotR - plotL) / (n - 1) : 0;
  const yFor = ratio => plotB - ratio * (plotB - plotT);
  const coords = points.map((p, i) => ({ ...p, x: plotL + stepX * i, y: yFor(p.ratio) }));

  let trendColor = 'var(--gold)';
  if (n >= 2) {
    const mid = Math.floor(n / 2) || 1;
    const firstAvg = coords.slice(0, mid).reduce((s, p) => s + p.ratio, 0) / mid;
    const secondAvg = coords.slice(mid).reduce((s, p) => s + p.ratio, 0) / (n - mid);
    if (secondAvg - firstAvg > 0.05) trendColor = 'var(--green)';
    else if (firstAvg - secondAvg > 0.05) trendColor = 'var(--red)';
  }

  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = coords.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.6" fill="${trendColor}"><title>War ${p.warId} Day ${p.dayIndex}: ${Math.round(p.ratio * 100)}% win rate</title></circle>`
  ).join('');
  const firstLbl = `W${coords[0].warId}D${coords[0].dayIndex}`;
  const lastLbl = `W${coords[n - 1].warId}D${coords[n - 1].dayIndex}`;

  return `<svg class="deck-war-graph" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <text x="1" y="${plotT + 5}" class="deck-graph-axis-lbl">100%</text>
    <text x="1" y="${plotB + 2}" class="deck-graph-axis-lbl">0%</text>
    <line x1="${plotL}" y1="${plotB.toFixed(1)}" x2="${plotR}" y2="${plotB.toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-width="1"/>
    <line x1="${plotL}" y1="${((plotT + plotB) / 2).toFixed(1)}" x2="${plotR}" y2="${((plotT + plotB) / 2).toFixed(1)}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="2,2"/>
    ${n > 1 ? `<path d="${linePath}" fill="none" stroke="${trendColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${dots}
    <text x="${plotL}" y="${H - 2}" class="deck-graph-x-lbl" text-anchor="start">${firstLbl}</text>
    ${n > 1 ? `<text x="${plotR}" y="${H - 2}" class="deck-graph-x-lbl" text-anchor="end">${lastLbl}</text>` : ''}
  </svg>`;
}

function buildDeckHistoryModal(name) {
  const d = calcPlayerDeckHistory(name);
  DECK_HISTORY_NAME = name;
  const sortedDecks = sortDeckHistoryList(d.decks, deckHistorySortMode);

  const rowsHtml = sortedDecks.map((deck, i) => {
    // Same win/loss-only bar as a per-slot deck in the battle detail
    // modal above (draws deliberately excluded there too -- see that
    // modal's own comment; this is the same all-time number, not a
    // different metric). A deck whose only uses were merged-duel chunks
    // (see parseBattleLogSheet()) never has any wins/losses recorded at
    // all -- 'none' (grey), not 'draw' (amber), since it isn't actually a
    // tied record, just an undecided one.
    const wlTotal = deck.wins + deck.losses;
    const winPct = wlTotal ? (deck.wins / wlTotal) * 100 : 0;
    const lossPct = wlTotal ? 100 - winPct : 0;
    const winPctLabel = wlTotal ? `${Math.round(winPct)}%` : '—';
    const recordResult = !wlTotal ? 'none' : deck.wins > deck.losses ? 'win' : deck.losses > deck.wins ? 'loss' : 'draw';
    const recordLabel = wlTotal ? `${deck.wins}-${deck.losses}` : '—';
    // Split rather than one combined average -- crowns won and crowns
    // lost tell a different story (a deck that wins by a lot vs. one that
    // wins narrowly but also concedes a lot both average out the same in
    // a single blended number).
    const avgCrownsWonLabel  = deck.crownedGames ? (deck.crownsFor / deck.crownedGames).toFixed(1) : '—';
    const avgCrownsLostLabel = deck.crownedGames ? (deck.crownsAgainst / deck.crownedGames).toFixed(1) : '—';
    // Deck composition, not battle history -- so unlike every other stat
    // in this row it's always available, even for a deck whose only games
    // were legacy merged-duel chunks with no attributable result.
    const avgElixir = calcDeckAvgElixir(deck.cards);
    const avgElixirLabel = avgElixir !== null ? avgElixir.toFixed(1) : '—';

    // usage can exceed wins+losses+draws whenever some of this deck's
    // uses came from a legacy merged-duel row (see parseBattleLogSheet())
    // -- those bump usage but have no attributable individual result.
    // Same "clarify, don't hide" precedent as the battle detail modal's
    // own .battle-legacy-note for the identical underlying limitation.
    const unattributed = deck.usage - (deck.wins + deck.losses + deck.draws);
    const unattributedNoteHtml = unattributed > 0
      ? `<div class="battle-legacy-note">${unattributed} of ${deck.usage} use${deck.usage === 1 ? '' : 's'} come from an older duel recording that didn't track individual game results, so the record above and the usage count below don't fully add up.</div>`
      : '';

    return `<div class="battle-row">
      <div class="battle-row-heading">
        <span class="battle-row-num">DECK ${i + 1}</span>
        <span class="battle-row-result battle-result-${recordResult}">${recordLabel}</span>
      </div>
      <div class="battle-deck-inlay">
        <div class="deck-history-row">
          <div class="deck-history-main">
            ${buildDeckCardRow(deck.cards)}
            ${unattributedNoteHtml}
            <div class="deck-usage-row">
              <span class="deck-usage-count">${deck.usage}</span>
              <div class="deck-usage-bar">
                <div class="deck-usage-bar-win"  style="width:${winPct}%"></div>
                <div class="deck-usage-bar-loss" style="width:${lossPct}%"></div>
              </div>
              <span class="deck-usage-winpct">${winPctLabel}</span>
            </div>
          </div>
          <div class="deck-history-side">
            <div class="deck-avg-crowns"><span class="deck-avg-crowns-row">${crownIconHtml('blue', 13)}<span class="deck-avg-crowns-val deck-avg-crowns-won">${avgCrownsWonLabel}</span></span><span class="deck-avg-crowns-lbl">Avg Won</span></div>
            <div class="deck-avg-crowns"><span class="deck-avg-crowns-row">${crownIconHtml('red', 13)}<span class="deck-avg-crowns-val deck-avg-crowns-lost">${avgCrownsLostLabel}</span></span><span class="deck-avg-crowns-lbl">Avg Lost</span></div>
            <div class="deck-avg-crowns"><span class="deck-avg-crowns-row">${elixirIconHtml(13)}<span class="deck-avg-crowns-val deck-avg-elixir-val">${avgElixirLabel}</span></span><span class="deck-avg-crowns-lbl">Avg Elixir</span></div>
            <div class="deck-war-graph-wrap">
              <div class="deck-war-graph-lbl">Win Rate Trend</div>
              ${buildDeckWinRateGraph(deck.dayHistory)}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const sortBtn = (m, label) =>
    `<button class="btn${deckHistorySortMode === m ? ' active' : ''}" onclick="setDeckHistorySort('${m}')">${label}</button>`;
  const controlsHtml = d.decks.length ? `<div class="deck-history-controls">
    <span class="deck-history-sort-lbl">Sort:</span>
    <div class="btn-group">
      ${sortBtn('winpct', 'Win %')}
      ${sortBtn('usage', 'Most Used')}
      ${sortBtn('active', 'Active')}
    </div>
  </div>` : '';

  const emptyStateHtml = !d.decks.length ? `<div class="battle-modal-empty">No battle data recorded</div>` : '';

  return `<div class="battle-modal-box" onclick="event.stopPropagation()">
    <div class="battle-modal-header">
      <span class="battle-modal-title">${d.name} — Deck History</span>
      <button class="battle-modal-close" onclick="closeDeckHistoryModal()">&times;</button>
    </div>
    <div class="battle-modal-content">
      ${controlsHtml}
      ${emptyStateHtml}
      <div class="battle-slots">${rowsHtml}</div>
    </div>
  </div>`;
}

function showDeckHistoryModal(name) {
  const overlay = document.getElementById('deck-history-modal');
  if (!overlay) return;
  overlay.innerHTML = buildDeckHistoryModal(name);
  overlay.classList.remove('hidden');
  syncPageScrollLock(); // main.js -- freeze the page behind the popup
}

function closeDeckHistoryModal() {
  const overlay = document.getElementById('deck-history-modal');
  if (overlay) overlay.classList.add('hidden');
  syncPageScrollLock();
  DECK_HISTORY_NAME = null;
}

// ══════════════════════════════════════════════════════
//  CARD ART DEBUG POPUP — on-demand visual audit tool (Live tab button),
//  not the always-on debug grid removed in an earlier patch. Shows every
//  official card art/tag exactly as it renders in a real deck popup
//  (reuses buildDeckCardRow()), labeled with its name + special flag, so
//  art can be spot-checked against name/tag whenever a new asset drop
//  needs verifying -- without leaving a permanent debug grid in the
//  Analysis tab or per-card labels in every real popup.
// ══════════════════════════════════════════════════════

// One labeled entry: the card exactly as buildDeckCardRow() renders it in
// a real popup (same art, same fallback chain, same EVO/HERO badge), plus
// a permanent name label underneath (which real popups deliberately do
// NOT have -- see buildDeckCardRow()'s own comment).
function buildCardDebugEntry(name, special) {
  const tagText = special === 'evo' ? ' (EVO)' : special === 'hero' ? ' (HERO)' : '';
  return `<div class="card-debug-entry">
    ${buildDeckCardRow([{ name, special }])}
    <div class="card-debug-label">${name}${tagText}</div>
  </div>`;
}

// Evo-capable cards get TWO entries (regular art + evo art) since the
// real popup now shows one OR the other depending on that specific
// battle (see buildDeckCardRow()'s "evo replaces base" comment) -- seeing
// both side by side is the point of this tool. Everything else (plain
// cards, champions) only has the one form.
function buildCardDebugGrid() {
  const entries = CARD_DEBUG_MANIFEST.flatMap(c => c.special === 'evo'
    ? [buildCardDebugEntry(c.name, null), buildCardDebugEntry(c.name, 'evo')]
    : [buildCardDebugEntry(c.name, c.special)]);
  return `<div class="card-debug-grid">${entries.join('')}</div>`;
}

function showCardDebugModal() {
  const overlay = document.getElementById('card-debug-modal');
  if (!overlay) return;
  const evoCount = CARD_DEBUG_MANIFEST.filter(c => c.special === 'evo').length;
  overlay.innerHTML = `<div class="battle-modal-box" onclick="event.stopPropagation()">
    <div class="battle-modal-header">
      <span class="battle-modal-title">Card Art Debug — ${CARD_DEBUG_MANIFEST.length} cards, ${evoCount} with evo art shown separately</span>
      <button class="battle-modal-close" onclick="closeCardDebugModal()">&times;</button>
    </div>
    <div class="battle-modal-content">${buildCardDebugGrid()}</div>
  </div>`;
  overlay.classList.remove('hidden');
  syncPageScrollLock(); // main.js -- freeze the page behind the popup
}

function closeCardDebugModal() {
  const overlay = document.getElementById('card-debug-modal');
  if (overlay) overlay.classList.add('hidden');
  syncPageScrollLock();
}

