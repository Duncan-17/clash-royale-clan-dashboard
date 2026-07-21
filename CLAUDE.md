# United Clash Dashboard — Project Memory

This file is auto-loaded by Claude Code at the start of every session in this
project. It exists because Claude Code and Claude Chat/Cowork are separate,
isolated systems — none of the context built up designing and fixing this
app carries over automatically. Read this fully before making changes.

## 1. What this is

United Clash Dashboard is a war performance command center for a Clash
Royale clan (tag `#P0Q2Y8UG`), hosted at **unitedclash.pages.dev** on
Cloudflare Pages. As of today it is **one self-contained `index.html`**
(~4,555 lines: ~1,350 lines CSS, ~140 lines HTML shell, ~3,000 lines JS)
plus an `assets/` folder of images. No build system, no npm, no framework —
deploy is "zip index.html + assets/, upload to Cloudflare Pages."

**Do not break that deploy simplicity without discussing it first.** The
refactor described in section 5 splits the JS into multiple plain files
loaded via classic (non-module) `<script src="...">` tags specifically
*because* that requires no build step and keeps every function in one
shared global scope — 35 inline `onclick="..."` attributes in the HTML
(covering 14 handler functions like `setMode`, `setWindow`, `toggleTheme`,
etc.) depend on those functions being globally callable. If you ever
consider ES modules or a bundler instead, know that ES modules would require
explicitly attaching every one of those handlers to `window`, and a bundler
reverses the no-build-step principle entirely — get explicit sign-off
before going either of those routes.

## 2. Data sources

**Google Sheet** (public CSV export, id `1BTfdXFWsrN4i15jEiICvEQqt42gvZQMYuHxXYPOsRq8`):
- `WARS` — one row per finalized war: WAR_ID, WAR_TYPE (normal/colosseum), rank, trophy change, clan fame, dates.
- `WAR_PLAYERS` — one row per player per finalized war: FAME, DECKS_USED, BOAT_ATTACKS. Wars 13-16 have null DECKS_USED (code assumes 16 if FAME > 0).
- `STANDINGS` — all 5 competing clans' placement per war (rank, trophy change, fame, clan score).
- `SNAPSHOTS` — written every ~15 min during an active war by the Apps Script: TIMESTAMP, WAR_ID, PLAYER_TAG, PLAYER_NAME, CUM_FAME, CUM_DECKS, DECKS_TODAY, PERIOD_INDEX, PERIOD_TYPE. Source of truth for all live/in-progress and "reviewing last war" calculations. Only the current pending war + the most recently finished war are kept (older snapshots pruned once `WAR_PLAYERS`/`WARS` has the finalized data).
- `SWAPPER_OVERRIDES` — column A, one lowercase player name per row. Manually maintained list of "swapper" accounts (people who rotate between multiple accounts). Fetched with `.catch(()=>null)` so a missing tab doesn't break anything.

**Clash Royale API** via a Cloudflare Worker proxy (`unitedclash-proxy.dncanzano.workers.dev`):
- `/clans/TAG/currentriverrace` → live war data (fame, decksUsed, decksUsedToday per participant).
- `/clans/TAG/members` → current roster with roles.

**Google Apps Script** (separate project, not part of this refactor): polls the CR API hourly, finalizes completed wars into WARS/WAR_PLAYERS/STANDINGS from `riverracelog` (authoritative, matched by `createdDate`, idempotent), and snapshots the live war into SNAPSHOTS while active. Contains the CR API key — **this key lives only in the Apps Script, never in index.html.** This refactor does not touch the Apps Script.

## 3. The four tabs (current index.html structure)

- **Data** (`renderData`, `buildRow`, `buildSection`, `buildWarHeaders`) — sortable player table with a war-by-war heatmap. Columns: #, Player, Role, Active, Participation, Trend, Avg Battles, Avg Score, then one column per shown war.
- **Live** (`renderLive`, `buildLiveDayColumn`, `buildWarSummaryBox`, `buildWarSummaryTable`, `buildProjectionWidget`) — active-war tracker: 4 day columns, summary stat cards, projection widget, and a bottom summary table. Also handles "reviewing last war" mode (`isSheetReview`/`usingSheetFallback`) when the API has moved to a new race but the last war's data should still display.
- **Graphic** (`renderGraphic`, `drawChart`, `togglePlayerChart`) — two SVG bar charts (clan total fame/war, avg fame/player/war) plus expandable per-player charts.
- **Analysis** (`renderAnalysis`, `calcSignal`, `calcValueScore`, `buildCard`) — player value scorecard with promotion/demotion signals. See section 4 — this is the most recently and heavily changed part of the app.

## 4. Recent changes this session (July 2026) — understand these before touching Analysis or Live

- **Promotion/demotion is now rank-position-based, not fixed thresholds.** Active members are sorted by `calcValueScore()`, then split into thirds: top third → Co-Leader tier, middle third → Elder tier, bottom third → Member. A player's signal arrow just reflects whether their current role matches the tier their rank implies (`tierForRank()` in `calcSignal()`).
- **Tenure gates cap eligibility regardless of score:** `ELDER_MIN_WARS = 8`, `COLEADER_MIN_WARS = 15` (interpreted as qualifying wars played, not raw battle count — confirm with Dunk if that's ever ambiguous). A player ranked into a tier they haven't got the tenure for is capped at the highest tier they qualify for — this applies uniformly, so an existing Co-Leader who's dropped under 15 wars gets flagged for demotion on tenure grounds too.
- **Signal color reflects the DESTINATION tier, not "promotion vs demotion" generically:** gold = Co-Leader tier, blue = Elder tier, green = Member tier. CSS classes: `an-signal-up-coleader`/`an-signal-down-member` no longer literally mean "up to/down to Member" — check `type` (`up-coleader`, `up-elder`, `down-elder`, `down-member`, `down-kick`, `neutral`) against the color, not the class name alone.
- **`calcValueScore(an, clanFameAvg, clanDecksAvg)` is the single source of truth** for both the Active Members sort order AND the on-card value bar — do not let these drift into separate inline formulas again (they used to be duplicated in two places; this was consolidated). Current weights: fameWarNorm 25%, fameBattleNorm 15%, participationRate 20%, decksNorm (% of 16 battles/war actually played) 20%, tenureNorm (qualifyingWars / 15, capped at 1.0) 20%. This was deliberately reweighted away from fame-dominance (was 60% combined fame) toward reliability (tenure + deck completion + participation, now 60% combined) — don't revert this without checking with Dunk, it was a deliberate fix for consistent-but-modest-fame players ranking too low.
- **Rank/placement tie-for-1st logic:** `getAdjustedRank(standing, allStandingsForWar)` (near `getOurStandingsForWar`) is the single source of truth for war placement display — used by both the Data tab war headers and the Live tab summary box. On a normal (non-Colosseum) week, clan fame caps at `NORMAL_WAR_FAME_CAP = 10000` (the finish line); if our clan and whoever Supercell ranked #1 both hit that cap, it's treated as a tie and displayed as 1st, since Supercell's own rank field breaks ties on a hidden criterion we can't see. **Never compute rank display two different ways in two places — always route through `getAdjustedRank`.**
- **Live tab card lists now include zero-battle members**, not just contributors — a clan member who missed an entire war still shows as a card (so leaders can see who missed battles), both during a live war (already worked, via the LIVE_ROLES merge) and in "reviewing last war" mode (previously filtered these out entirely — fixed).
- **The `WAR_ROSTER_SIZE = 50` cap must be respected in war-summary averages**, but real contributors (decks>0 or fame>0) are NEVER excluded even if churn across the war's 4 days pushes total contributors past 50 (this happens due to mid-war swaps/kicks) — only zero-battle padding is capped to keep the total at 50. See `countedPlayers` construction in `buildWarSummaryBox`.
- **Day-column contributor counts (`dayContributors`, the "n/50 members" header number) must NOT be gated by current-moment `LIVE_ROLES`/`SWAPPER_NAMES` membership.** It used to be, which silently uncounted anyone who battled that day but has since been kicked. Count anyone with real decks that day, full stop — mirrors how `dayBattles` (the x/200 number) was already computed with no such gate.
- **CSS font leak (fixed):** `body.theme-light table:not(.live-summary-table) tbody td:nth-child(3) span` — this selector must stay scoped away from `.live-summary-table`, or its 3rd column (Total Fame) silently gets forced into the wrong font again.

## 5. Fragile points carried over from before this session — still true, still easy to break

- **Swapper role override placement:** `if (SWAPPER_NAMES.has(key)) p.pos = 'Swapper';` must run AFTER the `LIVE_ROLES` role-assignment loop in `loadAll()`. Has been dropped by mistake before.
- **`swapperAwareScores()` vs `effectiveScores()`:** `buildRow` (Data tab) uses `swapperAwareScores()` for avg/participation/trend — it maps a swapper's `0` scores to `null` (present-without-battling shouldn't count as a bad war). Never swap these two functions.
- **`isInactive()` swapper bypass:** `if (SWAPPER_NAMES.has(key)) return false;` must be the first line — swappers are never shown as inactive regardless of their last score.
- **Swapper zero handling in `calcPlayerAnalytics`:** `if (isSwapper && score === 0) { score = null; decks = null; }` — `score` must be declared with `let`, not `const`, for this reassignment.
- **`isCurrentlyInClan()` roster-loaded guard:** only trust `LIVE_ROLES` once `Object.keys(LIVE_ROLES).length > 10` (i.e. the API actually returned real roster data) — otherwise fall back to `SWAPPER_NAMES` only.
- **`seenInPeriod` backfill in `buildLiveFromSnapshots`:** must track every row seen per period (including 0-deck rows), and only backfills a day when the player was seen that day with 0 cumulative decks AND the *earliest* next-day snapshot shows decks > 0 (handles battles played in the final gap before period rollover). Don't relax this condition — it was tuned against specific real observed cases.
- **`perDayFame` must be declared before `projMax`** in `buildProjectionWidget` — `const projMax = Math.max(...perDayFame)` is a temporal-dead-zone crash if the declaration order is reversed.
- **Historical average zero-exclusion:** any `warPlayerAvgs`-style filter must include `&& s > 0`, not just `s !== null` — otherwise non-participants deflate the baseline.
- **`windowOffset` in avg-decks calculations** must stay in sync with whatever `swapperAwareScores()` currently does, since it aligns a windowed score slice back to `p.decks[]`.

## 6. Refactor plan already agreed with Dunk (do this before any mobile/PWA work)

**Phase 1 — mechanical file split, zero logic changes.** Cut the current single file into:
- `index.html` — just the HTML shell + `<style>` block + `<script src>` tags, in order.
- `js/config.js` — CLAN_TAG, sheet URLs, war-format constants (DECKS_PER_DAY, WAR_DAYS, WAR_ROSTER_SIZE, DAILY_BATTLE_CAP, WAR_BATTLE_CAP, NORMAL_WAR_FAME_CAP, ELDER_MIN_WARS, COLEADER_MIN_WARS, TIER_S/A/B/C, etc.)
- `js/state.js` — global data stores (WARS, PLAYERS, LIVE_DATA, LIVE_ROLES, LIVE_SHEET_DATA, SWAPPER_NAMES, WAR_STANDINGS, LIVE_RACE_CLANS, ALL_SCORES_FLAT) + UI state vars (mode, warWindow, sortMode, searchStr, etc.)
- `js/parse.js` — CSV/sheet/API parsing (`parseCSV`, `cleanName`, `parseWarsSheet`, `parseStandingsSheet`, `buildLiveFromSnapshots`, `parseRaceClans`, etc.) + `loadAll()`.
- `js/calculations.js` — shared math (`calcAvg`, `calcTrend`, `calcPlayerAnalytics`, `calcValueScore`, `calcSignal`, `isInactive`, `playerTag`, `getAdjustedRank`, etc.)
- `js/tab-data.js`, `js/tab-live.js`, `js/tab-graphic.js`, `js/tab-analysis.js` — each tab's own render/build functions.
- `js/main.js` — mode/sort/search toggle handlers, theme setup, bootstrap calls at the bottom (`initTheme(); applyRandomBanner(); loadAll();`).

Verify by concatenating all split files back in load order and diffing that reconstruction against the pre-split file — should be an exact match (or comment/whitespace-only differences). Commit this phase before moving on.

**Phase 2 — separate calculation logic from HTML-building, one function at a time.** e.g. `buildWarSummaryBox()` currently computes numbers (missed %, avg, rank, grade) AND builds HTML in one function — split into a pure calc function returning a plain data object, and a separate render function that only builds HTML from that object. This is a real logic-touching change, not just reorganization — do it incrementally, one function/tab at a time, verifying known-good numbers still hold after each one (e.g. war 29 should still show avg 2,219, cumulative score 122,050, tied-1st placement).

**Safety process for both phases:** commit after every verified step. Never mix "moving code" and "improving code" in the same commit. If anything looks off, the small commit size makes it trivial to isolate and revert.

## 7. What comes after the refactor

Mobile responsiveness (CSS breakpoints, Live tab day-selector instead of side-by-side columns on narrow screens, Data tab sticky-column horizontal scroll for the war heatmap) and a PWA layer (`manifest.json`, `service-worker.js`, cache-first for the app shell / network-first for live data, cache-version bumping on every deploy since there's no build-hash cache-busting). Not in scope until the refactor above is fully verified and Dunk has confirmed it live.
