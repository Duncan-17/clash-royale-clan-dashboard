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
let LIVE_RACE_CLANS = [];
let SWAPPER_NAMES = new Set(); // lowercase player names from SWAPPER_OVERRIDES sheet  // all 5 clans in this week's river race, sorted by fame desc (for rank/medal display)
let WAR_STANDINGS = {};    // { warId: [{ clanTag, clanName, rank, fame, clanScore, isUs }, ...] } -- from STANDINGS sheet

let mode       = 'data';
let warWindow  = 3;
let sortMode   = 'avg';
let analysisFilter = 'active'; // 'active' | 'inactive'
let searchStr  = '';

// Graphic mode
let graphicMetric  = 'personal'; // player chart avg reference: 'personal' | 'clan'
let graphicSort    = 'avg';      // player sort in graphic mode: 'avg' | 'alpha'
let expandedCharts = new Set();  // set of player names with expanded bar charts

// Live mode
let liveSort       = 'score';    // 'score' | 'alpha'
let liveWindowSize = 0;          // war window for historical projection avg (0 = all time)

// Data mode
let showInactive   = false;      // whether the inactive members section is expanded
let sortBattles    = false;      // true = primary sort by avg battles used
let includeLive    = false;      // true = include the live/snapshot war column in stats
let showPersonalBest = false;    // true = highlight each player's best war in gold

