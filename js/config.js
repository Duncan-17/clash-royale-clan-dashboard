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
const BATTLE_LOG_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=BATTLE_LOG`;

// Cloudflare Worker that proxies CR API calls and holds the API key
const CR_PROXY = 'https://unitedclash-proxy.dncanzano.workers.dev';

// CR API location id for the general/worldwide clan-war-trophy leaderboard
// ("International" in the API's own /locations list) -- confirmed via the
// proxy, not documented anywhere official. Used by fetchClanRankings().
const WORLD_LOCATION_ID = 57000006;

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

// ── Card art manifest — every base card slug with real art in
// assets/cards/, and the subset that also has an evolution overlay in
// assets/cards/evo/ (cardImageSlug(), tab-live.js, is the naming rule).
// Not derived at runtime (a browser can't list a folder's contents) --
// kept in sync by hand whenever art is added; see CLAUDE.md's card art
// section for the current coverage count. Sole purpose: driving
// prefetchCardArt() (parse.js) so every deck-popup image is already
// cached before a user opens their first popup, not fetched cold then.
const ALL_CARD_SLUGS = ['archer-queen','archers','arrows','baby-dragon','balloon','bandit','barbarian-barrel',
  'barbarian-hut','barbarians','bats','battle-healer','battle-ram','berserker','bomb-tower','bomber','boss-bandit',
  'bowler','cannon','cannon-cart','clone','dark-prince','dart-goblin','earthquake','electro-dragon','electro-giant',
  'electro-spirit','electro-wizard','elite-barbarians','elixir-collector','elixir-golem','executioner','fire-spirit',
  'fireball','firecracker','fisherman','flying-machine','freeze','furnace','giant','giant-skeleton','giant-snowball',
  'goblin-barrel','goblin-cage','goblin-curse','goblin-demolisher','goblin-drill','goblin-gang','goblin-giant',
  'goblin-hut','goblin-machine','goblins','goblinstein','golden-knight','golem','graveyard','guards','heal-spirit',
  'hog-rider','hunter','ice-golem','ice-spirit','ice-wizard','inferno-dragon','inferno-tower','knight','lava-hound',
  'lightning','little-prince','lumberjack','magic-archer','mega-knight','mega-minion','mighty-miner','miner',
  'mini-pekka','minion-horde','minions','mirror','monk','mortar','mother-witch','musketeer','night-witch','pekka',
  'phoenix','poison','prince','princess','rage','ram-rider','rascals','rocket','ronin','royal-delivery','royal-ghost',
  'royal-giant','royal-hogs','royal-recruits','rune-giant','skeleton-army','skeleton-barrel','skeleton-dragons',
  'skeleton-king','skeletons','sparky','spear-goblins','spirit-empress','suspicious-bush','tesla','the-log',
  'three-musketeers','tombstone','tornado','valkyrie','vines','void','wall-breakers','witch','wizard','x-bow','zap',
  'zappies'];
const EVO_CARD_SLUGS = ['baby-dragon','balloon','barbarians','bomber','cannon','dart-goblin','furnace',
  'giant-snowball','goblin-barrel','goblin-cage','goblin-drill','goblin-giant','ice-spirit','inferno-dragon',
  'lumberjack','mega-knight','minion-horde','musketeer','pekka','princess','royal-ghost','royal-hogs',
  'skeleton-army','tesla','valkyrie','wall-breakers','witch','wizard','zap'];

// ── Card elixir costs, keyed by the same display name BATTLE_LOG's DECK
// column records (see parseBattleLogSheet(), parse.js) — powers the deck
// history modal's Avg Elixir stat (calcDeckAvgElixir(), tab-live.js).
// Pulled directly from the live CR API's own /cards endpoint through the
// proxy rather than typed from memory, so every value is Supercell's.
// Kept as a static manifest (same reasoning as ALL_CARD_SLUGS above) so
// the stat works offline and costs no extra request per load; add new
// cards here by hand alongside the other manifests when they ship.
//
// Mirror is deliberately ABSENT, not an oversight: it has no fixed cost
// (it copies the mirrored card's cost +1) and the API itself returns no
// elixirCost field for it. calcDeckAvgElixir() averages over the cards it
// does know, so a Mirror deck still reports a real average for its other
// 7 cards instead of a wrong number or a blank.
const CARD_ELIXIR = {
  'Archer Queen':5,'Archers':3,'Arrows':3,'Baby Dragon':4,'Balloon':5,'Bandit':3,
  'Barbarian Barrel':2,'Barbarian Hut':6,'Barbarians':5,'Bats':2,'Battle Healer':4,'Battle Ram':4,
  'Berserker':2,'Bomb Tower':4,'Bomber':2,'Boss Bandit':6,'Bowler':5,'Cannon':3,'Cannon Cart':5,
  'Clone':3,'Dark Prince':4,'Dart Goblin':3,'Earthquake':3,'Electro Dragon':5,'Electro Giant':7,
  'Electro Spirit':1,'Electro Wizard':4,'Elite Barbarians':6,'Elixir Collector':6,
  'Elixir Golem':3,'Executioner':5,'Fire Spirit':1,'Fireball':4,'Firecracker':3,'Fisherman':3,
  'Flying Machine':4,'Freeze':4,'Furnace':4,'Giant':5,'Giant Skeleton':6,'Giant Snowball':2,
  'Goblin Barrel':3,'Goblin Cage':4,'Goblin Curse':2,'Goblin Demolisher':4,'Goblin Drill':4,
  'Goblin Gang':3,'Goblin Giant':6,'Goblin Hut':4,'Goblin Machine':5,'Goblins':2,'Goblinstein':5,
  'Golden Knight':4,'Golem':8,'Graveyard':5,'Guards':3,'Heal Spirit':1,'Hog Rider':4,'Hunter':4,
  'Ice Golem':2,'Ice Spirit':1,'Ice Wizard':3,'Inferno Dragon':4,'Inferno Tower':5,'Knight':3,
  'Lava Hound':7,'Lightning':6,'Little Prince':3,'Lumberjack':4,'Magic Archer':4,'Mega Knight':7,
  'Mega Minion':3,'Mighty Miner':4,'Miner':3,'Mini P.E.K.K.A':4,'Minion Horde':5,'Minions':3,
  'Monk':5,'Mortar':4,'Mother Witch':4,'Musketeer':4,'Night Witch':4,'P.E.K.K.A':7,'Phoenix':4,
  'Poison':4,'Prince':5,'Princess':3,'Rage':2,'Ram Rider':5,'Rascals':5,'Rocket':6,'Ronin':5,
  'Royal Delivery':3,'Royal Ghost':3,'Royal Giant':6,'Royal Hogs':5,'Royal Recruits':7,
  'Rune Giant':4,'Skeleton Army':3,'Skeleton Barrel':3,'Skeleton Dragons':4,'Skeleton King':4,
  'Skeletons':1,'Sparky':6,'Spear Goblins':2,'Spirit Empress':6,'Suspicious Bush':2,'Tesla':4,
  'The Log':2,'Three Musketeers':9,'Tombstone':3,'Tornado':3,'Valkyrie':4,'Vines':3,'Void':5,
  'Wall Breakers':2,'Witch':5,'Wizard':5,'X-Bow':6,'Zap':2,'Zappies':4
};

// ── Card debug manifest — every official card's real display name +
// special flag ('evo' | 'hero' | null), used ONLY by the Card Art Debug
// popup (buildCardDebugGrid(), tab-live.js) to let Dunk visually audit
// art against name/tag on demand. Unlike ALL_CARD_SLUGS above (which only
// has slugs), this needs real display names for the on-screen label, so
// it can't be derived from the slug list. Kept in sync by hand alongside
// ALL_CARD_SLUGS/EVO_CARD_SLUGS whenever a new card is added.
const CARD_DEBUG_MANIFEST = [{"name":"Archer Queen","special":"hero"},{"name":"Archers","special":null},{"name":"Arrows","special":null},{"name":"Baby Dragon","special":"evo"},{"name":"Balloon","special":"evo"},{"name":"Bandit","special":null},{"name":"Barbarian Barrel","special":null},{"name":"Barbarian Hut","special":null},{"name":"Barbarians","special":"evo"},{"name":"Bats","special":null},{"name":"Battle Healer","special":null},{"name":"Battle Ram","special":null},{"name":"Berserker","special":null},{"name":"Bomb Tower","special":null},{"name":"Bomber","special":"evo"},{"name":"Boss Bandit","special":"hero"},{"name":"Bowler","special":null},{"name":"Cannon","special":"evo"},{"name":"Cannon Cart","special":null},{"name":"Clone","special":null},{"name":"Dark Prince","special":null},{"name":"Dart Goblin","special":"evo"},{"name":"Earthquake","special":null},{"name":"Electro Dragon","special":null},{"name":"Electro Giant","special":null},{"name":"Electro Spirit","special":null},{"name":"Electro Wizard","special":null},{"name":"Elite Barbarians","special":null},{"name":"Elixir Collector","special":null},{"name":"Elixir Golem","special":null},{"name":"Executioner","special":null},{"name":"Fire Spirit","special":null},{"name":"Fireball","special":null},{"name":"Firecracker","special":null},{"name":"Fisherman","special":null},{"name":"Flying Machine","special":null},{"name":"Freeze","special":null},{"name":"Furnace","special":"evo"},{"name":"Giant","special":null},{"name":"Giant Skeleton","special":null},{"name":"Giant Snowball","special":"evo"},{"name":"Goblin Barrel","special":"evo"},{"name":"Goblin Cage","special":"evo"},{"name":"Goblin Curse","special":null},{"name":"Goblin Demolisher","special":null},{"name":"Goblin Drill","special":"evo"},{"name":"Goblin Gang","special":null},{"name":"Goblin Giant","special":"evo"},{"name":"Goblin Hut","special":null},{"name":"Goblin Machine","special":null},{"name":"Goblins","special":null},{"name":"Goblinstein","special":"hero"},{"name":"Golden Knight","special":"hero"},{"name":"Golem","special":null},{"name":"Graveyard","special":null},{"name":"Guards","special":null},{"name":"Heal Spirit","special":null},{"name":"Hog Rider","special":null},{"name":"Hunter","special":null},{"name":"Ice Golem","special":null},{"name":"Ice Spirit","special":"evo"},{"name":"Ice Wizard","special":null},{"name":"Inferno Dragon","special":"evo"},{"name":"Inferno Tower","special":null},{"name":"Knight","special":null},{"name":"Lava Hound","special":null},{"name":"Lightning","special":null},{"name":"Little Prince","special":"hero"},{"name":"Lumberjack","special":"evo"},{"name":"Magic Archer","special":null},{"name":"Mega Knight","special":"evo"},{"name":"Mega Minion","special":null},{"name":"Mighty Miner","special":"hero"},{"name":"Miner","special":null},{"name":"Mini P.E.K.K.A","special":null},{"name":"Minion Horde","special":"evo"},{"name":"Minions","special":null},{"name":"Mirror","special":null},{"name":"Monk","special":"hero"},{"name":"Mortar","special":null},{"name":"Mother Witch","special":null},{"name":"Musketeer","special":"evo"},{"name":"Night Witch","special":null},{"name":"P.E.K.K.A","special":"evo"},{"name":"Phoenix","special":null},{"name":"Poison","special":null},{"name":"Prince","special":null},{"name":"Princess","special":"evo"},{"name":"Rage","special":null},{"name":"Ram Rider","special":null},{"name":"Rascals","special":null},{"name":"Rocket","special":null},{"name":"Ronin","special":null},{"name":"Royal Delivery","special":null},{"name":"Royal Ghost","special":"evo"},{"name":"Royal Giant","special":null},{"name":"Royal Hogs","special":"evo"},{"name":"Royal Recruits","special":null},{"name":"Rune Giant","special":null},{"name":"Skeleton Army","special":"evo"},{"name":"Skeleton Barrel","special":null},{"name":"Skeleton Dragons","special":null},{"name":"Skeleton King","special":"hero"},{"name":"Skeletons","special":null},{"name":"Sparky","special":null},{"name":"Spear Goblins","special":null},{"name":"Spirit Empress","special":null},{"name":"Suspicious Bush","special":null},{"name":"Tesla","special":"evo"},{"name":"The Log","special":null},{"name":"Three Musketeers","special":null},{"name":"Tombstone","special":null},{"name":"Tornado","special":null},{"name":"Valkyrie","special":"evo"},{"name":"Vines","special":null},{"name":"Void","special":null},{"name":"Wall Breakers","special":"evo"},{"name":"Witch","special":"evo"},{"name":"Wizard","special":"evo"},{"name":"X-Bow","special":null},{"name":"Zap","special":"evo"},{"name":"Zappies","special":null}];

