// ══════════════════════════════════════════════════════════════════
//  TAB-GRAPHIC.JS
//  The "Graphic" tab: the two clan-wide SVG bar charts (total fame/war,
//  avg fame/player/war) plus expandable per-player charts.
//  renderGraphic() is the entry point. setGMetric()/setGSort() are this
//  tab's own toggle-button handlers (kept here rather than main.js
//  since they only affect Graphic-tab state and only re-render when
//  mode === 'graphic').
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  GRAPHIC MODE HELPERS
// ══════════════════════════════════════════════════════

// Per-war clan metric (avg or max fame across active players) aligned to effectiveWars().
function getClanWarStats(metric) {
  const ew2 = effectiveWars();
  return ew2.map((w, i) => {
    const vals = PLAYERS
      .filter(p => !isInactive(p))
      .map(p => { const idx = WARS.findIndex(x => x.id === w.id); return idx === -1 ? null : p.scores[idx]; })
      .filter(s => s !== null && s > 0);
    if (!vals.length) return null;
    if (metric === 'max') return Math.max(...vals);
    return Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
  });
}

// Rolling window average of an array (nulls excluded from each window calculation).
function rollingAvg(vals, n) {
  return vals.map((_, i) => {
    const window = n === 0
      ? vals.slice(0, i+1)
      : vals.slice(Math.max(0, i-n+1), i+1);
    const nonNull = window.filter(v => v !== null);
    if (!nonNull.length) return null;
    return nonNull.reduce((a,b)=>a+b,0) / nonNull.length;
  });
}

// Render an SVG bar chart into the given container element.
// Bars are green (above all-time avg), red (below), or metallic gold (personal best).
// Y-axis always starts at 0 for honest proportional comparison.
function drawChart(containerId, warLabels, dataPoints, height=200, avgOverride=null) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const W = el.clientWidth || 800;
  const H = height;
  const PAD = { top: 20, right: 85, bottom: 30, left: 50 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Royal theme → match the app: rounded font, bigger WHITE numbers, blue avg line
  const isRoyal   = document.body.classList.contains('theme-light');
  const chartFont = isRoyal ? "'Nunito',sans-serif" : 'monospace';
  const lblColor  = isRoyal ? '#ffffff' : C_DIM;
  const lblSize   = isRoyal ? 12 : 9;
  const gridCol   = isRoyal ? 'rgba(255,255,255,0.16)' : '#1a2030';

  const valid = dataPoints.filter(v => v !== null && v > 0);
  if (!valid.length) {
    el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px">No data</p>';
    return;
  }

  // null = wasn't in clan that war (excluded from avg); 0 = missed (counts as 0)
  const clanWars   = dataPoints.filter(v => v !== null);
  const personalAvg = clanWars.length ? clanWars.reduce((a, b) => a + b, 0) / clanWars.length : 0;
  // avgOverride: when set, use it as the reference line (e.g. clan avg) instead of personal avg
  const allTimeAvg = avgOverride !== null ? avgOverride : personalAvg;

  const minVal = 0;
  const maxVal = Math.max(...valid, allTimeAvg) * 1.1;
  const range  = maxVal - minVal || 1;

  const n    = dataPoints.length;
  const gap  = 3;
  const barW = Math.max(4, (chartW - gap * (n - 1)) / n);
  const xPos   = i => PAD.left + i * (barW + gap);
  const yScale = v => PAD.top + chartH - ((v - minVal) / range) * chartH;

  // Personal best detection for gold highlight
  const validVals    = dataPoints.filter(v => v !== null && v > 0);
  const personalBest = validVals.length ? Math.max(...validVals) : null;

  // Metallic gold SVG gradient (only injected when personal best toggle is on)
  const gradId      = 'goldGrad_' + containerId.replace(/[^a-z0-9]/gi, '_');
  const grnId       = 'grnGrad_'  + containerId.replace(/[^a-z0-9]/gi, '_');
  const redId       = 'redGrad_'  + containerId.replace(/[^a-z0-9]/gi, '_');
  const goldGradDef = `<defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#ffe066"/>
      <stop offset="30%"  stop-color="#c8860a"/>
      <stop offset="55%"  stop-color="#ffe98a"/>
      <stop offset="75%"  stop-color="#a05e00"/>
      <stop offset="100%" stop-color="#f5c842"/>
    </linearGradient>
    <linearGradient id="${grnId}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#5fb058"/><stop offset="100%" stop-color="#43883f"/>
    </linearGradient>
    <linearGradient id="${redId}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#cc6e64"/><stop offset="100%" stop-color="#ad4c46"/>
    </linearGradient>
  </defs>`;

  const bars = dataPoints.map((v, i) => {
    if (v === null) return '';
    const x = xPos(i);
    if (v === 0) {
      // Missed war — small red stub at the baseline
      return `<rect x="${x.toFixed(1)}" y="${(PAD.top + chartH - 8).toFixed(1)}" width="${barW.toFixed(1)}" height="8" fill="rgba(224,82,82,0.4)" rx="1"/>`;
    }
    const y      = yScale(v);
    const h      = Math.max(2, chartH - (y - PAD.top));
    const isGold = showPersonalBest && personalBest !== null && v === personalBest;
    const above  = v >= allTimeAvg;
    let fill, stroke, strokeW;
    if (isGold) { fill = `url(#${gradId})`; stroke = '#ffe066'; strokeW = '1.5'; }
    else if (isRoyal) {
      fill = above ? `url(#${grnId})` : `url(#${redId})`;
      stroke = above ? 'rgba(50,90,48,0.55)' : 'rgba(120,55,52,0.55)'; strokeW = '1';
    } else {
      fill = above ? 'rgba(38,194,129,0.55)' : 'rgba(224,82,82,0.55)';
      stroke = above ? 'rgba(38,194,129,0.9)' : 'rgba(224,82,82,0.9)'; strokeW = '1';
    }
    const radius = isRoyal ? 3 : 1;
    // subtle top highlight strip (royal only) — thin and soft, not a heavy gloss block
    const sheen = isGold
      ? `<rect x="${(x + barW * 0.15).toFixed(1)}" y="${y.toFixed(1)}" width="${(barW * 0.25).toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(255,255,200,0.16)" rx="1"/>`
      : (isRoyal && h > 6)
        ? `<rect x="${(x+1.5).toFixed(1)}" y="${(y+1).toFixed(1)}" width="${Math.max(1,barW-3).toFixed(1)}" height="${Math.min(h*0.12,5).toFixed(1)}" fill="rgba(255,255,255,0.16)" rx="${radius}"/>`
        : '';
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" rx="${radius}"/>${sheen}`;
  }).join('');

  // All-time avg reference line — bold royal-blue dashes in royal mode
  const avgY    = yScale(allTimeAvg).toFixed(1);
  const avgStroke = isRoyal ? C_BLUE : 'rgba(180,180,180,0.5)';
  const avgWidth  = isRoyal ? '2.5'  : '1.5';
  const avgDash   = isRoyal ? '7,4'  : '4,3';
  const avgLblCol = isRoyal ? C_BLUE : 'rgba(180,180,180,0.6)';
  const avgLabel = avgOverride !== null
    ? `Clan ${Math.round(allTimeAvg).toLocaleString()}`
    : Math.round(allTimeAvg).toLocaleString();
  const avgLine = `<line x1="${PAD.left}" y1="${avgY}" x2="${(PAD.left + chartW).toFixed(1)}" y2="${avgY}" stroke="${avgStroke}" stroke-width="${avgWidth}" stroke-dasharray="${avgDash}"/>
    <text x="${(PAD.left + chartW + 4).toFixed(1)}" y="${avgY}" dominant-baseline="middle" fill="${avgLblCol}" font-size="${lblSize}" font-weight="${isRoyal ? '700' : '400'}" font-family="${chartFont}">${avgLabel}</text>`;

  // X-axis war labels (skip every 3rd when many wars to avoid overlap)
  const xLabels = warLabels.map((lbl, i) => {
    if (n > 15 && i % 3 !== 0) return '';
    const cx = xPos(i) + barW / 2;
    return `<text x="${cx.toFixed(1)}" y="${(PAD.top + chartH + 16).toFixed(1)}" text-anchor="middle" fill="${lblColor}" font-size="${lblSize}" font-weight="${isRoyal ? '700' : '400'}" font-family="${chartFont}">${lbl}</text>`;
  }).join('');

  // Y-axis labels and horizontal grid lines
  const ySteps  = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = minVal + (range * i / ySteps);
    const y = yScale(v);
    return `<text x="${(PAD.left - 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="${lblColor}" font-size="${lblSize}" font-weight="${isRoyal ? '700' : '400'}" font-family="${chartFont}">${Math.round(v).toLocaleString()}</text>`
      + `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(PAD.left + chartW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${gridCol}" stroke-width="1"/>`;
  }).join('');

  el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}">
    ${goldGradDef}
    ${yLabels}
    ${bars}
    ${avgLine}
    ${xLabels}
  </svg>`;
}

// ══════════════════════════════════════════════════════
//  RENDER — GRAPHIC MODE
// ══════════════════════════════════════════════════════

// Pure calculation for the Graphic tab's two clan-wide charts and player
// list — war labels/stats, clan totals, sorted active/inactive rosters,
// and the all-time clan avg used as a chart reference line. Zero HTML.
function calcGraphicData() {
  // Graphic shows completed wars only, plus optionally a single Live bar
  // (collapsing all _LIVE snapshot columns into one using current LIVE_DATA from CR API)
  const completedWars = WARS.filter(w => !w.isLive);
  const graphicLabels = completedWars.map(w => w.label || ('War '+w.id));
  const graphicStats = completedWars.map((w) => {
    const vals = PLAYERS
      .filter(p => !isInactive(p))
      .map(p => { const idx = WARS.findIndex(x => x.id === w.id && !x.isLive); return idx === -1 ? null : p.scores[idx]; })
      .filter(s => s !== null && s > 0);
    if (!vals.length) return null;
    // Clan avg chart always shows avg (max toggle is relegated)
    return Math.round(vals.reduce((a,b)=>a+b,0) / vals.length);
  });

  // If live toggle is on and we have live data, append a single Live bar
  // using current cumulative fame from LIVE_DATA (CR API) — avg or max across active players
  if (includeLive && Object.keys(LIVE_DATA).length && warHasStarted()) {
    const activeLivePlayers = Object.values(LIVE_DATA).filter(p => {
      const key = p.name.toLowerCase();
      const match = PLAYERS.find(pl => pl.name.toLowerCase() === key);
      return match && !isInactive(match);
    });
    const liveFames = activeLivePlayers.map(p => p.fame || 0).filter(f => f > 0);
    if (liveFames.length) {
      const liveVal = Math.round(liveFames.reduce((a,b)=>a+b,0) / liveFames.length);
      graphicLabels.push('Live');
      graphicStats.push(liveVal);
    }
  }

  const warLabels = graphicLabels;
  const clanStats = graphicStats;

  // Clan TOTAL fame per war — sum of ALL players with non-null scores that war.
  // null = wasn't in clan (excluded); 0 = in clan but didn't play (counted as 0).
  // Does NOT filter by isInactive() since someone who left the clan still scored
  // points in past wars and those should be included in historical totals.
  const totalLabels = [...graphicLabels];
  const clanTotalStats = completedWars.map((w) => {
    const idx = WARS.findIndex(x => x.id === w.id && !x.isLive);
    if (idx === -1) return null;
    const scores = PLAYERS.map(p => p.scores[idx]).filter(s => s !== null);
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0);
  });
  // Append a single live total bar if toggled, using current cumulative fame from the API
  if (includeLive && Object.keys(LIVE_DATA).length && warHasStarted()) {
    const activeLivePlayers = Object.values(LIVE_DATA).filter(p => {
      const key = p.name.toLowerCase();
      const match = PLAYERS.find(pl => pl.name.toLowerCase() === key);
      return match && !isInactive(match);
    });
    const liveTotal = activeLivePlayers.reduce((a, p) => a + (p.fame || 0), 0);
    if (liveTotal > 0) clanTotalStats.push(liveTotal);
  }

  // Sort active and inactive players separately, applying search filter
  const searchFilter = p => !searchStr || p.name.toLowerCase().includes(searchStr.toLowerCase());
  const activePlayers   = PLAYERS.filter(p => !isInactive(p) && searchFilter(p));
  const inactivePlayers = PLAYERS.filter(p => isInactive(p) && searchFilter(p));

  const sortFn = (a, b) => graphicSort === 'alpha'
    ? a.name.localeCompare(b.name)
    : calcAvg(b.scores, 0) - calcAvg(a.scores, 0);

  const sortedActive   = [...activePlayers].sort(sortFn);
  const sortedInactive = [...inactivePlayers].sort(sortFn);

  // Clan avg per player (all-time, participants only) — used as reference line
  // when graphicMetric === 'clan' on individual player charts.
  const completedNonLive = WARS.filter(w => !w.isLive);
  const clanAvgPerPlayer = (() => {
    const avgs = completedNonLive.map(w => {
      const idx = WARS.indexOf(w);
      const vals = PLAYERS.map(p => p.scores[idx]).filter(s => s !== null && s > 0);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
    }).filter(v => v !== null);
    return avgs.length ? avgs.reduce((a,b)=>a+b,0)/avgs.length : 0;
  })();

  return {
    completedWars, warLabels, clanStats, totalLabels, clanTotalStats,
    sortedActive, sortedInactive, clanAvgPerPlayer
  };
}

// Pure per-player calculation for one row in the Graphic tab's player list.
function calcPlayerChartRow(p) {
  // Use only wars where player was in clan (non-null), matching chart avg line
  const clanWars = p.scores.filter(s => s !== null);
  const avg = clanWars.length ? Math.round(clanWars.reduce((a,b)=>a+b,0)/clanWars.length) : 0;
  return {
    avg, avgClass: avgClass(avg), tag: playerTag(p), posClass: posClass(p.pos),
    isOpen: expandedCharts.has(p.name),
    chartId: 'pchart_' + p.name.replace(/[^a-z0-9]/gi, '_')
  };
}

function renderGraphic() {
  const g = calcGraphicData();
  const { warLabels, clanStats, totalLabels, clanTotalStats, sortedActive, sortedInactive, clanAvgPerPlayer, completedWars } = g;

  const buildPlayerRows = (players, dimmed) => players.map(p => {
    const r = calcPlayerChartRow(p);
    return `<div class="player-chart-section${r.isOpen ? ' open' : ''}" style="${dimmed ? 'opacity:0.4' : ''}">
      <div class="player-chart-row" data-name="${encodeURIComponent(p.name)}" data-chart="${r.chartId}" onclick="togglePlayerChart(decodeURIComponent(this.dataset.name), this.dataset.chart)">
        <span class="player-chart-name">${p.name}${playerTagHtml(r.tag, 'dot')}</span>
        <span class="pos-badge ${r.posClass}">${p.pos}</span>
        <span class="player-chart-avg ${r.avgClass}">${r.avg > 0 ? r.avg.toLocaleString() : '—'}</span>
        <span class="player-chart-expand">${r.isOpen ? '▲ collapse' : '▼ expand'}</span>
      </div>
      <div class="player-chart-body ${r.isOpen ? 'open' : ''}" id="${r.chartId}">
        <div id="${r.chartId}_svg" style="width:100%"></div>
      </div>
    </div>`;
  }).join('');

  document.getElementById('main').innerHTML = `
    <!-- CLAN TOTAL CHART -->
    <div class="clan-chart-wrap">
      <div class="clan-chart-title">
        CLAN TOTAL FAME PER WAR
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(38,194,129,0.6)"></div> Above avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(224,82,82,0.6)"></div> Below avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(180,180,180,0.5);height:2px"></div> All-time avg</div>
      </div>
      <div id="clan-total-chart-svg" style="width:100%"></div>
    </div>

    <!-- CLAN AVG/MAX CHART -->
    <div class="clan-chart-wrap">
      <div class="clan-chart-title">
        AVG FAME PER PLAYER PER WAR
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(38,194,129,0.6)"></div> Above avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(224,82,82,0.6)"></div> Below avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(180,180,180,0.5);height:2px"></div> All-time avg</div>
      </div>
      <div id="clan-chart-svg" style="width:100%"></div>
    </div>

    <!-- ACTIVE PLAYERS -->
    <div class="g-section-hdr">
      <span>⬟</span> Active Members — ${sortedActive.length}
    </div>
    ${buildPlayerRows(sortedActive, false)}

    <!-- INACTIVE PLAYERS -->
    ${sortedInactive.length ? `
    <div class="g-section-hdr" style="margin-top:20px;opacity:0.5">
      <span>⬟</span> Inactive / Former Members — ${sortedInactive.length}
    </div>
    ${buildPlayerRows(sortedInactive, true)}` : ''}
  `;

  // Draw clan chart and any expanded player charts
  requestAnimationFrame(() => {
    // Clan charts always use avg (max toggling is relegated)
    drawChart('clan-chart-svg', warLabels, clanStats, 220);
    drawChart('clan-total-chart-svg', totalLabels, clanTotalStats, 220);
    for (const name of expandedCharts) {
      const p = PLAYERS.find(x => x.name === name);
      if (!p) continue;
      const chartId = 'pchart_' + name.replace(/[^a-z0-9]/gi, '_');
      // Use only completed war scores, then append single live bar if toggled
      const playerScores = completedWars.map(w => {
        const idx = WARS.findIndex(x => x.id === w.id && !x.isLive);
        return idx === -1 ? null : (p.scores[idx] ?? null);
      });
      if (includeLive && Object.keys(LIVE_DATA).length && warHasStarted()) {
        const liveEntry = LIVE_DATA[p.name.toLowerCase()];
        playerScores.push(liveEntry ? (liveEntry.fame || 0) : 0);
      }
      // Pass clan avg as reference line when toggle is set to 'clan'
      const clanAvgRef = graphicMetric === 'clan' ? clanAvgPerPlayer : null;
      drawChart(chartId + '_svg', warLabels, playerScores, 160, clanAvgRef);
    }
  });
}



function togglePlayerChart(name, chartId) {
  if (expandedCharts.has(name)) {
    expandedCharts.delete(name);
  } else {
    expandedCharts.add(name);
  }
  renderGraphic();
}

function setGMetric(m) {
  graphicMetric = m;
  const groups = document.querySelectorAll('#grp-graphic .btn-group');
  if (groups[0]) groups[0].querySelectorAll('.btn').forEach((b, i) =>
    b.classList.toggle('active', ['personal', 'clan'][i] === m));
  if (mode === 'graphic') renderGraphic();
}

function setGSort(s) {
  graphicSort = s;
  const groups = document.querySelectorAll('#grp-graphic .btn-group');
  if (groups[1]) groups[1].querySelectorAll('.btn').forEach((b, i) =>
    b.classList.toggle('active', ['avg', 'alpha'][i] === s));
  if (mode === 'graphic') renderGraphic();
}

