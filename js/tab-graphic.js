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

// Rank 1-5 → outline color, shared by the Opponents overlay's full bars AND
// our own bar's placement coloring on Colosseum weeks. Positional (matches
// whichever clan held that rank that week), not tied to a clan's identity.
// Fill comes from the metallic gradients built per-chart in drawChart()
// (see rankFill()); this only carries each rank's outline stroke. No rank
// gets a halo/extra border -- all five bars must be the exact same size.
const RANK_COLOR = {
  1: { stroke: 'rgba(120,90,10,0.55)' },
  2: { stroke: 'rgba(70,80,95,0.55)' },
  3: { stroke: 'rgba(100,50,15,0.55)' },
  4: { stroke: 'rgba(60,35,15,0.55)' },
  5: { stroke: 'rgba(60,25,15,0.55)' } // rusty red/maroon, not black
};

// Rank 1-5 → flat text color for a Colosseum week's x-axis label (see
// drawChart()'s xLabels). Brighter/more saturated than the bar gradients'
// own tones so a small label stays legible against the dark chart panel
// instead of blending toward plain white.
const RANK_LABEL_COLOR = {
  1: '#ffd84d',
  2: '#b9c2cf',
  3: '#e0894a',
  4: '#b98554',
  5: '#e0755a'
};

// Wraps one bar's rect(s) in an interactive <g> carrying the data
// attachChartBarTooltips() needs to rise/label it on hover or tap — every
// bar in a chart (our own, a missed-war stub, or a layered opponent rank
// bar) goes through this so the interaction covers all of them uniformly.
function wrapChartBar(innerSvg, { cx, topY, val, context }) {
  return `<g class="chart-bar" data-cx="${cx.toFixed(1)}" data-top="${topY.toFixed(1)}" data-val="${val}" data-context="${context || ''}">${innerSvg}</g>`;
}

// Currently pinned (tap-locked) bar per chart container, keyed by
// containerId so the clan-total chart, the clan-avg chart, and each
// expanded player chart don't share pin state. Implicitly cleared whenever
// that container's SVG is rebuilt (drawChart() replaces el.innerHTML),
// since the pinned <g> reference just becomes a harmless detached orphan.
const CHART_PINNED_BAR = {};

// Wires up the "hover or tap a bar to see its exact value" interaction for
// one just-rendered chart. Hovering (desktop) previews a bar transiently;
// clicking/tapping pins it (since touch devices have no hover) until it's
// tapped again, another bar is tapped, or empty chart space is tapped.
// Rise is a real height/y change (not a CSS transform) so it composes
// cleanly with every existing bar variant — gradients, sheens, stubs.
function attachChartBarTooltips(el, containerId) {
  const svg = el.querySelector('svg');
  if (!svg) return;
  CHART_PINNED_BAR[containerId] = null;

  const bars = [...svg.querySelectorAll('.chart-bar')];
  const RISE = 8;

  // Each bar gets its OWN tooltip text rather than one shared node — a
  // shared tooltip meant showing a hovered bar's value silently stole it
  // away from a still-pinned bar underneath (both mid-hover on desktop and
  // mid-tap on mobile, where a tap synthesizes mouseenter+click back to
  // back and the two calls raced on the same shared node). Appended after
  // every bar already exists, so every tooltip still paints on top of
  // every bar regardless of that bar's layering.
  bars.forEach(g => {
    const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tooltip.setAttribute('class', 'chart-bar-tooltip');
    tooltip.setAttribute('text-anchor', 'middle');
    tooltip.setAttribute('font-family', "'Nunito',sans-serif");
    tooltip.setAttribute('font-size', '13');
    tooltip.setAttribute('font-weight', '800');
    tooltip.setAttribute('fill', '#ffffff');
    const val = Number(g.dataset.val);
    const context = g.dataset.context;
    tooltip.textContent = context ? `${context}: ${val.toLocaleString()}` : val.toLocaleString();
    tooltip.setAttribute('x', g.dataset.cx);
    tooltip.setAttribute('y', (parseFloat(g.dataset.top) - RISE - 8).toFixed(1));
    tooltip.style.opacity = '0';
    svg.appendChild(tooltip);
    g._tooltip = tooltip;
  });

  // Rise/highlight is idempotent (guarded so re-entering doesn't double-
  // rise), but the tooltip's visibility is always reasserted regardless —
  // it must never depend on whether the rise step ran, so a pin (click)
  // arriving right after a hover already showed the same bar still turns
  // the tooltip on rather than being skipped as a no-op.
  const showBar = (g) => {
    if (!g.classList.contains('chart-bar-active')) {
      g.classList.add('chart-bar-active');
      const rect = g.querySelector('.chart-bar-rect');
      if (rect) {
        rect.dataset.origY = rect.getAttribute('y');
        rect.dataset.origH = rect.getAttribute('height');
        rect.setAttribute('y', (parseFloat(rect.dataset.origY) - RISE).toFixed(1));
        rect.setAttribute('height', (parseFloat(rect.dataset.origH) + RISE).toFixed(1));
      }
      const sheen = g.querySelector('.chart-bar-sheen');
      if (sheen) sheen.style.opacity = '0';
    }
    g._tooltip.style.opacity = '1';
  };
  const hideBar = (g) => {
    if (g.classList.contains('chart-bar-active')) {
      g.classList.remove('chart-bar-active');
      const rect = g.querySelector('.chart-bar-rect');
      if (rect && rect.dataset.origY !== undefined) {
        rect.setAttribute('y', rect.dataset.origY);
        rect.setAttribute('height', rect.dataset.origH);
      }
      const sheen = g.querySelector('.chart-bar-sheen');
      if (sheen) sheen.style.opacity = '';
    }
    g._tooltip.style.opacity = '0';
  };

  bars.forEach(g => {
    g.addEventListener('mouseenter', () => showBar(g));
    g.addEventListener('mouseleave', () => {
      if (CHART_PINNED_BAR[containerId] !== g) hideBar(g);
    });
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      const pinned = CHART_PINNED_BAR[containerId];
      if (pinned === g) {
        CHART_PINNED_BAR[containerId] = null;
        hideBar(g);
      } else {
        if (pinned) hideBar(pinned);
        CHART_PINNED_BAR[containerId] = g;
        showBar(g);
      }
    });
  });

  // Tapping empty chart space releases whatever's pinned — the only way to
  // dismiss a pinned tooltip on a touch device, which has no hover fallback.
  svg.addEventListener('click', () => {
    const pinned = CHART_PINNED_BAR[containerId];
    if (pinned) { hideBar(pinned); CHART_PINNED_BAR[containerId] = null; }
  });
}

// Render an SVG bar chart into the given container element.
// Bars are green (above all-time avg), red (below), or metallic gold (personal best).
// Y-axis always starts at 0 for honest proportional comparison.
function drawChart(containerId, warLabels, dataPoints, height=200, avgOverride=null, opponentSeries=null, warTypes=null, ourRankSeries=null) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const containerW = el.clientWidth || 800;
  const H = height;
  const PAD = { top: 20, right: 85, bottom: 30, left: 50 };
  const chartH = H - PAD.top - PAD.bottom;

  // Royal theme styling — rounded font, bigger WHITE numbers, blue avg line.
  // Dark mode retired (only Royal theme exists — see CLAUDE.md), so these
  // are no longer conditional on the theme; the old dark-mode values are
  // gone, not just unreachable.
  const chartFont = "'Nunito',sans-serif";
  const lblColor  = '#ffffff';
  const lblSize   = 12;
  const gridCol   = 'rgba(255,255,255,0.16)';

  const valid = dataPoints.filter(v => v !== null && v > 0);
  if (!valid.length) {
    el.innerHTML = '<p style="color:var(--text-dim);font-size:12px;text-align:center;padding:40px">No data</p>';
    el.style.overflowX = '';
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

  const n   = dataPoints.length;
  const gap = 3;
  // Bars always render at a comfortable minimum width (MIN_BAR_W), rather
  // than shrinking indefinitely to cram every war into whatever width a
  // narrow/portrait phone has — real-device feedback called the shrunk-
  // to-fit bars "too thin, looks terrible". If MIN_BAR_W doesn't fit
  // everything in the visible container, the chart's own SVG grows wider
  // than the container instead, and the container becomes horizontally
  // scrollable (same pattern as the Data tab's table) — no war is ever
  // hidden, bars are never squished thinner than MIN_BAR_W. On wide
  // (desktop) containers this never triggers: natural fill-to-width bars
  // are already comfortably above MIN_BAR_W, so desktop behavior here is
  // completely unchanged from before this existed.
  const MIN_BAR_W = 26;
  const naturalChartW = containerW - PAD.left - PAD.right;
  const naturalBarW   = (naturalChartW - gap * (n - 1)) / n;
  const needsScroll = naturalBarW < MIN_BAR_W;
  const barW   = needsScroll ? MIN_BAR_W : Math.max(4, naturalBarW);
  const chartW = needsScroll ? (n * barW + (n - 1) * gap) : naturalChartW;
  const W = chartW + PAD.left + PAD.right;

  el.style.overflowX = needsScroll ? 'auto' : '';
  el.style.webkitOverflowScrolling = 'touch';

  const xPos   = i => PAD.left + i * (barW + gap);
  const yScale = v => PAD.top + chartH - ((v - minVal) / range) * chartH;

  // Personal best detection for gold highlight
  const validVals    = dataPoints.filter(v => v !== null && v > 0);
  const personalBest = validVals.length ? Math.max(...validVals) : null;

  // Metallic gradients: gold/green/red are the pre-existing ones (gold only
  // injected visually when the personal-best toggle is on); rank 2-5 are
  // new "shiny medal" gradients for Colosseum-week placement bars (our own
  // bar) and the Opponents overlay's full bars -- same alternating light/
  // dark diagonal-band recipe as the gold gradient, just re-tinted per
  // medal, so every rank reads as reflective metal rather than a flat chip.
  const gradId      = 'goldGrad_' + containerId.replace(/[^a-z0-9]/gi, '_');
  const grnId       = 'grnGrad_'  + containerId.replace(/[^a-z0-9]/gi, '_');
  const redId       = 'redGrad_'  + containerId.replace(/[^a-z0-9]/gi, '_');
  const rankGradId  = rank => `rankGrad${rank}_` + containerId.replace(/[^a-z0-9]/gi, '_');
  const RANK_GRADIENT_STOPS = {
    2: ['#eef2f6', '#9099a6', '#ffffff', '#707886', '#c7ced7'], // silver
    3: ['#f3b27a', '#a85a28', '#ffd9ad', '#7a3c14', '#d97f3e'], // copper
    4: ['#c99a6b', '#6b4423', '#e6bd8e', '#4a2f18', '#8a5a30'], // brown
    5: ['#c97e64', '#6b2f1e', '#d98a6e', '#4a1f14', '#8c4530']  // muted rusty red
  };
  const rankGradDefs = Object.keys(RANK_GRADIENT_STOPS).map(rank => {
    const [c0, c30, c55, c75, c100] = RANK_GRADIENT_STOPS[rank];
    return `<linearGradient id="${rankGradId(rank)}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c0}"/><stop offset="30%" stop-color="${c30}"/>
      <stop offset="55%" stop-color="${c55}"/><stop offset="75%" stop-color="${c75}"/>
      <stop offset="100%" stop-color="${c100}"/>
    </linearGradient>`;
  }).join('');
  // Rank 1 reuses the existing gold gradient rather than a near-identical duplicate.
  const rankFill = rank => rank === 1 ? `url(#${gradId})` : `url(#${rankGradId(rank)})`;
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
    ${rankGradDefs}
  </defs>`;

  // A layered-bar rect for one rank at one war index, sized to that rank's
  // own value -- shared by both our own placement bar and each opponent's
  // full bar in the loop below. Same stroke width and no halo for every
  // rank, so all five bars are always the exact same size.
  const buildRankBar = (x, rank, v) => {
    const y = yScale(v);
    const h = Math.max(2, chartH - (y - PAD.top));
    const { stroke } = RANK_COLOR[rank];
    const ord = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : rank === 4 ? '4th' : '5th';
    const rectSvg = `<rect class="chart-bar-rect" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${rankFill(rank)}" stroke="${stroke}" stroke-width="1" rx="3"/>`;
    return wrapChartBar(rectSvg, { cx: x + barW / 2, topY: y, val: v, context: ord });
  };

  // Bars + Opponents overlay share one loop per war so paint order can be
  // interleaved correctly: opponents that beat us this war are painted
  // BEHIND our bar (only the sliver above our bar's height -- their margin
  // over us -- pokes out); opponents we beat are painted IN FRONT of our
  // bar (their own full height shows as a layer on top, and our bar's
  // remaining height above that shows our margin over them). Multiple bars
  // on the same side are further ordered tallest-first so each one's own
  // peak still reads as a distinct band instead of the tallest hiding the
  // rest of that side.
  const bars = dataPoints.map((v, i) => {
    if (v === null) return '';
    const x = xPos(i);
    if (v === 0) {
      // Missed war — small red stub at the baseline
      const stubY = PAD.top + chartH - 8;
      const stubRect = `<rect class="chart-bar-rect" x="${x.toFixed(1)}" y="${stubY.toFixed(1)}" width="${barW.toFixed(1)}" height="8" fill="rgba(224,82,82,0.4)" rx="1"/>`;
      return wrapChartBar(stubRect, { cx: x + barW / 2, topY: stubY, val: 0, context: 'Missed' });
    }
    const y      = yScale(v);
    const h      = Math.max(2, chartH - (y - PAD.top));
    // Placement coloring (Colosseum weeks, Opponents toggle on) takes over
    // from the usual above/below-avg green/red -- and from the personal-
    // best gold gradient, since a bar can't be textured two different ways
    // at once and placement is the more specific, explicitly-requested
    // signal here.
    // Bar recoloring stays scoped to the Opponents toggle (only ever true on
    // the Clan Total chart when opponentSeries is passed); the x-axis
    // label's placement color further down uses ourRankSeries directly and
    // isn't gated by the toggle, since it's about our own result.
    const placementRank = (opponentSeries && ourRankSeries) ? ourRankSeries[i] : null;
    const isGold = !placementRank && showPersonalBest && personalBest !== null && v === personalBest;
    const above  = v >= allTimeAvg;
    let fill, stroke, strokeW;
    if (placementRank && RANK_COLOR[placementRank]) {
      fill = rankFill(placementRank);
      stroke = RANK_COLOR[placementRank].stroke;
      strokeW = '1';
    } else if (isGold) { fill = `url(#${gradId})`; stroke = '#ffe066'; strokeW = '1.5'; }
    else {
      fill = above ? `url(#${grnId})` : `url(#${redId})`;
      stroke = above ? 'rgba(50,90,48,0.55)' : 'rgba(120,55,52,0.55)'; strokeW = '1';
    }
    const radius = 3;
    // subtle top highlight strip — thin and soft, not a heavy gloss block
    const sheen = isGold
      ? `<rect class="chart-bar-sheen" pointer-events="none" x="${(x + barW * 0.15).toFixed(1)}" y="${y.toFixed(1)}" width="${(barW * 0.25).toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(255,255,200,0.16)" rx="1"/>`
      : (h > 6)
        ? `<rect class="chart-bar-sheen" pointer-events="none" x="${(x+1.5).toFixed(1)}" y="${(y+1).toFixed(1)}" width="${Math.max(1,barW-3).toFixed(1)}" height="${Math.min(h*0.12,5).toFixed(1)}" fill="rgba(255,255,255,0.16)" rx="${radius}"/>`
        : '';
    const ourBarRect = `<rect class="chart-bar-rect" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" rx="${radius}"/>${sheen}`;
    const ourBar = wrapChartBar(ourBarRect, { cx: x + barW / 2, topY: y, val: v, context: opponentSeries ? 'Us' : '' });

    let behindUs = '', inFrontOfUs = '';
    if (opponentSeries) {
      const entries = [];
      for (let rank = 1; rank <= 5; rank++) {
        const series = opponentSeries[rank];
        const ov = series ? series[i] : null;
        if (ov === null || ov === undefined) continue;
        entries.push({ rank, v: ov });
      }
      behindUs    = entries.filter(e => e.v > v).sort((a, b) => b.v - a.v).map(e => buildRankBar(x, e.rank, e.v)).join('');
      inFrontOfUs = entries.filter(e => e.v <= v).sort((a, b) => b.v - a.v).map(e => buildRankBar(x, e.rank, e.v)).join('');
    }

    return behindUs + ourBar + inFrontOfUs;
  }).join('');

  // All-time avg reference line — bold royal-blue dashes
  const avgY    = yScale(allTimeAvg).toFixed(1);
  const avgStroke = C_BLUE;
  const avgWidth  = '2.5';
  const avgDash   = '7,4';
  const avgLblCol = C_BLUE;
  const avgLabel = avgOverride !== null
    ? `Clan ${Math.round(allTimeAvg).toLocaleString()}`
    : Math.round(allTimeAvg).toLocaleString();
  const avgLine = `<line x1="${PAD.left}" y1="${avgY}" x2="${(PAD.left + chartW).toFixed(1)}" y2="${avgY}" stroke="${avgStroke}" stroke-width="${avgWidth}" stroke-dasharray="${avgDash}"/>
    <text x="${(PAD.left + chartW + 4).toFixed(1)}" y="${avgY}" dominant-baseline="middle" fill="${avgLblCol}" font-size="${lblSize}" font-weight="700" font-family="${chartFont}">${avgLabel}</text>`;

  // X-axis war labels — skip labels to avoid overlap, based purely on
  // actual available pixel width per label (chartW / estimated label
  // slot width). This must be WIDTH-driven only, never war-count-driven:
  // an earlier version also thinned desktop charts once a clan passed 15
  // wars (a pre-existing behavior this width-aware logic accidentally
  // preserved via a "legacySkip" floor) — that's a non-mobile feature and
  // should never have been touched. Wide/desktop containers have plenty
  // of room per label regardless of war count, so this now only thins
  // labels when the container is genuinely too narrow to show them all.
  const minLabelPx = 42;
  const widthMaxLabels = Math.max(1, Math.floor(chartW / minLabelPx));
  const xSkip = n > widthMaxLabels ? Math.ceil(n / widthMaxLabels) : 1;
  const xLabels = warLabels.map((lbl, i) => {
    if (xSkip > 1 && i % xSkip !== 0) return '';
    const cx = xPos(i) + barW / 2;
    // Colosseum weeks get a blue label by default -- same as before the
    // Opponents feature existed. Only when the Opponents toggle is on does
    // it switch to OUR placement color (gold if 1st, silver if 2nd, ...),
    // matching the placement-colored bar that toggle also enables. Same
    // color regardless of device, since this is drawn once into the SVG
    // both mobile and desktop share.
    const isColosseum = warTypes && isColosseumWar(warTypes[i]);
    const placementForLabel = opponentSeries && ourRankSeries ? ourRankSeries[i] : null;
    const thisLblColor = !isColosseum ? lblColor
      : placementForLabel && RANK_LABEL_COLOR[placementForLabel] ? RANK_LABEL_COLOR[placementForLabel]
      : C_BLUE;
    return `<text x="${cx.toFixed(1)}" y="${(PAD.top + chartH + 16).toFixed(1)}" text-anchor="middle" fill="${thisLblColor}" font-size="${lblSize}" font-weight="700" font-family="${chartFont}">${lbl}</text>`;
  }).join('');

  // Y-axis labels and horizontal grid lines
  const ySteps  = 4;
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
    const v = minVal + (range * i / ySteps);
    const y = yScale(v);
    return `<text x="${(PAD.left - 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" fill="${lblColor}" font-size="${lblSize}" font-weight="700" font-family="${chartFont}">${Math.round(v).toLocaleString()}</text>`
      + `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${(PAD.left + chartW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${gridCol}" stroke-width="1"/>`;
  }).join('');

  // Explicit pixel width (not "100%") — when needsScroll is true this is
  // wider than the container on purpose, so it doesn't get squished back
  // down; when false, W === containerW so this renders identically to
  // width:100% anyway. The ResizeObserver in renderGraphic() re-runs this
  // function on any real container resize, so we don't need width:100%'s
  // own CSS-driven responsiveness anymore.
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
    ${goldGradDef}
    ${yLabels}
    ${bars}
    ${avgLine}
    ${xLabels}
  </svg>`;
  attachChartBarTooltips(el, containerId);
}

// ══════════════════════════════════════════════════════
//  RENDER — GRAPHIC MODE
// ══════════════════════════════════════════════════════

// Opponent clans' total fame per war, from the STANDINGS sheet — powers the
// Clan Total Fame Per War chart's "Opponents" overlay toggle. Rank/color
// mapping is positional (gold=1st ... rusty red=5th), not tied to a specific
// clan identity, since a different clan can hold a given rank week to week
// (matches how the in-game leaderboard actually works). Returns one series
// per rank, each aligned 1:1 with completedWars -- a war's slot in a given
// rank's series is null whenever WE held that rank that week (already
// shown by our own bar, not redrawn as an "opponent"), no STANDINGS row
// exists for that war at all (sheet not finalized/backfilled yet), or the
// war isn't a Colosseum week.
// That last condition is load-bearing, not cosmetic: per parseStandingsSheet
// (parse.js), STANDINGS' CLAN_FAME column is true fame only on Colosseum
// weeks -- on a normal week it's boat-repair score, a different metric on a
// different scale than the true summed fame our own bar shows. Plotting
// that against our bar on a normal week would look like a real fame
// comparison without being one, so those weeks are left as gaps instead
// (confirmed this tradeoff with Dunk over hiding vs. showing-anyway).
function calcOpponentRankSeries(completedWars) {
  const byRank = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  completedWars.forEach(w => {
    const standings = isColosseumWar(w.warType) ? (WAR_STANDINGS[String(w.id)] || []) : [];
    for (let rank = 1; rank <= 5; rank++) {
      const entry = standings.find(e => e.rank === rank);
      byRank[rank].push(entry && !entry.isUs ? entry.fame : null);
    }
  });
  return byRank;
}

// Our own rank for each war, from the STANDINGS sheet -- lets the Clan
// Total Fame Per War chart color OUR bar by placement (gold/silver/
// copper/brown/black) instead of the usual above/below-avg green/red, on
// the same Colosseum weeks the Opponents overlay applies to (same reason:
// STANDINGS' rank field is always valid, but this is only meaningful
// alongside true comparable fame data, which is Colosseum-only).
function calcOurRankSeries(completedWars) {
  return completedWars.map(w => {
    if (!isColosseumWar(w.warType)) return null;
    const standings = WAR_STANDINGS[String(w.id)] || [];
    const ourEntry = standings.find(e => e.isUs);
    return ourEntry ? ourEntry.rank : null;
  });
}

// Pure calculation for the Graphic tab's two clan-wide charts and player
// list — war labels/stats, clan totals, sorted active/inactive rosters,
// and the all-time clan avg used as a chart reference line. Zero HTML.
function calcGraphicData() {
  // Graphic shows completed wars only, plus optionally a single Live bar
  // (collapsing all _LIVE snapshot columns into one using current LIVE_DATA from CR API)
  const completedWars = WARS.filter(w => !w.isLive);
  const graphicLabels = completedWars.map(w => w.label || ('War '+w.id));
  // Aligned 1:1 with graphicLabels/warLabels (and totalLabels, a copy of
  // graphicLabels taken after this array's own live-bar null below) --
  // lets drawChart() color a war's x-axis label blue for Colosseum weeks.
  const warTypes = completedWars.map(w => w.warType);
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
      warTypes.push(null); // an in-progress war is never a known Colosseum week yet
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
  // Opponents overlay (Clan Total Fame Per War chart only) — one series per
  // RANK (1st..5th), not per clan identity, since a different clan can hold
  // a given rank week to week (matches the in-game leaderboard). Built
  // against completedWars before the live-bar append below, then padded to
  // match if a live bar actually gets appended, so it stays aligned with
  // clanTotalStats regardless of which branch that append takes.
  const opponentRankSeries = calcOpponentRankSeries(completedWars);
  const ourRankSeries = calcOurRankSeries(completedWars);

  // Append a single live total bar if toggled, using current cumulative fame from the API
  if (includeLive && Object.keys(LIVE_DATA).length && warHasStarted()) {
    const activeLivePlayers = Object.values(LIVE_DATA).filter(p => {
      const key = p.name.toLowerCase();
      const match = PLAYERS.find(pl => pl.name.toLowerCase() === key);
      return match && !isInactive(match);
    });
    const liveTotal = activeLivePlayers.reduce((a, p) => a + (p.fame || 0), 0);
    if (liveTotal > 0) {
      clanTotalStats.push(liveTotal);
      // STANDINGS has no row for an in-progress war -- no opponent/rank data yet.
      for (let rank = 1; rank <= 5; rank++) opponentRankSeries[rank].push(null);
      ourRankSeries.push(null);
    }
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
    completedWars, warLabels, clanStats, totalLabels, clanTotalStats, warTypes,
    opponentRankSeries, ourRankSeries, sortedActive, sortedInactive, clanAvgPerPlayer
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
  // See renderData()'s note -- the mobile controls are real elements
  // hosted inside #main, so they must be parked before it's replaced.
  parkTabControls();

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
        <div id="${r.chartId}_svg" style="width:100%;height:160px"></div>
      </div>
    </div>`;
  }).join('');

  // Mobile-only controls banner above the two clan-wide charts (purple,
  // matching this tab's own mode button). It used to be a hand-built
  // banner holding a DUPLICATE of the control bar's Opponents toggle
  // -- that copy rendered as bare grey text on the
  // purple until it was tapped, because a lone <button class="btn"> gets
  // no background of its own outside a .btn-group (the real control bar
  // button is inside one, which is what gives it its blue pill). It now
  // hosts the REAL #grp-graphic controls instead (see mountTabControls(),
  // main.js), so there's exactly one Opponents button in the app, styled
  // by the same rules on both layouts and correct from first render.
  const mobileGeneralBanner = tabControlBannerHtml('graphic');

  const opponentsLegend = showOpponents ? `
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#ffd84d"></div> 1st</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#cdd3dc"></div> 2nd</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#c9752e"></div> 3rd</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#8a5a30"></div> 4th</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#8c4530"></div> 5th</div>` : '';

  document.getElementById('main').innerHTML = `
    ${mobileGeneralBanner}
    <!-- CLAN TOTAL CHART -->
    <div class="clan-chart-wrap">
      <div class="clan-chart-title">
        CLAN TOTAL FAME PER WAR
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(38,194,129,0.6)"></div> Above avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(224,82,82,0.6)"></div> Below avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(180,180,180,0.5);height:2px"></div> All-time avg</div>
        ${opponentsLegend}
      </div>
      <div id="clan-total-chart-svg" style="width:100%;height:220px"></div>
    </div>

    <!-- CLAN AVG/MAX CHART -->
    <div class="clan-chart-wrap">
      <div class="clan-chart-title">
        AVG FAME PER PLAYER PER WAR
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(38,194,129,0.6)"></div> Above avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(224,82,82,0.6)"></div> Below avg</div>
        <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(180,180,180,0.5);height:2px"></div> All-time avg</div>
      </div>
      <div id="clan-chart-svg" style="width:100%;height:220px"></div>
    </div>

    <!-- ACTIVE PLAYERS -->
    <div class="g-section-hdr">
      Active Members — ${sortedActive.length}
    </div>
    ${buildPlayerRows(sortedActive, false)}

    <!-- INACTIVE PLAYERS -->
    ${sortedInactive.length ? `
    <div class="g-section-hdr" style="margin-top:20px;opacity:0.5">
      Inactive / Former Members — ${sortedInactive.length}
    </div>
    ${buildPlayerRows(sortedInactive, true)}` : ''}
  `;

  mountTabControls(); // main.js -- fills the banner above on mobile

  // Draw clan chart and any expanded player charts once their containers
  // have a real, settled measured size. A single requestAnimationFrame
  // here used to be the only trigger — reliable on desktop, but not on
  // real mobile browsers: layout can still be mid-reflow (sticky-header
  // wrapping, web font swap, orientation) when that one frame fires,
  // so drawChart() reads a stale/too-narrow clientWidth and draws a
  // skinny, misproportioned chart that only "fixes itself" on the next
  // unrelated re-render. ResizeObserver's first callback fires with the
  // container's actual current size as soon as it's known, and fires
  // again on any later real resize (e.g. rotating the phone) — so charts
  // always draw against a real measurement instead of a guessed one.
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => redrawGraphicCharts());
    const toObserve = [
      document.getElementById('clan-chart-svg'),
      document.getElementById('clan-total-chart-svg'),
      ...[...expandedCharts].map(name => document.getElementById('pchart_' + name.replace(/[^a-z0-9]/gi, '_') + '_svg'))
    ];
    toObserve.forEach(el => { if (el) observer.observe(el); });
  } else {
    // Fallback for environments without ResizeObserver
    requestAnimationFrame(redrawGraphicCharts);
  }
}

// Draws the two clan-wide charts plus any currently-expanded per-player
// charts. Recomputes calcGraphicData() fresh each call rather than
// closing over renderGraphic()'s data, since this can fire asynchronously
// (from the ResizeObserver in renderGraphic() above) well after the mode
// or a toggle has changed again — a stale closure would draw outdated data.
function redrawGraphicCharts() {
  const g = calcGraphicData();
  const { warLabels, clanStats, totalLabels, clanTotalStats, warTypes, opponentRankSeries, ourRankSeries, clanAvgPerPlayer, completedWars } = g;

  // Clan charts always use avg (max toggling is relegated). Opponents
  // overlay (and the placement-colored bars it enables) is Clan Total Fame
  // Per War only, per the toggle's scope -- but ourRankSeries is passed to
  // every chart unconditionally, since a Colosseum week's x-axis label
  // colors by our own placement regardless of whether the toggle is on.
  if (document.getElementById('clan-chart-svg'))      drawChart('clan-chart-svg', warLabels, clanStats, 220, null, null, warTypes, ourRankSeries);
  if (document.getElementById('clan-total-chart-svg')) drawChart('clan-total-chart-svg', totalLabels, clanTotalStats, 220, null, showOpponents ? opponentRankSeries : null, warTypes, ourRankSeries);

  for (const name of expandedCharts) {
    const p = PLAYERS.find(x => x.name === name);
    if (!p) continue;
    const chartId = 'pchart_' + name.replace(/[^a-z0-9]/gi, '_');
    if (!document.getElementById(chartId + '_svg')) continue;
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
    drawChart(chartId + '_svg', warLabels, playerScores, 160, clanAvgRef, null, warTypes, ourRankSeries);
  }
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

// One button, both layouts: #btn-opponents-g is the only Opponents toggle
// in the app now -- on mobile it's relocated into this tab's controls
// banner rather than duplicated there (see renderGraphic()'s comment on
// the banner, and mountTabControls() in main.js).
function toggleOpponents() {
  showOpponents = !showOpponents;
  const b = document.getElementById('btn-opponents-g');
  if (b) b.classList.toggle('btn-opponents-on', showOpponents);
  if (mode === 'graphic') renderGraphic();
}

