// ══════════════════════════════════════════════════════════════════
//  TAB-ANALYSIS.JS
//  The "Analysis" tab: player value scorecard with promotion/demotion
//  signals. renderAnalysis() is the entry point; setAnalysisFilter()
//  is this tab's own Active/Inactive toggle-button handler.
//
//  The actual scoring math (calcPlayerAnalytics/calcValueScore/
//  calcSignal) lives in calculations.js, not here — this file only
//  builds the HTML cards from those numbers.
// ══════════════════════════════════════════════════════════════════

function renderAnalysis() {
  const clanFameAvg  = clanAvgFamePerPlayer();
  const clanDecksAvg = clanAvgDecksPerPlayer();
  const fameBattleAvg = clanDecksAvg > 0 ? clanFameAvg / clanDecksAvg : 0;

  // Main active = in LIVE_ROLES AND not a swapper
  // Main inactive = not in LIVE_ROLES AND not a swapper
  // Swapper section = ALL known swapper accounts (always shown, both views)
  const allSwappers    = PLAYERS.filter(p => SWAPPER_NAMES.has(p.name.toLowerCase().trim()));
  const nonSwappers    = PLAYERS.filter(p => !SWAPPER_NAMES.has(p.name.toLowerCase().trim()));
  const activePlayers  = nonSwappers.filter(p => !!LIVE_ROLES[p.name.toLowerCase().trim()]);
  const inactivePlayers= nonSwappers.filter(p => !LIVE_ROLES[p.name.toLowerCase().trim()]);
  const mainPlayers    = analysisFilter === 'active' ? activePlayers : inactivePlayers;

  // Compute analytics for main players, then sort by value score (best
  // first) -- this ranking is the single source of truth for both the
  // display order AND the rank-based promotion/demotion signal below.
  const mainWithAnalytics = mainPlayers
    .map(p => ({ p, analytics: calcPlayerAnalytics(p) }))
    .sort((a, b) => calcValueScore(b.analytics, clanFameAvg, clanDecksAvg) - calcValueScore(a.analytics, clanFameAvg, clanDecksAvg));

  // Rank position for the tier-based signal: only players with enough war
  // data to be meaningfully ranked (qualifyingWars > 0, not recentlyJoined)
  // count toward rank/tier boundaries -- brand-new players get the NEW
  // badge instead of a signal, same as before, and don't skew the thirds.
  const rankedForTiers = mainWithAnalytics.filter(e => e.analytics.qualifyingWars > 0 && !e.analytics.recentlyJoined);
  rankedForTiers.forEach((entry, idx) => {
    entry.signal = calcSignal(entry.p, entry.analytics, clanFameAvg, clanDecksAvg, idx, rankedForTiers.length);
  });

  // All swappers with analytics — sorted: in-clan first, then out-of-clan
  const swapperWithAnalytics = allSwappers
    .map(p => ({ p, analytics: calcPlayerAnalytics(p), inClan: !!LIVE_ROLES[p.name.toLowerCase().trim()] }))
    .sort((a, b) => (b.inClan ? 1 : 0) - (a.inClan ? 1 : 0));

  function signalHtml(signal, analytics, p) {
    if (analytics.qualifyingWars === 0 || analytics.recentlyJoined) {
      return `<div class="an-signal an-signal-new" title="Not enough war data yet">NEW</div>`;
    }
    if (!signal) return `<div class="an-signal an-signal-neutral" title="No signal">—</div>`;
    const cls = {
      'up-coleader': 'an-signal-up-coleader',
      'up-elder':    'an-signal-up-elder',
      'down-elder':  'an-signal-down-elder',
      'down-member': 'an-signal-down-member',
      'down-kick':   'an-signal-down-kick',
      'neutral':     'an-signal-neutral'
    }[signal.type] || 'an-signal-neutral';
    return `<div class="an-signal ${cls}" title="${signal.tooltip}">${signal.label}</div>`;
  }

  function valueBarHtml(analytics, isSwap = false) {
    if (analytics.qualifyingWars === 0 || analytics.recentlyJoined) return '';
    const { qualifyingWars, participationRate, avgDecksPerWar, avgFamePerWar, avgFamePerBattle } = analytics;
    const fb = clanDecksAvg > 0 ? clanFameAvg / clanDecksAvg : 1;

    // Swappers scored purely on fame/battle efficiency
    if (isSwap) {
      const v = avgFamePerBattle / Math.max(fb, 1);
      const pct = Math.min(v / 1.5 * 100, 100);
      const color = v >= 1.1 ? 'var(--green)' : v >= 0.85 ? 'var(--gold)' : v >= 0.6 ? 'var(--orange)' : 'var(--red)';
      return `<div class="an-value-bar-wrap">
        <div class="an-value-bar-bg"><div class="an-value-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <div class="an-value-lbl" style="color:${color}">${(v*100).toFixed(0)}</div>
      </div>`;
    }

    const v = calcValueScore(analytics, clanFameAvg, clanDecksAvg);
    const pct = Math.min(v / 1.5 * 100, 100);
    const color = v >= 1.1 ? 'var(--green)' : v >= 0.85 ? 'var(--gold)' : v >= 0.6 ? 'var(--orange)' : 'var(--red)';
    return `<div class="an-value-bar-wrap">
      <div class="an-value-bar-bg"><div class="an-value-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
      <div class="an-value-lbl" style="color:${color}">${(v*100).toFixed(0)}</div>
    </div>`;
  }

  function statsHtml(analytics, isSwapper) {
    const { qualifyingWars, participationRate, avgDecksPerWar, avgFamePerWar, avgFamePerBattle, consistency } = analytics;
    if (!qualifyingWars) return '';
    const fmt = (n, d=0) => isFinite(n) ? n.toFixed(d) : '—';
    const pct = (n) => isFinite(n) ? (n*100).toFixed(0)+'%' : '—';

    const fb = clanDecksAvg > 0 ? clanFameAvg / clanDecksAvg : 1;

    const fameBattleColor = avgFamePerBattle >= fb * 1.15 ? '#26c281'
      : avgFamePerBattle >= fb * 0.95 ? '#7ecf5a'
      : avgFamePerBattle >= fb * 0.75 ? 'var(--gold)'
      : avgFamePerBattle >= fb * 0.50 ? 'var(--orange)'
      : 'var(--red)';

    const warsColor = qualifyingWars >= 15 ? '#d4a017'
      : qualifyingWars >= 10 ? '#8a96a8'
      : qualifyingWars >= 5  ? '#a0522d'
      : 'var(--text-dim)';

    const stat = (val, color, label) =>
      `<div class="an-stat"><div class="an-stat-val" style="color:${color}">${val}</div><div class="an-stat-lbl">${label}</div></div>`;

    // Swappers: only fame/battle efficiency and longevity matter
    if (isSwapper) {
      return `<div class="an-stats" style="grid-template-columns:repeat(2,1fr)">
        ${stat(fmt(avgFamePerBattle,0), fameBattleColor, 'Fame/Battle')}
        ${stat(qualifyingWars,          warsColor,       'Wars Rated')}
      </div>`;
    }

    const partColor = participationRate >= 0.90 ? '#26c281'
      : participationRate >= 0.75 ? '#7ecf5a'
      : participationRate >= 0.60 ? 'var(--gold)'
      : participationRate >= 0.40 ? 'var(--orange)'
      : 'var(--red)';

    const decksColor = avgDecksPerWar >= 15 ? '#26c281'
      : avgDecksPerWar >= 13 ? '#7ecf5a'
      : avgDecksPerWar >= 10 ? 'var(--gold)'
      : avgDecksPerWar >= 6  ? 'var(--orange)'
      : 'var(--red)';

    const fameWarColor = avgFamePerWar >= clanFameAvg * 1.15 ? '#26c281'
      : avgFamePerWar >= clanFameAvg * 0.95 ? '#7ecf5a'
      : avgFamePerWar >= clanFameAvg * 0.75 ? 'var(--gold)'
      : avgFamePerWar >= clanFameAvg * 0.50 ? 'var(--orange)'
      : 'var(--red)';

    const consistColor = consistency >= 0.85 ? '#26c281'
      : consistency >= 0.70 ? '#7ecf5a'
      : consistency >= 0.55 ? 'var(--gold)'
      : consistency >= 0.40 ? 'var(--orange)'
      : 'var(--red)';

    return `<div class="an-stats">
      ${stat(pct(participationRate),  partColor,       'Participation')}
      ${stat(fmt(avgDecksPerWar,1),   decksColor,      'Decks/War')}
      ${stat(fmt(avgFamePerWar,0),    fameWarColor,    'Fame/War')}
      ${stat(fmt(avgFamePerBattle,0), fameBattleColor, 'Fame/Battle')}
      ${stat(pct(consistency),        consistColor,    'Consistency')}
      ${stat(qualifyingWars,          warsColor,       'Wars Rated')}
    </div>`;
  }

  function buildCard(entry, rank, isSwap = false, inClan = false) {
    const { p, analytics, signal } = entry;
    const roleClass = posClass(p.pos || 'Member');
    const qw = analytics.qualifyingWars || 0;
    const vetClass = qw >= 15 ? 'vet-gold' : qw >= 10 ? 'vet-silver' : qw >= 5 ? 'vet-bronze' : '';
    const sigHtml = isSwap
      ? `<div class="an-signal an-signal-swapper" title="Swapper account — not ranked">SW</div>`
      : signalHtml(signal, analytics, p);
    const alertDot = (!isSwap && signal && signal.alert)
      ? `<span class="an-alert-dot an-alert-${signal.alert}" title="${signal.tooltip}"></span>`
      : '';
    const inClanDot = isSwap
      ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${inClan ? 'var(--green)' : 'rgba(120,120,120,0.4)'};margin-left:6px;vertical-align:middle;box-shadow:${inClan ? '0 0 5px rgba(38,194,129,0.7)' : 'none'}" title="${inClan ? 'Currently in clan' : 'Not in clan'}"></span>`
      : '';
    const warsNote = analytics.qualifyingWars > 0
      ? `<div class="an-wars-lbl">${analytics.totalWarsSinceJoining} wars as member</div>` : '';
    return `<div class="an-card ${vetClass}">
      <div class="an-card-top">
        ${isSwap ? '' : `<div class="an-rank">${rank}</div>`}
        <span class="pos-badge ${roleClass}">${p.pos || 'Member'}</span>
        <div class="an-name">${p.name}${playerTagHtml(playerTag(p), 'dot')}${inClanDot}${alertDot}</div>
        ${sigHtml}
      </div>
      ${valueBarHtml(analytics, isSwap)}
      ${statsHtml(analytics, isSwap)}
      ${warsNote}
    </div>`;
  }

  const sectionHdr = (label, color, count) =>
    `<div class="analysis-section-hdr" style="background:${color}">${label} <span style="font-family:'Share Tech Mono',monospace;font-size:10px;opacity:0.7;font-weight:400">${count} members</span></div>`;

  let html = '';

  // Clan avg reference bar
  html += `<div style="display:flex;gap:16px;align-items:center;padding:10px 4px 16px;flex-wrap:wrap">
    <span style="font-family:'Share Tech Mono',monospace;font-size:10px;color:rgba(255,255,255,0.55);letter-spacing:1px;text-transform:uppercase">Clan baselines (all-time, participants only):</span>
    <span style="font-family:'Orbitron',monospace;font-size:11px;font-weight:700;color:var(--gold)">Avg fame/war: ${Math.round(clanFameAvg).toLocaleString()}</span>
    <span style="font-family:'Orbitron',monospace;font-size:11px;font-weight:700;color:var(--gold)">Avg decks/war: ${clanDecksAvg.toFixed(1)}</span>
    <span style="font-family:'Orbitron',monospace;font-size:11px;font-weight:700;color:var(--gold)">Fame/battle: ${Math.round(fameBattleAvg)}</span>
    <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:rgba(255,255,255,0.4)">Value bar: 100=clan avg · green=above · red=below</span>
  </div>`;

  const searchLower = searchStr.toLowerCase();
  const filteredMain = searchStr
    ? mainWithAnalytics.filter(e => e.p.name.toLowerCase().includes(searchLower))
    : mainWithAnalytics;
  const filteredSwappers = searchStr
    ? swapperWithAnalytics.filter(e => e.p.name.toLowerCase().includes(searchLower))
    : swapperWithAnalytics;

  // Main section (non-swapper members)
  if (filteredMain.length) {
    const sectionColor = analysisFilter === 'active' ? 'var(--purple)' : 'rgba(90,104,128,0.6)';
    const sectionLabel = analysisFilter === 'active' ? 'Active Members' : 'Inactive / Former';
    html += sectionHdr(sectionLabel, sectionColor, filteredMain.length);
    html += `<div class="analysis-grid">`;
    filteredMain.forEach((entry, i) => { html += buildCard(entry, i+1, false); });
    html += `</div>`;
  }

  // Swapper section — always shown (all known swapper accounts)
  if (filteredSwappers.length) {
    html += sectionHdr('Swapper Accounts', 'linear-gradient(90deg,rgba(123,84,192,0.8),rgba(123,84,192,0.5))', filteredSwappers.length);
    html += `<div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:rgba(255,255,255,0.5);margin-bottom:10px;padding:0 4px">
      All known swapper accounts · exempt from ranking · stats shown for reference
    </div>`;
    html += `<div class="analysis-grid">`;
    filteredSwappers.forEach(entry => {
      // Pass inClan status so buildCard can show the indicator
      html += buildCard({ ...entry, signal: null }, 0, true, entry.inClan);
    });
    html += `</div>`;
  }

  if (!filteredMain.length && !filteredSwappers.length) {
    html += `<div style="text-align:center;padding:60px;font-family:'Share Tech Mono',monospace;color:var(--text-dim);letter-spacing:2px">NO PLAYER DATA</div>`;
  }

  document.getElementById('main').innerHTML = html;
}

function setAnalysisFilter(f) {
  analysisFilter = f;
  document.getElementById('an-active-btn').classList.toggle('active', f === 'active');
  document.getElementById('an-inactive-btn').classList.toggle('active', f === 'inactive');
  render();
}
