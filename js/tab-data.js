// ══════════════════════════════════════════════════════════════════
//  TAB-DATA.JS
//  The "Data" tab: sortable player table with a war-by-war heatmap.
//  renderData() is the entry point, called by render() (main.js)
//  whenever mode === 'data'.
//
//  Depends on calculations.js (swapperAwareScores/effectiveScores use
//  calcAvg/calcParticipation/isCurrentlyInClan etc.) and on
//  calculations.js's getAdjustedRank() for war-header placement.
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  RENDER — DATA MODE
// ══════════════════════════════════════════════════════
// Returns WARS filtered based on includeLive toggle
function effectiveWars() {
  return includeLive ? WARS : WARS.filter(w => !w.isLive);
}

// Returns player scores aligned to effectiveWars()
function effectiveScores(player) {
  if (includeLive) return player.scores;
  return player.scores.filter((_, i) => !WARS[i] || !WARS[i].isLive);
}

// For swapper players, treat 0-scored wars as null so participation/trend
// calculations don't penalise strategic non-participation.
function swapperAwareScores(player) {
  const scores = effectiveScores(player);
  if (!SWAPPER_NAMES.has(player.name.toLowerCase().trim())) return scores;
  return scores.map(s => s === 0 ? null : s);
}

function effectiveDecks(player) {
  if (includeLive) return player.decks;
  if (!player.decks) return player.decks;
  return player.decks.filter((_, i) => !WARS[i] || !WARS[i].isLive);
}

// Pure calculation for the war-column headers — placement rank/medal per
// shown war. Zero HTML. buildWarHeaders() below just renders this.
function calcWarHeaders() {
  const ew = effectiveWars();
  const shown = warWindow === 0 ? ew : ew.slice(-Math.max(warWindow, 3));
  const headers = shown.map(w => {
    const lbl = w.label || ('War ' + w.id);
    const standing = getOurStandingsForWar(w.id);
    const rank = standing ? (getAdjustedRank(standing, WAR_STANDINGS[String(w.id)]) || 0) : 0;
    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    const emoji  = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    return { label: lbl, hasStanding: !!standing, rank, suffix, emoji };
  });
  return { shown, headers };
}

// Render the war-column <th> headers from calcWarHeaders()'s output.
function buildWarHeaders() {
  const { shown, headers } = calcWarHeaders();
  const html = headers.map(h => {
    const placementHtml = h.hasStanding
      ? `<div class="war-place place-${h.rank}" style="font-size:8px;margin-top:2px;color:${h.rank === 1 ? '#ffd700' : h.rank === 2 ? '#c0c0c0' : h.rank === 3 ? '#cd7f32' : 'var(--text-dim)'}"><i class="rb rb-${h.rank}">${h.emoji}</i> ${h.rank}${h.suffix}</div>`
      : '';
    return `<th class="war-th">${h.label}${placementHtml}</th>`;
  }).join('');
  return { shown, html };
}

// Pure calculation for one player's Data-tab table row — every derived
// number, threshold class, and per-war cell value. Zero HTML.
// buildRow() below just renders this object.
function calcRow(p, shownWars) {
  const avg  = calcAvg(swapperAwareScores(p), warWindow);
  const part = calcParticipation(swapperAwareScores(p), warWindow);
  // Avg battles: respects warWindow — same window as avg/participation columns.
  // Uses swapper-aware scores so swapper zero wars are excluded.
  const swScores = swapperAwareScores(p);
  const windowedScores = getWindowScores(swScores, warWindow);
  const windowOffset = swScores.length - windowedScores.length;
  const allDecks = windowedScores.map((s, wi) => {
    if (s === null) return null;
    const d = p.decks ? p.decks[windowOffset + wi] : null;
    return d !== null ? d : (s > 0 ? 16 : 0);
  }).filter(d => d !== null);
  const avgDecks = allDecks.length ? allDecks.reduce((a,b)=>a+b,0)/allDecks.length : null;
  const avgDecksDisplay = avgDecks !== null ? (avgDecks).toFixed(1) + '/16' : '—';
  // Map avg decks to same color class as avg score for visual consistency
  // 16=avg-s, 14-15=avg-a, 12-13=avg-b, 8-11=avg-c, below=avg-d
  const avgDecksFracClass = avgDecks === null ? ''
    : avgDecks >= 15.5 ? 'avg-s'
    : avgDecks >= 13.5 ? 'avg-a'
    : avgDecks >= 11.5 ? 'avg-b'
    : avgDecks >= 7.5  ? 'avg-c'
    : 'avg-d';
  const trendType = calcTrend(swapperAwareScores(p), warWindow);
  const promo = promoRec(p, avg, part);

  const partClass = part.pct >= PART_HIGH ? 'part-high' : part.pct >= PART_MID ? 'part-mid' : 'part-low';

  // War cells — align to WARS array
  const ew = effectiveWars();
  const warCells = shownWars.map(w => {
    const idx = WARS.findIndex(x => x.id === w.id);
    const ewIdx = ew.findIndex(x => x.id === w.id);
    const s = idx === -1 ? null : (p.scores[idx] ?? null);
    const d = (idx === -1 || !p.decks) ? null : (p.decks[idx] ?? null);
    const isRaw = idx !== -1 && !WARS[idx].isAuto;
    const isSwapperPlayer = SWAPPER_NAMES.has(p.name.toLowerCase().trim());
    const cls = heatClass(s);
    // Swappers show · for zero scores — presence without battling is by design
    const txt = s === null ? '·' : (s === 0 && isSwapperPlayer) ? '·' : s === 0 ? '✗' : s.toLocaleString();
    const effectiveCls = (s === 0 && isSwapperPlayer) ? 'wc-absent' : cls;
    const deckClass = d !== null ? deckFracClass(d) : null;
    const personalBest = Math.max(...p.scores.filter(s => s !== null && s > 0));
    const isPersonalBest = showPersonalBest && s !== null && s > 0 && s === personalBest;
    return { text: txt, cellClass: effectiveCls, isPersonalBest, isRaw, deckValue: d, deckClass };
  });

  return {
    avg, avgClass: avgClass(avg), part, partClass,
    avgDecksDisplay, avgDecksFracClass, trendType, promo,
    tag: playerTag(p), posClass: posClass(p.pos), isInClan: isCurrentlyInClan(p),
    warCells
  };
}

// Render one player's Data-tab table row from calcRow()'s output.
// Pure HTML building — add new numbers to calcRow() instead of deriving
// them inline in a template string.
function buildRow(p, rank, isInactiveRow, shownWars) {
  const r = calcRow(p, shownWars);

  const trendHtml = r.trendType === 'up'
    ? '<span class="trend-up">▲</span>'
    : r.trendType === 'down'
    ? '<span class="trend-down">▼</span>'
    : '<span class="trend-flat"></span>';

  const warCells = r.warCells.map(c => {
    // Deck fraction: only show when battles toggle is ON
    const deckHtml = !sortBattles ? ''
      : c.isRaw
        ? '<span class="deck-frac deck-na">NA</span>'
        : c.deckValue !== null
          ? `<span class="deck-frac ${c.deckClass}">${c.deckValue}/16</span>`
          : '';
    const inner = c.isPersonalBest ? `<span class="pb-num">${c.text}</span>` : c.text;
    return `<td class="wc ${c.cellClass}${c.isPersonalBest ? ' pb' : ''}"><span class="wcell">${inner}${deckHtml}</span></td>`;
  }).join('');

  return `<tr class="${isInactiveRow ? 'inactive-row' : ''}">
    <td class="td-rank">${rank}</td>
    <td><span class="player-name">${p.name}${playerTagHtml(r.tag)}</span>${r.promo}</td>
    <td style="white-space:nowrap"><span class="pos-badge ${r.posClass}">${p.pos}</span></td>
    <td class="td-active" style="text-align:center;min-width:65px">
      <span class="active-light ${r.isInClan ? 'on' : 'off'}" title="${r.isInClan ? 'In clan now' : 'Not in clan'}"></span>
    </td>
    <td class="td-part"><div class="part-row">
      <span class="part-pct">${Math.round(r.part.pct * 100)}%</span>
      <div class="part-bar-bg"><div class="part-bar-fill ${r.partClass}" style="width:${r.part.pct*100}%"></div></div>
    </div></td>
    <td class="td-trend">${trendHtml}</td>
    <td class="td-avg" style="text-align:center;white-space:nowrap"><span class="wcell ${r.avgDecksFracClass}">${r.avgDecksDisplay}</span></td>
    <td class="td-avg ${r.avgClass}"><span class="wcell">${r.avg > 0 ? r.avg.toLocaleString() : '—'}</span></td>
    ${warCells}
  </tr>`;
}

function buildSection(title, color, players, isInactiveSection, shownWars, warHeaderHtml) {
  if (!players.length) return '';
  const rows = players.map((p, i) => buildRow(p, i + 1, isInactiveSection, shownWars)).join('');
  return `<div class="section">
    <div class="section-hdr">
      <div class="section-stripe" style="background:${color}"></div>
      <div class="section-title">${title}</div>
      <div class="section-cnt">${players.length} members</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>#</th><th>Player</th><th>Role</th>
        <th style="text-align:center">Active</th>
        <th>Participation</th><th style="text-align:center">Trend</th>
        <th style="text-align:center">Avg Battles</th>
        <th style="text-align:center">Avg (${warWindow === 0 ? 'All' : warWindow + 'W'})</th>
        ${warHeaderHtml}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderData() {
  const { active, inactive } = filterPlayers();
  const { shown: shownWars, html: warHeaderHtml } = buildWarHeaders();

  let html = '';

  if (sortMode === 'role') {
    // Group by role, sub-sort by avg
    const sections = [
      { label: 'Leaders & Co-Leaders', color: 'var(--gold)',   filter: p => p.pos === 'Leader' || p.pos === 'Co-leader' || p.pos === 'Co-Leader' },
      { label: 'Elders',               color: 'var(--blue)',   filter: p => p.pos === 'Elder' },
      { label: 'Members',              color: 'var(--green)',  filter: p => p.pos === 'Member' },
      { label: 'Swappers',             color: 'var(--purple)', filter: p => p.pos === 'Swapper' },
    ];
    for (const sec of sections) {
      const sorted = sortPlayers(active.filter(sec.filter));
      if (sorted.length) html += buildSection(sec.label, sec.color, sorted, false, shownWars, warHeaderHtml);
    }
  } else {
    html += buildSection('Active Members', 'var(--gold)', sortPlayers(active), false, shownWars, warHeaderHtml);
  }

  // Inactive section — always a collapsible button, never a toggle
  if (inactive.length) {
    if (showInactive) {
      html += buildSection('Inactive / Former Members', 'var(--text-dim)', sortPlayers(inactive), true, shownWars, warHeaderHtml);
      html += `<button class="show-inactive-btn" onclick="toggleInactive()">▴ Hide Inactive Members</button>`;
    } else {
      html += `<button class="show-inactive-btn" onclick="toggleInactive()">▸ Show ${inactive.length} Inactive / Former Members</button>`;
    }
  }

  document.getElementById('main').innerHTML = html;
}

function toggleInactive() { showInactive = !showInactive; render(); }
