// ══════════════════════════════════════════════════════════════════
//  STATE.JS
//  Every global mutable data store and UI-state variable, all in one
//  place. Load AFTER config.js, BEFORE parse.js/calculations.js/
//  tab-*.js/main.js — everything downstream reads and writes these.
//
//  Two groups live here:
//   - Data stores populated by loadAll() (parse.js): WARS, PLAYERS,
//     LIVE_DATA, SWAPPER_NAMES, WAR_STANDINGS, etc.
//   - UI state toggled by the control handlers in main.js/tab-*.js:
//     mode, warWindow, sortMode, searchStr, and the per-tab toggles.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
let WARS      = [];
let PLAYERS   = [];
let LIVE_DATA = {};
let LIVE_PARTICIPANTS = new Set();
let LIVE_SHEET_DATA = {};
// Per-player, per-day battle detail (deck used, win/loss, opponent) for
// whichever war BATTLE_LOG's rows currently belong to -- see
// parseBattleLogSheet() (parse.js). { lowerName: { name, days: [[],[],[],[]] } },
// days[d] = array of battle objects for war-day d (index 0-3), oldest first.
// Only ever covers the CURRENT/most-recent war BATTLE_LOG has data for --
// there is no historical drill-down for older wars (see CLAUDE.md section 3).
let BATTLE_LOG = {};
// Per-player, all-time (every war BATTLE_LOG has ever recorded, not just
// the current one) deck performance -- { lowerName: { name, decks: [
// {cards, usage, wins, draws, losses, crownsFor, crownsAgainst,
// crownedGames, lastUsed, dayHistory: [{warId, dayIndex, wins, draws,
// losses, usage}, ...] (warId then dayIndex ascending)}, ... ] } },
// most-used deck first. crownsFor/crownsAgainst/crownedGames and
// wins/draws/losses only ever count real, individually-attributable games
// (a normal battle, or a real per-game duel row) -- a legacy merged-duel
// row's chunked decks count toward usage/lastUsed/dayHistory usage only,
// never a result, since the sheet only ever recorded one result/crowns
// figure for the whole duel. A day the deck wasn't used simply has no
// dayHistory entry, so a graph built off it naturally skips gaps instead
// of a trend line flattening across them. Consumed both as a per-slot
// lookup in the battle detail modal (calcBattleDetail(), tab-live.js --
// "how has THIS deck done overall" under each real battle) AND as the
// Analysis tab's "Battle Info" deck-history modal (calcPlayerDeckHistory()/
// buildDeckHistoryModal(), tab-live.js). See parseBattleLogSheet() (parse.js).
let DECK_STATS = {};
let LIVE_RACE_CLANS = [];
let SWAPPER_NAMES = new Set(); // lowercase player names from SWAPPER_OVERRIDES sheet  // all 5 clans in this week's river race, sorted by fame desc (for rank/medal display)
let WAR_STANDINGS = {};    // { warId: [{ clanTag, clanName, rank, fame, clanScore, isUs }, ...] } -- from STANDINGS sheet

// Timestamp of the last successful data fetch (sheets and/or CR API), set only
// by loadAll() in parse.js. render() just displays this — it must NEVER stamp
// its own new Date(), since render() also runs on every tab switch/sort/search
// with no new data involved, which would make "Updated HH:MM:SS" claim a fresh
// fetch that never happened (including while offline on cached data).
let lastDataUpdate = null;

// Clan war-trophy rank (US/home-country and world), fetched separately from
// the main data load since it hits two ~200KB rankings-list endpoints that
// only change roughly daily — see fetchClanRankings() (parse.js), which
// caches this in localStorage instead of refetching on every page load.
// null fields = not yet fetched or the clan wasn't found in that list
// (e.g. outside the global top ~1000 for World Ranking).
let CLAN_RANKINGS = { usRank: null, worldRank: null };

let mode       = 'data';
let warWindow  = 3;
let sortMode   = 'avg';
let analysisFilter = 'active'; // 'active' | 'inactive'
let analysisScoreMode = 'complex'; // 'complex' | 'basic' | 'competitive' -- Analysis tab's 3-way scoring-lens toggle
let deckHistorySortMode = 'usage'; // 'winpct' | 'usage' | 'active' -- deck history modal's sort toggle (tab-live.js)
let searchStr  = '';

// Graphic mode
let graphicMetric  = 'personal'; // player chart avg reference: 'personal' | 'clan'
let graphicSort    = 'avg';      // player sort in graphic mode: 'avg' | 'alpha'
let showOpponents  = false;      // Clan Total Fame Per War chart: overlay other clans' fame per war, color-coded by that week's rank
let expandedCharts = new Set();  // set of player names with expanded bar charts

// Live mode
let liveSort       = 'score';    // 'score' | 'alpha'
let liveWindowSize = 0;          // war window for historical projection avg (0 = all time)

// Data mode
let showInactive   = false;      // whether the inactive members section is expanded
let sortBattles    = false;      // true = primary sort by avg battles used
let includeLive    = false;      // true = include the live/snapshot war column in stats
let showPersonalBest = false;    // true = highlight each player's best war in gold

// Mobile control placement is no longer a piece of UI state: each tab's
// controls are simply relocated into that tab's own banner below the
// breakpoint (see parkTabControls()/mountTabControls(), main.js). The old
// controlBarCollapsed flag backed a collapse/expand handle on the control
// bar itself, which that replaced.

