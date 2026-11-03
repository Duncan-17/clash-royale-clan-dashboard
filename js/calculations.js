// ══════════════════════════════════════════════════════════════════
//  CALCULATIONS.JS
//  All shared, pure math — no HTML building, no DOM access (aside from
//  reading state). These functions are the single source of truth for
//  numbers that appear in more than one tab, so tab-*.js files should
//  always call into here rather than re-deriving a stat inline.
//
//  Notably: getAdjustedRank() (tie-for-1st placement logic, used by
//  both tab-data.js and tab-live.js) and calcPlayerAnalytics() /
//  calcValueScore() / calcSignal() (the Analysis tab's value-score and
//  promotion/demotion engine) were pulled in here from their original
//  locations in index.html specifically so they have one home instead
//  of being duplicated — see CLAUDE.md section 4 for the history of
//  why that consolidation matters.
//
//  Load AFTER config.js/state.js. Load BEFORE the tab-*.js files.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  DERIVED STATS
//  All calculations treat scores arrays as:
//    null = player was NOT in the clan that war (excluded from averages)
//    0    = player was in clan but didn't play   (counts as 0 in averages)
// ══════════════════════════════════════════════════════

// Return the score slice for a given window size.
// n=0 means all-time; n>0 means the last N entries chronologically.
function getWindowScores(scores, n) {
  if (n === 0) return scores;
  return scores.slice(-n);
}

// Average fame over the window, excluding wars where the player wasn't in the clan.
function calcAvg(scores, n) {
  const window    = getWindowScores(scores, n);
  const clanWars  = window.filter(s => s !== null);
  if (!clanWars.length) return 0;
  return Math.round(clanWars.reduce((a, b) => a + b, 0) / clanWars.length);
}

// Participation rate = wars with score > 0 divided by wars in clan.
function calcParticipation(scores, n) {
  const window   = getWindowScores(scores, n);
  const clanWars = window.filter(s => s !== null);
  const attended = clanWars.filter(s => s > 0).length;
  return { attended, total: clanWars.length, pct: clanWars.length ? attended / clanWars.length : 0 };
}

// Average decks used per war (one decimal), excluding null (no data).
function calcAvgDecks(decks, n) {
  if (!decks) return null;
  const window   = getWindowScores(decks, n);
  const clanWars = window.filter(d => d !== null);
  if (!clanWars.length) return null;
  return Math.round(clanWars.reduce((a, b) => a + b, 0) / clanWars.length * 10) / 10;
}

// CSS class for coloring a deck count out of 16
function deckFracClass(d) {
  if (d === null) return 'deck-na';
  if (d >= 16)   return 'deck-full';
  if (d >= 12)   return 'deck-good';
  if (d >= 8)    return 'deck-mid';
  if (d > 0)     return 'deck-low';
  return 'deck-none';
}

// Method 1 Moving Average Trend (per AI recommendation):
// Respects warWindow: compares recent 1-2 wars against the prior wars WITHIN the window.
// Missed wars (null) are treated as 0 for trend purposes — absences should drag trend down.
// Threshold = ±300 points (≈ one missed war day).
function calcTrend(scores, n) {
  // Get the windowed slice (same data the player sees on screen)
  const windowed = n === 0 ? scores : scores.slice(-Math.max(n, 3));

  // For trend only: replace null (missed war) with 0 — absence is a performance hit
  // Players who weren't in clan yet (all nulls at start of history) are handled by
  // the < 3 non-zero guard below.
  const withMissed = windowed.map(s => s === null ? 0 : s);

  // Work most-recent-first
  const valid = [...withMissed].reverse();

  // Need at least 3 data points
  if (valid.length < 3) return 'flat';

  // If a player has never scored anything (brand new, all zeros), skip
  if (valid.every(s => s === 0)) return 'flat';

  // Recent window: last 1 war (smoothed to 2 if window is wide enough)
  const recentN   = Math.min(2, Math.floor(valid.length / 2));
  const recentAvg = valid.slice(0, recentN).reduce((a, b) => a + b, 0) / recentN;

  // Historic baseline: next wars after the recent window (up to 3)
  const baseSlice = valid.slice(recentN, recentN + 3);
  const baseAvg   = baseSlice.reduce((a, b) => a + b, 0) / baseSlice.length;

  // If baseline is essentially zero (player just joined), no signal yet
  if (baseAvg < 100) return 'flat';

  const diff = recentAvg - baseAvg;
  if (diff >  TREND_THRESHOLD) return 'up';
  if (diff < -TREND_THRESHOLD) return 'down';
  return 'flat';
}

// Returns true if the current live war has actually begun (at least one fame point scored).
// False means it's a training/preparation day — the river race exists but is empty.
function warHasStarted() {
  return Object.values(LIVE_DATA).some(p => p.fame > 0);
}

// Walk scores from most recent backwards to find the last war the player actually has data for.
function getLastWarScore(player) {
  for (let i = player.scores.length - 1; i >= 0; i--) {
    if (player.scores[i] !== null) return player.scores[i];
  }
  return null;
}

// A player is "inactive" if they're not currently a clan member.
// During an active war, presence in LIVE_PARTICIPANTS overrides everything
// (covers someone mid-war before the roster API has caught up). Otherwise,
// current roster membership (LIVE_ROLES) is the authoritative signal.
//
// This used to check "null in the most recent war's score column" instead
// of roster membership -- but a war's WAR_PLAYERS row can carry a real,
// non-null score (even 0) for someone who is no longer in the clan, since
// that row is finalized from Supercell's own per-war participants list,
// which doesn't always match current membership by the time the war
// finalizes. A null-only check left such players showing as "Active" (and
// counted in the Data tab's Active total / shown on the Live tab's roster)
// until an entire ADDITIONAL war passed with no score for them -- a full
// war's worth of lag, not immediate. Roster membership has no such lag.
function isInactive(player) {
  const key = player.name.toLowerCase().trim();

  // Swapper accounts are never inactive — they rotate in/out by design
  if (SWAPPER_NAMES.has(key)) return false;

  if (warHasStarted()) {
    // Live war is running — anyone signed up is considered active
    if (LIVE_PARTICIPANTS.has(key)) return false;
  }

  // Only trust LIVE_ROLES once it's actually populated (API worked and
  // returned members) -- same guard used everywhere else in this file.
  if (Object.keys(LIVE_ROLES).length > 10) {
    return !LIVE_ROLES[key];
  }

  // API-unavailable fallback: null in the last score slot = player wasn't
  // in the clan for the most recent war we have data for.
  if (!player.scores.length) return true;
  return player.scores[player.scores.length - 1] === null;
}

function promoRec(player, avg, part) {
  // Promotion recommendations disabled — re-enable when needed
  return '';
}

function avgClass(avg) {
  if (avg >= TIER_S) return 'avg-s';
  if (avg >= TIER_A) return 'avg-a';
  if (avg >= TIER_B) return 'avg-b';
  if (avg >= TIER_C) return 'avg-c';
  return 'avg-d';
}

// Green dot on data page: player is in the clan RIGHT NOW per live API, or is a designated swapper.
// ── SWAPPER / NEW / REMOVED player detection ────────────────────────────────
// SWAPPER = in SWAPPER_OVERRIDES (rotates in/out by design; takes priority
//           over NEW/REMOVED, matching the swapper bypass used elsewhere
//           in the app, e.g. isInactive() and isCurrentlyInClan()).
// NEW    = currently in LIVE_ROLES but has ≤ 1 qualifying war (just joined)
// REMOVED = NOT in LIVE_ROLES but was part of the most recent war we have
//           real data for (left/kicked mid-war OR since the last war ended)
function playerTag(p) {
  const key = p.name.toLowerCase().trim();

  if (SWAPPER_NAMES.has(key)) return 'swapper';

  // Only tag if LIVE_ROLES is actually populated (API worked and returned members).
  // If empty, we have no reliable roster data to judge against.
  const rosterLoaded = Object.keys(LIVE_ROLES).length > 10;

  const inRoster = !!LIVE_ROLES[key] || SWAPPER_NAMES.has(key);

  if (rosterLoaded && !inRoster) {
    // REMOVED: not in current roster AND was part of the most recent war we
    // have real data for. LIVE_PARTICIPANTS (the currently active war's real
    // API roster) covers the "kicked mid-war" case; when there's no active
    // war -- training day / the gap between wars, which is most of the time,
    // not an edge case -- LIVE_PARTICIPANTS instead reflects the NEXT war's
    // not-yet-fought roster, so it can never confirm someone was in the LAST
    // war. Falling back to the last FINALIZED war's own score covers that
    // gap: a non-null score there means they were genuinely part of it.
    if (LIVE_PARTICIPANTS.has(key)) return 'removed';
    let lastFinalizedIdx = -1;
    for (let i = WARS.length - 1; i >= 0; i--) {
      if (!WARS[i].isLive) { lastFinalizedIdx = i; break; }
    }
    if (lastFinalizedIdx !== -1 && p.scores[lastFinalizedIdx] !== null) return 'removed';
    return null;
  }

  if (inRoster) {
    // NEW: in roster but their CURRENT stint is ≤ 1 war old. Counts
    // consecutive non-null scores backward from the most recent war,
    // stopping at the first genuine gap -- NOT a lifetime total. Players
    // are keyed by tag (stable across rejoins), so someone who was in the
    // clan long ago, left, and rejoined recently still has their old
    // stint's scores sitting earlier in the same array; a lifetime count
    // would see those old wars and never flag the rejoin as new.
    //
    // The live/in-progress war column (if present) is skipped rather than
    // treated as a stopping point when null: appendLiveColumn() (parse.js)
    // deliberately leaves it null for anyone who simply hasn't battled YET
    // this week (as opposed to a real gap meaning "wasn't in the clan"),
    // so a long-tenured member who hasn't started this week's battles must
    // not have their tenure count reset to 0 by it.
    let currentTenure = 0;
    for (let i = p.scores.length - 1; i >= 0; i--) {
      if (p.scores[i] === null) {
        if (WARS[i] && WARS[i].isLive) continue;
        break;
      }
      currentTenure++;
    }
    if (currentTenure <= 1) return 'new';
  }

  return null;
}

// Same tag logic as playerTag(), but for the Live tab's training-day "review
// the last completed war" screen (isSheetReview). playerTag()'s REMOVED
// check only trusts LIVE_PARTICIPANTS -- the CURRENT live war's real API
// roster -- specifically to avoid false positives; but during training day
// that set reflects the NEXT war's registrants, not the war actually being
// reviewed, so checking against it here silently drops the OUT tag for
// anyone kicked since the reviewed war ended. Check LIVE_SHEET_DATA (that
// reviewed war's own snapshot roster) instead -- presence there means they
// were genuinely part of the war being shown, regardless of what's changed
// since.
function playerTagForWarReview(p) {
  const key = p.name.toLowerCase().trim();
  if (SWAPPER_NAMES.has(key)) return 'swapper';
  const rosterLoaded = Object.keys(LIVE_ROLES).length > 10;
  const inRoster = !!LIVE_ROLES[key] || SWAPPER_NAMES.has(key);
  if (rosterLoaded && !inRoster) {
    return LIVE_SHEET_DATA[key] ? 'removed' : null;
  }
  if (inRoster) {
    const warsInHistory = p.scores.filter(s => s !== null).length;
    if (warsInHistory <= 1) return 'new';
  }
  return null;
}

function playerTagHtml(tag, style = 'badge') {
  if (!tag) return '';
  if (style === 'dot') {
    const color = tag === 'new' ? '#26c281' : tag === 'swapper' ? '#9b72cf' : '#e05252';
    const label = tag === 'new' ? 'NEW' : tag === 'swapper' ? 'SWAP' : 'OUT';
    return `<span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;font-family:'Share Tech Mono',monospace;letter-spacing:1px;background:${color};color:#fff;margin-left:5px;vertical-align:middle">${label}</span>`;
  }
  // badge style
  const bg = tag === 'new' ? 'rgba(38,194,129,0.15)' : tag === 'swapper' ? 'rgba(155,114,207,0.15)' : 'rgba(224,82,82,0.15)';
  const border = tag === 'new' ? 'rgba(38,194,129,0.6)' : tag === 'swapper' ? 'rgba(155,114,207,0.6)' : 'rgba(224,82,82,0.6)';
  const color = tag === 'new' ? '#26c281' : tag === 'swapper' ? '#9b72cf' : '#e05252';
  const label = tag === 'new' ? '✦ NEW' : tag === 'swapper' ? '⇄ SWAP' : '✕ REMOVED';
  return `<span style="display:inline-block;padding:1px 6px;border-radius:3px;border:1px solid ${border};font-size:9px;font-weight:700;font-family:'Share Tech Mono',monospace;letter-spacing:1px;background:${bg};color:${color};margin-left:5px;vertical-align:middle">${label}</span>`;
}

// Green dot on data page: player is in the clan RIGHT NOW per live API, or is a designated swapper.
function isCurrentlyInClan(p) {
  const key = (p.name || '').toLowerCase().trim();
  // If LIVE_ROLES is populated (API worked), use it as the definitive source for both
  // regular members and swappers. Swappers rotate in/out, so check LIVE_ROLES for them too.
  // Only fall back to SWAPPER_NAMES when LIVE_ROLES is empty (API down).
  const rosterLoaded = Object.keys(LIVE_ROLES).length > 10;
  if (rosterLoaded) return !!LIVE_ROLES[key];
  // API down fallback: assume swappers are in clan, regular members unknown
  return SWAPPER_NAMES.has(key);
}

// isActive: used for data page active/inactive section split.
// A player is active if their last war score is non-null (was in clan for most recent war).
function isActive(p) {
  if (p.scores && p.scores.length > 0) return !isInactive(p);
  return isCurrentlyInClan(p);
}

function posClass(pos) {
  const map = { 'Leader':'pos-leader','Co-leader':'pos-coleader','Co-Leader':'pos-coleader','Elder':'pos-elder','Member':'pos-member','Swapper':'pos-swapper','Gone':'pos-gone' };
  return map[pos] || 'pos-member';
}

const ALL_SCORES_FLAT = [];

function heatClass(score) {
  if (score === null) return 'wc-absent';
  if (score === 0) return 'wc-0';
  if (!ALL_SCORES_FLAT.length) return 'wc-3';
  const max = Math.max(...ALL_SCORES_FLAT), min = Math.min(...ALL_SCORES_FLAT);
  const norm = (score - min) / (max - min || 1);
  if (norm >= 0.85) return 'wc-6';
  if (norm >= 0.70) return 'wc-5';
  if (norm >= 0.55) return 'wc-4';
  if (norm >= 0.40) return 'wc-3';
  if (norm >= 0.25) return 'wc-2';
  if (norm >= 0.10) return 'wc-1';
  return 'wc-0';
}

function calcAllWarsAvgDecks(p) {
  // Windowed avg decks — mirrors the Avg Battles column exactly (respects warWindow).
  const swScores = swapperAwareScores(p);
  const windowedScores = getWindowScores(swScores, warWindow);
  const windowOffset = swScores.length - windowedScores.length;
  const vals = windowedScores.map((s, wi) => {
    if (s === null) return null;
    const d = p.decks ? p.decks[windowOffset + wi] : null;
    return d !== null ? d : (s > 0 ? 16 : 0);
  }).filter(d => d !== null);
  return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : -1;
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    // When battles toggled: primary = avg battles (all-time), secondary = active sortMode
    if (sortBattles) {
      const aD = calcAllWarsAvgDecks(a);
      const bD = calcAllWarsAvgDecks(b);
      if (Math.abs(bD - aD) > 0.05) return bD - aD; // primary: battles
      // fall through to secondary sort below
    }

    const aAvg = calcAvg(effectiveScores(a), warWindow);
    const bAvg = calcAvg(effectiveScores(b), warWindow);
    if (sortMode === 'avg') return bAvg - aAvg;
    if (sortMode === 'active') {
      const aOn = isCurrentlyInClan(a) ? 1 : 0, bOn = isCurrentlyInClan(b) ? 1 : 0;
      return aOn !== bOn ? bOn - aOn : bAvg - aAvg;
    }
    if (sortMode === 'alpha') return a.name.localeCompare(b.name);
    if (sortMode === 'part') return calcParticipation(swapperAwareScores(b), warWindow).pct - calcParticipation(swapperAwareScores(a), warWindow).pct;
    if (sortMode === 'role') {
      const rDiff = (ROLE_ORDER[a.pos] ?? 3) - (ROLE_ORDER[b.pos] ?? 3);
      return rDiff !== 0 ? rDiff : bAvg - aAvg;
    }
    return bAvg - aAvg; // default secondary: avg
  });
}

function filterPlayers() {
  // Inactive is purely auto-detected — no manual Gone tagging
  let inactive = PLAYERS.filter(p => isInactive(p));
  const inactiveNames = new Set(inactive.map(p => p.name.toLowerCase()));
  let active = PLAYERS.filter(p => !inactiveNames.has(p.name.toLowerCase()));

  if (searchStr) {
    const s = searchStr.toLowerCase();
    active = active.filter(p => p.name.toLowerCase().includes(s));
    inactive = inactive.filter(p => p.name.toLowerCase().includes(s));
  }

  return { active, inactive };
}

// True iff a war's WARS-sheet WAR_TYPE marks it as a Colosseum week. That
// column is free text from the Apps Script backend / manual entry (parsed
// as-is in parseWarsSheet, defaulting to 'normal' when blank) -- matched
// case-insensitively by substring rather than an exact string so it isn't
// brittle against however it happens to be capitalized/phrased in the sheet.
function isColosseumWar(warType) {
  return typeof warType === 'string' && warType.toLowerCase().includes('colosseum');
}

// Adjust a war's rank for tie-for-1st: on a normal week, clan fame caps at
// NORMAL_WAR_FAME_CAP (the finish line). If we're AT the cap and so is
// whoever Supercell's riverracelog ranked #1, every number we can see says
// it's a tie -- Supercell's rank field just breaks it on some hidden
// criterion (likely time-to-cap) that isn't exposed to us. Treat it as 1st.
// Single source of truth so every rank display (Data tab war headers, Live
// tab summary box, anywhere else) agrees with each other.
// Colosseum weeks don't use that same 10k finish line (their CLAN_FAME
// column is true fame, uncapped, per parseStandingsSheet's note), so this
// tie-check must be skipped there -- pass the war's warType whenever it's
// known (finalized wars, sourced from the sheet) so it can be.
function getAdjustedRank(standing, allStandingsForWar, warType = null) {
  if (!standing) return null;
  let rank = standing.rank;
  if (rank && rank > 1 && allStandingsForWar && allStandingsForWar.length && !isColosseumWar(warType)) {
    const rank1Entry = allStandingsForWar.find(e => e.rank === 1);
    if (rank1Entry && rank1Entry.fame === standing.fame && standing.fame >= NORMAL_WAR_FAME_CAP) {
      rank = 1;
    }
  }
  return rank;
}
// ══════════════════════════════════════════════════════
//  ANALYSIS TAB SCORING ENGINE
//  Value score + promotion/demotion signal math, moved here from the
//  Analysis tab's render function (tab-analysis.js) so it has one home.
// ══════════════════════════════════════════════════════

// Clan-wide all-time avg fame per participant per war (participants only, score > 0).
function clanAvgFamePerPlayer() {
  const nonLiveWars = WARS.filter(w => !w.isLive);
  const avgs = nonLiveWars.map(w => {
    const idx = WARS.indexOf(w);
    const scores = PLAYERS.map(p => p.scores[idx]).filter(s => s !== null && s > 0);
    return scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : null;
  }).filter(v => v !== null);
  return avgs.length ? avgs.reduce((a,b)=>a+b,0)/avgs.length : 2243;
}

// Clan-wide all-time avg decks per participant per war.
function clanAvgDecksPerPlayer() {
  const nonLiveWars = WARS.filter(w => !w.isLive);
  const avgs = nonLiveWars.map(w => {
    const idx = WARS.indexOf(w);
    const decks = PLAYERS.map(p => p.decks[idx]).filter(d => d !== null && d > 0);
    return decks.length ? decks.reduce((a,b)=>a+b,0)/decks.length : null;
  }).filter(v => v !== null);
  return avgs.length ? avgs.reduce((a,b)=>a+b,0)/avgs.length : 14;
}

// Per-player analytics — returns null if player has no qualifying data.
function calcPlayerAnalytics(p) {
  const nonLiveWars = WARS.filter(w => !w.isLive);
  const isSwapper = SWAPPER_NAMES.has(p.name.toLowerCase().trim());

  // Build per-war records, detecting mid-war joins
  let records = nonLiveWars.map((w, wi) => {
    const idx = WARS.indexOf(w);
    let score = p.scores[idx];
    let decks = p.decks[idx];
    // Wars 13-16 have no deck data (imported from old sheet with fame only).
    // If a player has a valid fame score but null decks, assume 16 — they
    // participated and scored, so they almost certainly used all their decks.
    if (decks === null && score !== null && score > 0) decks = 16;
    // Swappers: treat zero-scored wars as null — being present without battling
    // is strategic (covering another day), not negligence.
    if (isSwapper && score === 0) { score = null; decks = null; }
    return { warNum: w.id, score, decks };
  });

  // Find first non-null war (when player joined)
  const firstWarIdx = records.findIndex(r => r.score !== null || r.decks !== null);
  if (firstWarIdx === -1) return { qualifyingWars: 0, isSwapper };

  // Wars since joining
  const sinceJoining = records.slice(firstWarIdx);
  const totalWarsSinceJoining = sinceJoining.length;

  // Mid-war join detection: first 1-2 wars where decks < 4 are excluded
  let joinExcludeCount = 0;
  for (let i = 0; i < Math.min(2, sinceJoining.length); i++) {
    const r = sinceJoining[i];
    if (r.decks !== null && r.decks < 4) joinExcludeCount++;
    else break;
  }

  const qualifyingRecords = sinceJoining.slice(joinExcludeCount).filter(r => r.score !== null || r.decks !== null);
  const qualifyingWars = qualifyingRecords.length;
  const recentlyJoined = joinExcludeCount > 0 && qualifyingWars === 0;

  if (qualifyingWars === 0) return { qualifyingWars: 0, recentlyJoined: true, isSwapper };

  // Participation: wars with any decks played / total qualifying war slots
  const participated = qualifyingRecords.filter(r => (r.decks || 0) > 0 || (r.score || 0) > 0);
  const participationRate = qualifyingWars > 0 ? participated.length / qualifyingWars : 0;

  // Avg decks per war (only wars where player participated)
  const totalDecks = participated.reduce((a, r) => a + (r.decks || 0), 0);
  const avgDecksPerWar = participated.length > 0 ? totalDecks / participated.length : 0;

  // Avg fame per war (all qualifying wars including absences)
  const totalFame = qualifyingRecords.reduce((a, r) => a + (r.score || 0), 0);
  const avgFamePerWar = qualifyingWars > 0 ? totalFame / qualifyingWars : 0;

  // Avg fame per battle (deck)
  const avgFamePerBattle = totalDecks > 0 ? totalFame / totalDecks : 0;

  // Consistency: 1 - coefficient of variation of per-war fame scores (participated only)
  const fameScores = participated.map(r => r.score || 0);
  let consistency = 1;
  if (fameScores.length > 1) {
    const mean = fameScores.reduce((a,b)=>a+b,0)/fameScores.length;
    const variance = fameScores.reduce((a,b)=>a+(b-mean)**2,0)/fameScores.length;
    const cv = mean > 0 ? Math.sqrt(variance)/mean : 0;
    consistency = Math.max(0, 1 - cv);
  }

  return {
    qualifyingWars, totalWarsSinceJoining, recentlyJoined: false,
    participationRate, avgDecksPerWar, avgFamePerWar, avgFamePerBattle,
    consistency, isSwapper
  };
}

// ── Tenure gates ──────────────────────────────────────────────────────────
// A player can't be considered FOR a tier just because their score ranks
// them there -- they need enough wars under their belt for that trust to
// mean anything. These also double as the tenure-score normalization cap
// below (hitting the Co-Leader bar maxes out the tenure component).
const ELDER_MIN_WARS    = 8;
const COLEADER_MIN_WARS = 15;

// ── Value score (single source of truth for ranking + the on-card bar) ─────
// Weighted so that reliability -- wars played (tenure) and % of your 16
// battles/war you actually complete (deck usage) -- carries real weight
// alongside fame. Previously fame dominated (60% combined) and a highly
// consistent player who never misses a battle but scores under ~2k fame/war
// ranked below flashier, less reliable players. Now fame is 40% combined,
// and tenure + deck completion + participation (the "shows up and finishes
// their battles" stats) are 60% combined.
function calcValueScore(an, clanFameAvg, clanDecksAvg) {
  if (!an.qualifyingWars) return -1;
  const fb = clanDecksAvg > 0 ? clanFameAvg / clanDecksAvg : 1;
  const fameWarNorm    = clanFameAvg > 0 ? Math.min(an.avgFamePerWar / clanFameAvg, 1.5) : 0;
  const fameBattleNorm = fb > 0          ? Math.min(an.avgFamePerBattle / Math.max(fb, 1), 1.5) : 0;
  const decksNorm       = Math.min(an.avgDecksPerWar / 16, 1.0);              // % of their 16 battles/war actually played
  const tenureNorm      = Math.min(an.qualifyingWars / COLEADER_MIN_WARS, 1.0); // wars played -- reliability over time
  return fameWarNorm * 0.25
       + fameBattleNorm * 0.15
       + an.participationRate * 0.20
       + decksNorm * 0.20
       + tenureNorm * 0.20;
}

// ── Alternate Analysis-tab scoring lenses ──────────────────────────────────
// calcValueScore() above ("Complex") stays untouched and remains the single
// source of truth for the Data tab's Active Members sort/on-card bar --
// these two are additional lenses selected via the Analysis tab's own
// analysisScoreMode toggle (see calcAnalysisScore() dispatcher below), not
// substitutes for it.

// "Basic": battle-completion % and participation are the primary signal --
// tenure (qualifying wars) is weighted in on top so a track record backed
// by more wars counts for more than the same rate over just a couple, since
// a completion/participation % is more trustworthy the larger the sample
// it's drawn from.
function calcBasicScore(an) {
  if (!an.qualifyingWars) return -1;
  const battleCompletionNorm = Math.min(an.avgDecksPerWar / 16, 1.0);
  const tenureNorm = Math.min(an.qualifyingWars / COLEADER_MIN_WARS, 1.0);
  return battleCompletionNorm * 0.40
       + an.participationRate * 0.40
       + tenureNorm * 0.20;
}

// "Competitive Basic": same tenure-weighting idea as Basic, but the primary
// signal is fame per war and consistency instead of completion/
// participation. consistency (calcPlayerAnalytics) is already computed only
// from wars the player actually participated in, so weeks they legitimately
// missed never drag it down -- only genuine week-to-week swings in output
// while they were playing do.
function calcCompetitiveScore(an, clanFameAvg) {
  if (!an.qualifyingWars) return -1;
  const fameWarNorm = clanFameAvg > 0 ? Math.min(an.avgFamePerWar / clanFameAvg, 1.5) : 0;
  const tenureNorm  = Math.min(an.qualifyingWars / COLEADER_MIN_WARS, 1.0);
  return fameWarNorm * 0.40
       + an.consistency * 0.40
       + tenureNorm * 0.20;
}

// Single dispatch point the Analysis tab uses instead of calling one of the
// three score functions directly -- keeps tab-analysis.js from needing to
// know which raw function backs which mode.
function calcAnalysisScore(mode, an, clanFameAvg, clanDecksAvg) {
  if (mode === 'basic')       return calcBasicScore(an);
  if (mode === 'competitive') return calcCompetitiveScore(an, clanFameAvg);
  return calcValueScore(an, clanFameAvg, clanDecksAvg);
}

// Given a player's 0-indexed position in the value-score-sorted ranking
// (best first) and the total number of ranked players, return which role
// tier that rank position implies: top third -> Co-Leader, middle third ->
// Elder, bottom third -> Member.
function tierForRank(rankIdx, total) {
  if (!total) return null;
  const third = total / 3;
  if (rankIdx < third) return 'Co-Leader';
  if (rankIdx < third * 2) return 'Elder';
  return 'Member';
}

// Compute the promotion/demotion signal for a player.
// rankIdx/tierTotal: this player's 0-indexed position (and the total ranked
// count) within the value-score-sorted active roster -- see renderAnalysis.
function calcSignal(p, analytics, clanFameAvg, clanDecksAvg, rankIdx = null, tierTotal = 0) {
  const { qualifyingWars, participationRate, avgDecksPerWar,
          avgFamePerWar, avgFamePerBattle } = analytics;
  const role = p.pos || 'Member';

  // --- Kick zone: consistent low output + low deck usage ---
  // Primary signal: decks < 11/war (missing 5+ decks) AND fame/war < 75% clan avg
  // Must have 3+ wars to avoid false-flagging new players
  if (qualifyingWars >= 3 && avgDecksPerWar < 11 && avgFamePerWar < clanFameAvg * 0.75) {
    return { type: 'down-kick', label: '✕', alert: 'kick',
      tooltip: 'Kick zone — consistently low deck usage and output' };
  }
  // Secondary kick: very low participation sustained
  if (qualifyingWars >= 3 && participationRate < 0.35) {
    return { type: 'down-kick', label: '✕', alert: 'kick',
      tooltip: 'Kick zone — persistent absence from wars' };
  }

  // --- Warning zone: approaching kick thresholds ---
  if (qualifyingWars >= 3 && (
    avgDecksPerWar < 13 && avgFamePerWar < clanFameAvg * 0.85
  )) {
    return { type: 'neutral', label: '—', alert: 'warn',
      tooltip: 'Warning — low deck usage and below-average output' };
  }
  if (qualifyingWars >= 3 && participationRate < 0.55) {
    return { type: 'neutral', label: '—', alert: 'warn',
      tooltip: 'Warning — below acceptable participation rate' };
  }

  // --- Promotion / demotion: rank-position based, gated by tenure ---
  // The Active Members list is already sorted by value score, best first --
  // that ranking is treated as ground truth for WHO deserves consideration.
  // Split it into thirds and treat each third as this war's implied role
  // tier: top third Co-Leader, middle third Elder, bottom third Member.
  // But rank alone can't earn a tier the player hasn't put the time in for
  // -- Elder requires ELDER_MIN_WARS+ wars, Co-Leader requires
  // COLEADER_MIN_WARS+, regardless of score. A player who ranks into a tier
  // they're not yet tenured for is capped at the highest tier they qualify
  // for (this applies uniformly, so a current Co-Leader who's dropped below
  // COLEADER_MIN_WARS -- e.g. after a long absence -- is flagged for
  // demotion on tenure grounds too, not just score).
  // Signal color reflects the DESTINATION tier (blue = Elder, gold =
  // Co-Leader), not just "promotion" vs "demotion" generically.
  // Leader is a fixed single-person role and is never touched by this.
  const tierIndex = { 'Co-Leader': 0, 'Co-leader': 0, 'Elder': 1, 'Member': 2 };
  const tierNames = ['Co-Leader', 'Elder', 'Member'];
  if (role !== 'Leader' && rankIdx != null && tierTotal > 0 && role in tierIndex) {
    const rawTarget = tierForRank(rankIdx, tierTotal);
    const tenureCap = qualifyingWars >= COLEADER_MIN_WARS ? 'Co-Leader'
      : qualifyingWars >= ELDER_MIN_WARS ? 'Elder' : 'Member';
    const rawIdx  = tierIndex[rawTarget];
    const capIdx  = tierIndex[tenureCap];
    const cappedByTenure = capIdx > rawIdx;
    const targetIdx  = Math.max(rawIdx, capIdx); // more restrictive of the two wins
    const targetTier = tierNames[targetIdx];
    const roleIdx     = tierIndex[role];
    const tenureNote = cappedByTenure
      ? ` (capped by tenure — needs ${targetTier === 'Elder' ? COLEADER_MIN_WARS : ELDER_MIN_WARS}+ wars for the next tier, has ${qualifyingWars})`
      : '';
    if (targetIdx < roleIdx) {
      return targetTier === 'Co-Leader'
        ? { type: 'up-coleader', label: '▲', alert: null,
            tooltip: `Ranked #${rankIdx + 1} of ${tierTotal} by value score — top tier, promote to Co-Leader${tenureNote}` }
        : { type: 'up-elder', label: '▲', alert: null,
            tooltip: `Ranked #${rankIdx + 1} of ${tierTotal} by value score — top tier, promote to Elder${tenureNote}` };
    }
    if (targetIdx > roleIdx) {
      return targetTier === 'Member'
        ? { type: 'down-member', label: '▼', alert: null,
            tooltip: `Ranked #${rankIdx + 1} of ${tierTotal} by value score — bottom tier, demote to Member${tenureNote}` }
        : { type: 'down-elder', label: '▼', alert: null,
            tooltip: `Ranked #${rankIdx + 1} of ${tierTotal} by value score — middle tier, demote to Elder${tenureNote}` };
    }
  }

  return { type: 'neutral', label: '—', alert: null, tooltip: 'Consistent with current role' };
}

