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
    ourRank = recentStandings
      ? getAdjustedRank(recentStandings, WAR_STANDINGS[String(recentStandings.warId)])
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
function buildLiveDayColumn(dayIdx, sortedPlayers, currentDay, warStarted, isSheetReview = false) {
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

  // Count distinct contributing members for this day — current clan members only
  // (excludes REMOVED/kicked players from the 50-member cap count)
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

  // Text styles — high contrast white on colored header backgrounds
  const numStyle  = `font-family:Orbitron,monospace;font-weight:700;color:#ffffff`;
  const capStyle  = `font-family:'Share Tech Mono',monospace;color:rgba(255,255,255,0.7)`;
  const fameColor = isFuture ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.95)';
  const counterHtml = `<div class="live-day-label">${label} — ${statusLabel}</div>`
    + (isFuture
      ? `<div class="live-day-counter" style="color:rgba(255,255,255,0.5)">0<span style="${capStyle};font-size:10px">/${dayCap}</span></div>`
      : `<div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:2px">`
        + `<div style="display:flex;flex-direction:column;gap:3px">`
        + `<div style="${numStyle};font-size:18px;line-height:1">${dayBattles}<span style="${capStyle};font-size:11px">/${dayCap}</span></div>`
        + `<div style="${numStyle};font-size:13px;line-height:1;color:${memberColor}">${dayContributors}<span style="${capStyle};font-size:10px">/${MEMBER_CAP} members</span></div>`
        + `</div>`
        + `<div style="text-align:center;flex:1;padding:0 8px">`
        + `<div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:rgba(255,255,255,0.6);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:1px">fame</div>`
        + `<div style="${numStyle};font-size:16px;line-height:1;color:${fameColor}">${dayFame > 0 ? dayFame.toLocaleString() : '—'}</div>`
        + `</div>`
        + `<div style="text-align:right">`
        + `<div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:rgba(255,255,255,0.6);letter-spacing:0.5px;text-transform:uppercase;margin-bottom:1px">cumulative</div>`
        + `<div style="${numStyle};font-size:14px;line-height:1;color:rgba(255,255,255,0.85)">${cumBattles}<span style="${capStyle};font-size:10px">/${cumCap}</span></div>`
        + `</div>`
        + `</div>`
    );

  // ── Player cards (with row number) ────────────────────
  const cards = sortedPlayers.map((p, idx) => {
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
    const showDash   = isFuture && warStarted;
    const cardClass  = (isFuture && warStarted) ? 'future-day'
      : isComplete ? 'complete'
      : isPartial  ? 'partial'
      : 'incomplete';
    const todayClass  = isToday ? 'today-card' : '';
    const matchClass  = isMatch ? 'search-match' : '';
    const decksClass  = decks >= DECKS_PER_DAY ? 'full' : decks > 0 ? 'partial' : 'empty';

    // Look up the PLAYERS entry for tag detection
    const playerObj = PLAYERS.find(pl => pl.name.toLowerCase() === p.name.toLowerCase());
    const cardKey = p.name.toLowerCase();
    const tag = playerObj ? playerTag(playerObj)
      : SWAPPER_NAMES.has(cardKey) ? 'swapper'
      : (!LIVE_ROLES[cardKey] ? 'removed' : null);

    return `<div class="live-player-card ${cardClass} ${todayClass} ${matchClass}">`
      + `<span style="font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-dim);min-width:18px;text-align:right;margin-right:6px">${idx + 1}</span>`
      + `<span class="live-card-name">${p.name}${playerTagHtml(tag, 'dot')}</span>`
      + `<div class="live-card-right">`
      + `<span class="live-card-decks ${decksClass}">${showDash ? '-/4' : `${decks}/4`}</span>`
      + `<span class="live-card-fame">${showDash ? '-' : fame > 0 ? fame.toLocaleString() : '0'}</span>`
      + `</div></div>`;
  }).join('');

  return `<div class="live-day-col">`
    + `<div class="live-day-header ${headerClass}">${counterHtml}</div>`
    + cards
    + `</div>`;
}

// Build the war summary table at the bottom of Live mode (total battles + fame per player).
function buildWarSummaryTable(sortedPlayers, currentDay) {
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

    // Same tag lookup as the day-column cards, so swappers/new/removed
    // players are identifiable here too, not just in the day columns.
    const playerObj = PLAYERS.find(pl => pl.name.toLowerCase() === p.name.toLowerCase());
    const rowKey = p.name.toLowerCase();
    const rowTag = playerObj ? playerTag(playerObj)
      : SWAPPER_NAMES.has(rowKey) ? 'swapper'
      : (!LIVE_ROLES[rowKey] ? 'removed' : null);

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
function buildProjectionWidget(sortedPlayers, currentDay, warComplete = false) {
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

  // If no battles have been played yet, show a placeholder rather than a pure-history projection
  if (totalDecksUsed === 0 && totalFameNow === 0) {
    return `<div style="display:flex;align-items:center;justify-content:center;height:200px;font-family:'Share Tech Mono',monospace;font-size:13px;color:${C_DIM};letter-spacing:2px;">NO BATTLE DATA YET</div>`;
  }

  // War complete — show final result vs historical avg, no projection bar needed
  if (warComplete) {
    const finalColor   = totalFameNow >= historicalClanAvg ? C_GREEN : C_RED;
    const vsAvgPct     = historicalClanAvg > 0 ? ((totalFameNow - historicalClanAvg) / historicalClanAvg * 100).toFixed(1) : '0.0';
    const vsAvgColor   = totalFameNow >= historicalClanAvg ? C_GREEN : C_RED;
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
    const windowLabel2 = liveWindowSize === 0 ? 'All' : liveWindowSize + 'W';
    return `<div class="projection-wrap">`
      + `<div class="projection-title">WAR RESULT`
      + `<div class="proj-legend"><div class="proj-legend-dot" style="background:${finalColor}"></div>Final Score</div>`
      + `<div class="proj-legend"><div class="proj-legend-dot" style="background:rgba(180,180,180,0.5)"></div>Hist. Avg (${windowLabel2})</div>`
      + `</div>`
      + svgFinal
      + `<div style="margin-top:12px;font-family:Share Tech Mono,monospace;font-size:10px;color:var(--text-dim)">`
      + `${totalDecksUsed}/${maxTotalDecks} battles used · ${famePerDeck.toFixed(0)} fame/battle · `
      + `<span style="color:${vsAvgColor};font-weight:700">${totalFameNow >= historicalClanAvg ? '+' : ''}${vsAvgPct}%</span> vs historical avg`
      + `</div>`
      + `</div>`;
  }

  const projColor     = projectedFame >= historicalClanAvg ? C_GREEN : C_RED;
  const projAccuracy  = maxTotalDecks > 0 ? (totalDecksUsed / maxTotalDecks) * 100 : 0;
  const accuracyColor = projAccuracy >= ACCURACY_HIGH ? C_GREEN
    : projAccuracy >= ACCURACY_MID  ? '#f5b731'
    : C_RED;

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

  const windowLabel = liveWindowSize === 0 ? 'All' : liveWindowSize + 'W';
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
  const apiWarStarted = warHasStarted();

  // The current CR API war data resets to 0 fame between wars (training day or
  // the gap before the next war's Day 1 begins). If that's the case but the LIVE
  // sheet still has last week's completed-war data, fall back to showing that
  // instead of an empty page -- this is what lets leaders review the past war
  // for a few days before the next one starts.
  const sheetHasData = Object.keys(LIVE_SHEET_DATA).length > 0
    && Object.values(LIVE_SHEET_DATA).some(s => (s.totalDecks || 0) > 0);

  if (!Object.keys(LIVE_DATA).length && !sheetHasData) {
    document.getElementById('main').innerHTML =
      '<div class="graphic-placeholder"><span class="graphic-placeholder-icon">&#x26A1;</span>NO LIVE WAR DATA AVAILABLE<br><br>'
      + '<span style="font-size:11px;opacity:0.6">War runs Thursday-Sunday.</span></div>';
    return;
  }

  // Decide which data source to render from:
  //  - If the API shows an active war (fame > 0 this period) -> use live API data.
  //  - Otherwise, if the LIVE sheet still has a completed war recorded -> show that
  //    as a read-only review of the most recent war.
  const usingSheetFallback = !apiWarStarted && sheetHasData;

  let sortedPlayers, currentDay, warStarted;

  if (usingSheetFallback) {
    // Include every clan member the GAS snapshots saw during this war -- even
    // zero-battle ones. LIVE_SHEET_DATA already only contains names captured
    // by the API's participants[] list while THIS war was live, so anyone
    // here was genuinely in the clan/war roster at some point during the war
    // period. Previously this filtered out 0-battle members entirely, which
    // hid exactly the players leaders most need to see (people who missed
    // their whole war). Members since kicked still carry their OUT tag via
    // playerTag(), so that context isn't lost.
    sortedPlayers = Object.values(LIVE_SHEET_DATA)
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
    reviewBanner
    + summaryBoxHtml
    + '<div class="live-war-grid">' + dayCols + '</div>'
    + buildProjectionWidget(sortedPlayers, currentDay, usingSheetFallback)
    + '<div class="g-section-hdr"><span>&#x2BDF;</span> War Summary -- ' + completeCount + '/' + sortedPlayers.length + ' completed all 16 battles</div>'
    + buildWarSummaryTable(sortedPlayers, currentDay);
}

