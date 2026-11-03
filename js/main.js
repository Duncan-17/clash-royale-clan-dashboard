// ══════════════════════════════════════════════════════════════════
//  MAIN.JS
//  The master render() dispatcher, the global mode/window/sort/search
//  control handlers shared across tabs, theme setup, and the bootstrap
//  calls that actually start the app.
//
//  This file MUST load LAST — its bottom three lines
//  (initTheme(); applyRandomBanner(); loadAll();) kick off the entire
//  app, and by the time they run every other file's functions/consts
//  must already be defined.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  MASTER RENDER
// ══════════════════════════════════════════════════════
function render() {
  syncChartColors();
  // Header ranking stats (Total Wars/Active/Best Avg/Clan Avg moved to the
  // Data tab's clan summary row instead -- see calcClanSummaryRow() in
  // tab-data.js). CLAN_RANKINGS is fetched once per loadAll() (parse.js's
  // fetchClanRankings(), cached 24h) -- render() just displays it.
  document.getElementById('hs-us-rank').textContent = CLAN_RANKINGS.usRank ? '#' + CLAN_RANKINGS.usRank.toLocaleString() : '—';
  document.getElementById('hs-world-rank').textContent = CLAN_RANKINGS.worldRank ? '#' + CLAN_RANKINGS.worldRank.toLocaleString() : '—';

  if (Object.keys(LIVE_DATA).length) {
    const badge = document.getElementById('live-badge');
    const dot   = document.getElementById('live-dot');
    const txt   = document.getElementById('live-badge-text');
    badge.style.display = 'flex';
    if (warHasStarted()) {
      badge.classList.remove('training');
      dot.style.background = 'var(--green)';
      dot.style.animation  = 'pulse 2s infinite';
      txt.textContent = 'LIVE WAR';
    } else {
      badge.classList.add('training');
      dot.style.background = 'var(--gold)';
      dot.style.animation  = 'none';
      txt.textContent = 'TRAINING DAY';
    }
  }

  // Show/hide mode-specific controls
  // grp-pb-data/div-pb-data: the Data tab's own Personal Best toggle.
  // This was missing from dataOnly before, so it showed in every mode —
  // harmless on Live/Analysis (nothing else there uses Personal Best) but
  // duplicated with the Graphic tab's own btn-pb-graphic (inside
  // grp-graphic below), which is the actual bug this fixes.
  const dataOnly = ['grp-window','div-sort','grp-sort','div-battles','grp-battles-wrap','div-inclive','grp-inclive','div-pb-data','grp-pb-data'];
  dataOnly.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = mode === 'data' ? '' : 'none';
  });
  const gfxEl = document.getElementById('grp-graphic');
  if (gfxEl) gfxEl.style.display = mode === 'graphic' ? 'flex' : 'none';
  const liveCtrl = document.getElementById('grp-live');
  if (liveCtrl) liveCtrl.style.display = mode === 'live' ? 'flex' : 'none';
  const anCtrl = document.getElementById('grp-analysis');
  if (anCtrl) anCtrl.style.display = mode === 'analysis' ? 'flex' : 'none';

  try {
    if (mode === 'data')     renderData();
    else if (mode === 'live')     renderLive();
    else if (mode === 'graphic')  renderGraphic();
    else if (mode === 'analysis') renderAnalysis();
  } catch(e) {
    console.error('Mode render error (' + mode + '):', e);
    document.getElementById('main').innerHTML =
      `<div style="padding:40px;font-family:monospace;color:#e05252;font-size:13px">
        <b>Error rendering ${mode} tab:</b> ${e.message}<br><br>
        <pre style="white-space:pre-wrap;font-size:11px;color:#aab3c4">${e.stack}</pre>
      </div>`;
  }

  // Displays lastDataUpdate (set by loadAll() in parse.js on an actual
  // successful fetch) -- render() must not stamp its own new Date() here,
  // since render() also runs on every tab switch/sort/search with no new
  // data involved (see state.js's lastDataUpdate comment).
  document.getElementById('st-time').style.display = lastDataUpdate ? '' : 'none';
  document.getElementById('st-offline-icon').style.display = navigator.onLine ? 'none' : '';
  if (lastDataUpdate) {
    document.getElementById('st-time-val').textContent = 'Updated ' + lastDataUpdate.toLocaleTimeString();
  }
}

// ══════════════════════════════════════════════════════
//  CONTROLS
// ══════════════════════════════════════════════════════
function setMode(m) {
  mode = m;
  document.getElementById('main').innerHTML = '';
  // Targeted by id, NOT '.control-bar .btn-group:first-child': that
  // selector matches ANY .btn-group that happens to be its own parent's
  // first child anywhere in the bar, which silently included #grp-window
  // the moment the spacer divs that used to precede it inside
  // #control-bar-extra were removed -- so switching tabs was also
  // rewriting the war-window buttons' active state by mode index.
  document.querySelectorAll('#grp-mode .btn').forEach((b, i) => {
    b.classList.toggle('active', ['data','live','graphic','analysis'][i] === m);
  });
  render();
}

// ══════════════════════════════════════════════════════
//  MOBILE TAB CONTROL RELOCATION
//  On mobile the current tab's filter/toggle controls are moved OUT of
//  the app-wide control bar and into a banner at the top of that tab's
//  own content (see tabControlBannerHtml() below and the .tab-ctrl-banner
//  CSS) -- so the sticky bar keeps only the mode switcher, search and
//  refresh, and each tab's controls sit with the section they act on.
//  This replaced a mobile-only collapse/expand handle on the control bar:
//  collapsed it was fine, but expanded it stacked 3+ cramped rows of
//  buttons above every tab.
//
//  The REAL control elements are moved, not copies. Every handler in this
//  app finds its buttons by id or by a `#grp-x .btn` selector (setSort(),
//  setWindow(), setGSort(), toggleIncludeLive(), render()'s own per-mode
//  show/hide, ...), so moving the same nodes keeps all of that working
//  untouched -- and keeps the buttons visually identical, since they carry
//  their own classes with them. Duplicating markup instead would mean
//  every one of those lookups needing to know about two copies.
// ══════════════════════════════════════════════════════

// Which control elements belong to which tab. Data's controls are
// individual groups/dividers; the other three tabs each have one
// .mode-ctrl-row wrapper holding all of theirs.
const TAB_CONTROL_IDS = {
  data:     ['grp-window','div-sort','grp-sort','div-battles','grp-battles-wrap',
             'div-inclive','grp-inclive','div-pb-data','grp-pb-data'],
  live:     ['grp-live'],
  graphic:  ['grp-graphic'],
  analysis: ['grp-analysis']
};

// The control bar's own wrapper + its children in their original document
// order, captured once at startup. Restoring by replaying this exact list
// (rather than tracking each element's old sibling) is what guarantees
// desktop's control-bar order is byte-identical after any number of
// mobile round trips.
let CONTROL_HOME = null;
let CONTROL_HOME_CHILDREN = [];

function initTabControlRelocation() {
  CONTROL_HOME = document.getElementById('control-bar-extra');
  if (CONTROL_HOME) CONTROL_HOME_CHILDREN = [...CONTROL_HOME.children];
}

function mobileLayoutActive() {
  return window.matchMedia('(max-width: 768px)').matches;
}

const TAB_BANNER_LABEL = {
  data: 'Data', live: 'Live War', graphic: 'General', analysis: 'Analysis'
};

// Mobile-only banner that hosts the current tab's controls, rendered as
// the first thing in each tab's own #main content.
//
// Every one of them is the SAME purple 3D ribbon as the app's other
// section headers (.section-hdr), with no per-tab tint: an earlier
// version colored each banner with its own tab's mode-button gradient
// (gold/green/purple/blue), which read as four unrelated components
// rather than as this app's one section-header treatment. The color and
// the 3D edge both come from CSS -- nothing inline here.
function tabControlBannerHtml(tab) {
  return `<div class="analysis-section-hdr tab-ctrl-banner">
    <span class="tab-ctrl-banner-lbl">${TAB_BANNER_LABEL[tab] || ''}</span>
    <div class="tab-ctrl-host" id="tab-ctrl-host"></div>
  </div>`;
}

// Move every control back to the control bar. MUST run before a tab's
// render replaces #main's innerHTML -- the hosted controls are the real
// elements, so they'd be destroyed outright, not just unmounted. Each
// renderData/renderLive/renderGraphic/renderAnalysis calls this at the
// top (rather than render() doing it once) because several toggles call
// their tab's render function directly, bypassing render().
function parkTabControls() {
  if (!CONTROL_HOME) return;
  CONTROL_HOME_CHILDREN.forEach(el => CONTROL_HOME.appendChild(el));
}

// Move the current tab's controls into the banner its render() just
// built. No-op on desktop (controls stay in the control bar) and no-op
// when the tab rendered no banner.
function mountTabControls() {
  const host = document.getElementById('tab-ctrl-host');
  if (!host || !mobileLayoutActive()) return;
  // Refresh isn't tab-specific, but it rides along into the banner on
  // every tab: leaving it in the control bar pushed it onto a second,
  // near-empty row there (the mode switcher + search already fill the
  // first), which is exactly the wasted row this whole change removes.
  // Pull-to-refresh (initPullToRefresh(), below) covers the same action
  // on mobile anyway -- this is the discoverable version of it.
  // Refresh is deliberately NOT relocated here, so it never appears on
  // mobile: pull-to-refresh (initPullToRefresh(), below) already covers
  // that action by gesture there, and a button for it in every tab banner
  // is a row of clutter for something the user can already do. It stays
  // parked in #control-bar-extra, which is hidden below the breakpoint
  // and normal on desktop -- where there's no touch gesture to replace it.
  (TAB_CONTROL_IDS[mode] || []).forEach(id => {
    const el = document.getElementById(id);
    if (el) host.appendChild(el);
  });
  // A tab whose controls are all hidden for the current state (or a tab
  // with none at all) shouldn't leave an empty banner body behind.
  host.classList.toggle('tab-ctrl-host-empty', !host.children.length);
}

function setWindow(n) {
  warWindow = n;
  document.querySelectorAll('#grp-window .btn').forEach((b, i) => {
    b.classList.toggle('active', [3,5,10,0][i] === n);
  });
  render();
}

function setSort(s) {
  sortMode = s;
  document.querySelectorAll('#grp-sort .btn').forEach((b, i) => {
    b.classList.toggle('active', ['avg','active','role','alpha','part'][i] === s);
  });
  render();
}

function toggleIncludeLive() {
  includeLive = !includeLive;
  // Update both buttons (data + graphic mode)
  ['btn-inclive','btn-inclive-g'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('btn-live-on', includeLive);
  });
  render();
}

function toggleBattles() {
  sortBattles = !sortBattles;
  const btn = document.getElementById('btn-battles');
  if (btn) btn.classList.toggle('btn-battles-on', sortBattles);
  render();
}

function togglePersonalBest() {
  showPersonalBest = !showPersonalBest;
  ['btn-pb-data','btn-pb-graphic'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('active', showPersonalBest);
  });
  render();
}

function onSearch(v) { searchStr = v; render(); }

async function refreshAll() {
  document.getElementById('st-sheet').className = 's-loading';
  document.getElementById('st-sheet').textContent = 'Refreshing...';
  document.getElementById('st-api').className = 's-loading';
  document.getElementById('st-api').textContent = 'Refreshing...';
  await loadAll(false);
}

// Called from hideLoader() (parse.js) on the initial app load only, when
// navigator.onLine is false at that moment. Requires the OK button --
// never auto-dismisses -- so it can't be missed on launch.
function showOfflineModal() {
  document.getElementById('offline-modal').classList.remove('hidden');
  syncPageScrollLock();
}
function dismissOfflineModal() {
  document.getElementById('offline-modal').classList.add('hidden');
  syncPageScrollLock();
}

// ══════════════════════════════════════════════════════
//  PAGE SCROLL LOCK (modals)
//  While any popup is open the page behind it must not scroll -- a drag
//  that started on the overlay, or one that carried past the end of the
//  popup's own scroll area, used to scroll the page underneath instead
//  (reported on both the Live tab's per-day battle popup and the
//  Analysis tab's deck history popup).
//
//  Derived from the DOM's actual state on every call rather than kept as
//  an open/close counter: closeBattleDetailModal() is deliberately called
//  in places where nothing is open (clicking empty grid space, clicking
//  a future-day card), so a counter would drift negative and eventually
//  strand the page in a locked state. Reading which overlays are visible
//  right now can't drift.
// ══════════════════════════════════════════════════════
let scrollLockY = 0;

function syncPageScrollLock() {
  const shouldLock = anyModalOpen();
  const isLocked   = document.body.classList.contains('modal-open');
  if (shouldLock === isLocked) return;

  if (shouldLock) {
    scrollLockY = pageScrollTop();
    // Desktop only (a mobile overlay scrollbar has no width): taking the
    // page out of flow removes its scrollbar, and body's width:100% then
    // spans the freed track too -- so everything behind the popup would
    // visibly widen/shift right by that much on open and back on close.
    // Holding the gap open as padding keeps the frozen page pixel-identical.
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarW > 0) document.body.style.paddingRight = scrollbarW + 'px';
    // Set BEFORE the class: adding position:fixed first would collapse the
    // page to scroll offset 0 for a frame, producing a visible jump.
    document.body.style.top = `-${scrollLockY}px`;
    document.body.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    document.body.style.paddingRight = '';
    window.scrollTo(0, scrollLockY);
  }
}

// ══════════════════════════════════════════════════════
//  THEME (Royal light theme — dark mode retired, see CLAUDE.md)
// ══════════════════════════════════════════════════════

// ── Random Clash-Royale banner behind the top header (royal theme) ──
const BANNER_BGS = ['84_EldritchEntombed_BG.webp','84_SliceAndDice_BG.webp','BlazingKnightBG.webp','BombingJumpBG.webp','BowlerWithStyleBG.webp','BunchOfBalloonsBG.webp','CameleonDragonBG.webp','ClashAnimalsBG.webp','CuriousDragonBG.webp','DarkInTheFieldBG.webp','DarkRegal_May2026_Arena_3K.webp','DragonsGangBG.webp','FireAndIceDuelBG.webp','FishAndFurnaceBG.webp','FlowersAndMusketeerBG.webp','FurnaceWalkBG.webp','GiveARoseBG.webp','LavaLampBG.webp','MagicalFurnanceBG.webp','NappyTimeBG.webp','OchreKnightBG.webp','OldSchoolKnightBG.webp','PorcoBG.webp','PurpleEyesBG.webp','RelaxingTimeBG.webp','RomanticSkeletonBG.webp','TinyFireflyBG.webp','TitanicBG.webp','dragons_nests_arena_4K.webp','march2026_birthday_arena_3K.webp'];
function applyRandomBanner() {
  const pick = BANNER_BGS[Math.floor(Math.random() * BANNER_BGS.length)];
  const h = document.querySelector('.header');
  if (h) h.style.setProperty('--banner-bg', "url('assets/" + pick + "')");
}

// ── Loading screen "curtain" ──────────────────────────────────────────
// Two SEPARATE curtains built/swept together, CSS (min(width,height)-gated
// media query, index.html) deciding which one's actually visible:
//   - Desktop: .loader-curtain, small hero-box columns over the king art.
//   - Mobile:  .loader-curtain-mobile, full-screen rows over everything
//     (title included) -- per explicit ask, a different design, not a
//     shrunk version of desktop's.
// Both are a random spread of the same war-background art used behind the
// header, swept away in proportion to REAL fetch progress as loadAll()
// runs (via setLoader(), parse.js) -- an actual progress indicator, not a
// fixed-duration decorative animation that could finish before (or long
// after) loading really has.
const LOADER_CURTAIN_COLS = 8;
const LOADER_CURTAIN_ROWS = 8;

function buildLoaderCurtain() {
  // Same dark navy overlay the header itself already layers over this
  // same art (see body.theme-light .header, further up this file) --
  // keeps a bright banner from reading as gaudy at full-screen size.
  const layerBg = bg => `linear-gradient(180deg, rgba(10,20,46,0.35), rgba(10,20,46,0.55)), url('assets/${bg}')`;

  function fill(id, count, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    // Sample distinct banners without replacement -- 30 available, at
    // most 8 needed, so no two rows/columns ever repeat the same art.
    const pool = BANNER_BGS.slice();
    const picks = [];
    for (let i = 0; i < count && pool.length; i++) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    el.innerHTML = picks.map(bg => `<div class="${cls}" style="background-image: ${layerBg(bg)}"></div>`).join('');
  }

  fill('loader-curtain', LOADER_CURTAIN_COLS, 'loader-curtain-col');
  fill('loader-curtain-mobile', LOADER_CURTAIN_ROWS, 'loader-curtain-mobile-row');
}

// Set once the FIRST time updateLoaderCurtain() runs -- see its own
// LOADER_CURTAIN_START_DELAY use below for why.
let loaderCurtainStarted = false;
// Applied ONLY to that very first call, never to any later one -- gives
// the viewer a brief beat to actually register the intact, fully-covered
// curtain before anything starts moving. Real loading always takes at
// least this long in practice, so it never delays the FINAL 100% reveal
// (which needs to stay fast -- see the per-item stagger comment below).
const LOADER_CURTAIN_START_DELAY = 250;

function updateLoaderCurtain(pct) {
  const startDelay = loaderCurtainStarted ? 0 : LOADER_CURTAIN_START_DELAY;
  loaderCurtainStarted = true;

  // A FIXED distance, not a percentage -- translateX(-110%) resolves
  // against the item's OWN (narrow, 1/8-size) box per the CSS spec, not
  // the box it needs to clear, so it only ever moved an item by a few px
  // (a real bug in an earlier version, caught by screenshotting the
  // actual rendered result, not just the intended style value). The
  // desktop column curtain uses a fixed px (comfortably bigger than
  // .loader-hero's own capped max-width); the mobile row curtain uses vw
  // instead, since it spans the device's own full (much more variable)
  // width -- a fixed px tuned for one phone could fail to clear a wider
  // one, but 120vw always exceeds the current viewport regardless of size.
  [
    { sel: '#loader-curtain .loader-curtain-col', off: 'translateX(-400px)' },
    { sel: '#loader-curtain-mobile .loader-curtain-mobile-row', off: 'translateX(-120vw)' }
  ].forEach(({ sel, off }) => {
    const items = document.querySelectorAll(sel);
    if (!items.length) return;
    const revealed = Math.floor((pct / 100) * items.length);
    items.forEach((el, i) => {
      // Small per-item delay (on top of startDelay above) so a multi-item
      // jump (setLoader() reports in a handful of discrete steps, not a
      // smooth stream) still sweeps like a wave instead of every due item
      // snapping at once. Kept small deliberately -- see the
      // transition-duration comment in index.html for why the worst case
      // (all 8 items' delays firing at once) still has to land well
      // inside hideLoader()'s 400ms wait -- startDelay never stacks with
      // that, since only the first (partial, 1-2 item) reveal ever gets it.
      el.style.transitionDelay = `${startDelay + i * 10}ms`;
      el.style.transform = i < revealed ? off : 'translateX(0)';
    });
  });
}

function initTheme() {
  // Royal mode locked — dark mode disabled
  document.body.classList.add('theme-light');
  try { localStorage.setItem('uc-theme', 'light'); } catch(e) {}
}

// Keeps --control-bar-h in sync with the sticky control bar's actual
// rendered height (varies: collapsed vs expanded, and button row-count
// differs per tab) — the mobile Data tab's sticky thead (see index.html's
// @media block) needs this so it docks directly under the control bar
// instead of overlapping it or leaving a gap.
function setupControlBarHeightTracking() {
  const bar = document.querySelector('.control-bar');
  if (!bar || !window.ResizeObserver) return;
  const update = () => document.documentElement.style.setProperty('--control-bar-h', bar.offsetHeight + 'px');
  new ResizeObserver(update).observe(bar);
  update();
}

// Re-measure the pinned name column on resize/orientation change — the
// player-name font-size (and the portrait-vs-landscape halving) differs
// between orientations, so the width measured in one isn't valid after
// rotating.
//
// Crossing the mobile breakpoint (rotating a phone, resizing a desktop
// window) also has to move the current tab's controls between the control
// bar and the tab banner — otherwise they'd stay wherever they were when
// the tab last rendered, in a layout that now hides that spot entirely.
// Guarded on the breakpoint actually changing, since resize fires
// continuously during a drag and every other resize needs no DOM moves.
let lastMobileLayout = null;
window.addEventListener('resize', () => {
  const nowMobile = mobileLayoutActive();
  if (nowMobile !== lastMobileLayout) {
    lastMobileLayout = nowMobile;
    parkTabControls();
    mountTabControls();
  }
  if (typeof applyMobileDataPinning === 'function' && mode === 'data') applyMobileDataPinning();
});

// Keeps the offline icon next to the Updated timestamp (render(), above)
// accurate the moment connectivity actually changes, rather than only on
// the next tab switch/sort/search that happens to trigger a render().
window.addEventListener('online',  render);
window.addEventListener('offline', render);

// Analysis tab's "Battle Info" button (buildCard(), tab-analysis.js) opens
// the deck history modal (tab-live.js) for that card's player. Delegated
// rather than bound per-card/per-render: a plain click listener needs none
// of attachLiveCardHighlight()'s recache/AbortController machinery (that
// exists for hover state tracking, which this button doesn't have), and a
// listener on document works regardless of how many times the Analysis
// tab's #main gets replaced.
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-battle-info');
  if (btn) showDeckHistoryModal(decodeURIComponent(btn.dataset.name));
});

// ══════════════════════════════════════════════════════
//  PULL-TO-REFRESH — dragging down from the very top of the page
//  triggers the same refreshAll() the toolbar's Refresh button already
//  calls, with an Instagram-style indicator that follows the drag.
//  Entirely touch-event-driven (see the CSS comment on #ptr-indicator
//  for why that alone keeps this mobile-only with no media query).
// ══════════════════════════════════════════════════════
const PTR_THRESHOLD  = 70;  // px pulled (after resistance) before release triggers a refresh
const PTR_MAX_PULL   = 100; // visual cap so a long drag doesn't push the page absurdly far
const PTR_RESISTANCE = 0.5; // pulled distance grows slower than the raw finger movement
const PTR_CONFIRM_PX = 8;   // px of movement required before committing to "this is a vertical pull" vs. a tap or horizontal swipe

function pageScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

// True while any full-screen popup is open -- pulling to refresh underneath
// one (e.g. scrolling inside the battle detail modal) would be a confusing,
// unrelated side effect of what's really just interacting with that popup.
// Also drives syncPageScrollLock() above, so every overlay in the app must
// be listed here -- 'deck-history-modal' (the Analysis tab's Battle Info
// popup) was missing, which is why that one popup could still pull-to-
// refresh the page underneath it while the others couldn't.
function anyModalOpen() {
  return ['battle-detail-modal', 'deck-history-modal', 'card-debug-modal', 'offline-modal'].some(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  });
}

function initPullToRefresh() {
  const app = document.getElementById('app');
  const indicator = document.getElementById('ptr-indicator');
  if (!app || !indicator) return;
  const icon = indicator.querySelector('svg');

  let startY = null, startX = null, pulling = false, confirmedVertical = false, refreshing = false;

  function resetAppTransform() {
    app.style.transition = 'transform 0.2s ease';
    app.style.transform = '';
    setTimeout(() => { app.style.transition = ''; }, 210);
  }

  function releaseWithoutRefresh() {
    resetAppTransform();
    indicator.style.transition = 'opacity 0.2s ease';
    indicator.style.opacity = '0';
    indicator.classList.remove('ptr-ready');
    setTimeout(() => { indicator.style.transition = ''; }, 210);
  }

  document.addEventListener('touchstart', e => {
    if (refreshing || anyModalOpen() || pageScrollTop() > 0 || e.touches.length !== 1) {
      startY = null; startX = null; pulling = false;
      return;
    }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    pulling = true;         // tentative -- only confirmed as a real pull once movement is unambiguous
    confirmedVertical = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling || startY == null) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;

    if (!confirmedVertical) {
      // Don't judge direction off the first pixel of jitter -- and once
      // there's enough movement to judge, a swipe that's more horizontal
      // than vertical (e.g. the Live tab's day carousel) is NOT a pull;
      // let it go as a normal touch with no preventDefault.
      if (Math.abs(dy) < PTR_CONFIRM_PX && Math.abs(dx) < PTR_CONFIRM_PX) return;
      if (Math.abs(dx) >= Math.abs(dy) || dy <= 0 || pageScrollTop() > 0) { pulling = false; return; }
      confirmedVertical = true;
    }

    if (dy <= 0 || pageScrollTop() > 0) { pulling = false; releaseWithoutRefresh(); return; }

    const pull = Math.min(PTR_MAX_PULL, dy * PTR_RESISTANCE);
    app.style.transform = `translateY(${pull}px)`;
    indicator.style.transform = `translateX(-50%) translateY(${pull - 20}px)`;
    indicator.style.opacity = String(Math.min(1, pull / PTR_THRESHOLD));
    const ready = pull >= PTR_THRESHOLD;
    indicator.classList.toggle('ptr-ready', ready);
    // Winds up proportionally to how far through the pull the finger is --
    // by the time it reaches the threshold it's done one full turn, then
    // holds there until release swaps it for the continuous spin below.
    if (icon) icon.style.transform = `rotate(${Math.min(1, pull / PTR_THRESHOLD) * 360}deg)`;
    // Only claim the gesture (block the browser's own scroll/overscroll)
    // once this is confirmed as an actual downward pull from the top --
    // never on a plain tap or a horizontal swipe.
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    const ready = indicator.classList.contains('ptr-ready');
    pulling = false;
    startY = null; startX = null;
    resetAppTransform();

    if (!ready) { releaseWithoutRefresh(); return; }

    refreshing = true;
    indicator.style.transition = 'transform 0.2s ease';
    indicator.style.transform = 'translateX(-50%) translateY(16px)';
    indicator.style.opacity = '1';
    if (icon) icon.style.transform = ''; // hand rotation off to the CSS spin animation below
    indicator.classList.add('ptr-spinning');
    try {
      await refreshAll();
    } finally {
      indicator.classList.remove('ptr-spinning', 'ptr-ready');
      indicator.style.opacity = '0';
      setTimeout(() => { indicator.style.transition = ''; }, 210);
      refreshing = false;
    }
  }, { passive: true });

  // A touch that gets interrupted (incoming call, switching apps, an OS
  // gesture taking over) still needs to visually release the pull --
  // otherwise the page could stay shifted down with no active touch left
  // to end it.
  document.addEventListener('touchcancel', () => {
    if (pulling) { pulling = false; releaseWithoutRefresh(); }
  }, { passive: true });
}

buildLoaderCurtain(); // before anything else -- must exist before loadAll()'s first setLoader() call
initTabControlRelocation(); // snapshot the control bar's original layout before any render moves things
lastMobileLayout = mobileLayoutActive();
initTheme();
applyRandomBanner();
setupControlBarHeightTracking();
initPullToRefresh();
loadAll();
