// ══════════════════════════════════════════════════════════════════
//  CONFIG.JS
//  Data sources, clan identity, and every tunable constant that
//  controls how the dashboard looks and scores players.
//
//  This file has NO functions that depend on other files loading
//  first (except syncChartColors(), which reads CSS variables and
//  is safe to call any time after the DOM exists). Load this file
//  FIRST, before state.js/parse.js/calculations.js/tab-*.js/main.js,
//  since those files reference these constants.
//
//  To point the dashboard at a different clan or sheet, this is the
//  only file you should need to touch.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  CONFIG — Data sources and clan identity.
//  Change CLAN_TAG to point at a different clan.
//  SHEET_ID links to the Google Sheet with war history.
// ══════════════════════════════════════════════════════
const CLAN_TAG = 'P0Q2Y8UG';
const SHEET_ID = '1BTfdXFWsrN4i15jEiICvEQqt42gvZQMYuHxXYPOsRq8';

// Google Sheets CSV export URLs — v2 long-format schema (one per tab)
const WARS_URL        = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=WARS`;
const WAR_PLAYERS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=WAR_PLAYERS`;
const STANDINGS_URL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=STANDINGS`;
const SNAPSHOTS_URL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=SNAPSHOTS`;
const SWAPPERS_URL    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=SWAPPER_OVERRIDES`;

// Cloudflare Worker that proxies CR API calls and holds the API key
const CR_PROXY = 'https://unitedclash-proxy.dncanzano.workers.dev';

// ══════════════════════════════════════════════════════
//  DESIGN — Visual thresholds, chart palette, and layout.
//  Adjust anything here to change how the dashboard looks
//  without touching the rendering logic.
// ══════════════════════════════════════════════════════

// ── Clash Royale war format ───────────────────────────
const DECKS_PER_DAY     = 4;                             // battles per player per day
const WAR_DAYS          = 4;                             // Thu–Sun
const MAX_DECKS_PER_WAR = DECKS_PER_DAY * WAR_DAYS;     // 16 total per player
const WAR_ROSTER_SIZE   = 50;                            // CR allows up to 50 unique attackers PER DAY (per
                                                          // 24h deck refresh) — NOT a per-war total. A single war
                                                          // can have >50 unique participants across its 4 days.
// Clan-wide battle ceilings (roster-independent — only 50 can attack per day
// regardless of how many members are signed up). These are the correct
// denominators for "battles missed"; never derive them from roster size.
const DAILY_BATTLE_CAP  = 200;                          // 50 attackers × 4 decks, per day
const WAR_BATTLE_CAP    = 800;                          // DAILY_BATTLE_CAP × 4 battle days
const NORMAL_WAR_FAME_CAP = 10000;                      // finish-line cap on a normal (non-Colosseum) week --
                                                          // clan fame cannot exceed this, so two clans both AT
                                                          // the cap have objectively tied on every number we can
                                                          // see, even if Supercell's own rank field still breaks
                                                          // the tie by some hidden criterion (see tie-for-1st below).

// ── Score tier thresholds (player avg fame → cell color) ──
// Raise these to make color grades stricter; lower to be more generous.
const TIER_S = 2600;   // emerald green
const TIER_A = 2400;   // yellow-green
const TIER_B = 2200;   // gold
const TIER_C = 1800;   // orange  (below → red)

// ── Trend arrow sensitivity ───────────────────────────
// Fame-point difference vs. all-time avg needed to show ▲ or ▼.
const TREND_THRESHOLD = 300; // ±300pt buffer per Method 1 recommendation (≈ one missed war day)

// ── Participation bar thresholds ──────────────────────
const PART_HIGH = 0.85;   // ≥ 85% wars → green bar
const PART_MID  = 0.60;   // ≥ 60% wars → gold bar  (below → red)

// ── Promotion criteria (promoRec() is currently disabled) ─
const PROMO_ELDER_AVG    = 2200, PROMO_ELDER_PART    = 0.80;
const PROMO_CO_AVG       = 2500, PROMO_CO_PART       = 0.85;
const CONSIDER_ELDER_AVG = 1900, CONSIDER_ELDER_PART = 0.60;
const CONSIDER_CO_AVG    = 2400, CONSIDER_CO_PART    = 0.75;

// ── Color palette for JS-generated SVG and inline styles ──
// These are kept in sync with the active theme's CSS variables by
// syncChartColors() (called at the top of render()), so charts and SVG
// recolor correctly when the Royal/Dark theme toggle is flipped.
let C_GREEN  = '#26c281';
let C_RED    = '#e05252';
let C_GOLD   = '#f0b429';
let C_BLUE   = '#3b9ede';
let C_ORANGE = '#e8873a';
let C_DIM    = '#5a6880';   // muted text / axis labels
let C_BORDER = '#1e2838';   // SVG grid lines

// Pull the current theme's chart colors from the live CSS variables.
function syncChartColors() {
  const cs = getComputedStyle(document.body);
  const g = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  C_GREEN  = g('--green',    C_GREEN);
  C_RED    = g('--red',      C_RED);
  C_GOLD   = g('--gold',     C_GOLD);
  C_BLUE   = g('--blue',     C_BLUE);
  C_ORANGE = g('--orange',   C_ORANGE);
  C_DIM    = g('--text-dim', C_DIM);
  C_BORDER = g('--border',   C_BORDER);
}

// ── Projection chart SVG dimensions ──────────────────
const PROJ_SVG_W = 600, PROJ_SVG_H = 180;
const PROJ_PAD   = { top: 30, right: 80, bottom: 30, left: 20 };

// ── Projection accuracy confidence thresholds ─────────
// How much of the war has been played determines label color.
const ACCURACY_HIGH = 75;   // ≥ 75% battles done → high confidence (green)
const ACCURACY_MID  = 25;   // ≥ 25%              → moderate (gold)
//                             < 25%              → too early to trust (red)

// ── Role sort order used in Data mode "Role" sort ─────
const ROLE_ORDER = {
  'Leader': 0, 'Co-leader': 1, 'Co-Leader': 1,
  'Elder': 2, 'Member': 3, 'Swapper': 4, 'Gone': 5
};

