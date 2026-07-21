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
  // Update header stats
  const activePlayers = PLAYERS.filter(p => LIVE_PARTICIPANTS.has(p.name.toLowerCase()));
  const activeCount = activePlayers.length || PLAYERS.filter(p => !isInactive(p)).length;
  // Best avg is always all-time best
  const allTimeAvgs = PLAYERS.map(p => calcAvg(effectiveScores(p), 0)).filter(a => a > 0);
  const topAvg = allTimeAvgs.length ? Math.max(...allTimeAvgs) : 0;

  // Clan avg respects current window toggle
  const windowAvgs = PLAYERS
    .filter(p => !isInactive(p))
    .map(p => calcAvg(effectiveScores(p), warWindow))
    .filter(a => a > 0);
  const clanAvg = windowAvgs.length ? Math.round(windowAvgs.reduce((a,b)=>a+b,0)/windowAvgs.length) : 0;
  const windowLabel = warWindow === 0 ? 'All' : warWindow + 'W';

  document.getElementById('hs-wars').textContent   = WARS.length;
  document.getElementById('hs-active').textContent = activeCount;
  document.getElementById('hs-top').textContent    = topAvg > 0 ? topAvg.toLocaleString() : '—';
  document.getElementById('hs-clan-avg').textContent = clanAvg > 0 ? clanAvg.toLocaleString() : '—';
  document.getElementById('hs-clan-avg-lbl').textContent = 'Clan Avg (' + windowLabel + ')';

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
  const dataOnly = ['grp-window','div-sort','grp-sort','div-battles','grp-battles-wrap','div-inclive','grp-inclive'];
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

  document.getElementById('st-time').style.display = '';
  document.getElementById('st-time-val').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ══════════════════════════════════════════════════════
//  CONTROLS
// ══════════════════════════════════════════════════════
function setMode(m) {
  mode = m;
  document.getElementById('main').innerHTML = '';
  document.querySelectorAll('.control-bar .btn-group:first-child .btn').forEach((b, i) => {
    b.classList.toggle('active', ['data','live','graphic','analysis'][i] === m);
  });
  render();
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

// ══════════════════════════════════════════════════════
//  THEME (Dark / Royal-light toggle)
// ══════════════════════════════════════════════════════
function toggleTheme() {
  return; // Dark mode disabled — Royal mode only
  const light = document.body.classList.toggle('theme-light');
  try { localStorage.setItem('uc-theme', light ? 'light' : 'dark'); } catch(e) {}
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = light ? '🌙 Dark' : '☀ Royal';
  syncChartColors();
  render();
}

// ── Random Clash-Royale banner behind the top header (royal theme) ──
const BANNER_BGS = ['84_EldritchEntombed_BG.webp','84_SliceAndDice_BG.webp','BlazingKnightBG.webp','BombingJumpBG.webp','BowlerWithStyleBG.webp','BunchOfBalloonsBG.webp','CameleonDragonBG.webp','ClashAnimalsBG.webp','CuriousDragonBG.webp','DarkInTheFieldBG.webp','DarkRegal_May2026_Arena_3K.webp','DragonsGangBG.webp','FireAndIceDuelBG.webp','FishAndFurnaceBG.webp','FlowersAndMusketeerBG.webp','FurnaceWalkBG.webp','GiveARoseBG.webp','LavaLampBG.webp','MagicalFurnanceBG.webp','NappyTimeBG.webp','OchreKnightBG.webp','OldSchoolKnightBG.webp','PorcoBG.webp','PurpleEyesBG.webp','RelaxingTimeBG.webp','RomanticSkeletonBG.webp','TinyFireflyBG.webp','TitanicBG.webp','dragons_nests_arena_4K.webp','march2026_birthday_arena_3K.webp'];
function applyRandomBanner() {
  const pick = BANNER_BGS[Math.floor(Math.random() * BANNER_BGS.length)];
  const h = document.querySelector('.header');
  if (h) h.style.setProperty('--banner-bg', "url('assets/" + pick + "')");
}

function initTheme() {
  // Royal mode locked — dark mode disabled
  document.body.classList.add('theme-light');
  try { localStorage.setItem('uc-theme', 'light'); } catch(e) {}
}

initTheme();
applyRandomBanner();
loadAll();
