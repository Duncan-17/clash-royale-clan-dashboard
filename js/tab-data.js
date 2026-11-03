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
    const rank = standing ? (getAdjustedRank(standing, WAR_STANDINGS[String(w.id)], w.warType) || 0) : 0;
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
    // A 0 score only shows as a red ✗ if this is the player's very first
    // recorded war -- nothing but null before this index in their history
    // -- meaning they likely joined too late that week for a fair shot at
    // contributing. Any other 0 is a real, earned zero from a continuing
    // member and shows as a plain "0", not an X (previously every 0 showed
    // as X regardless of whether the player had any real history yet).
    const isFirstWar = idx !== -1 && p.scores.slice(0, idx).every(sc => sc === null);
    // Swappers show · for zero scores — presence without battling is by design
    const txt = s === null ? '·'
      : (s === 0 && isSwapperPlayer) ? '·'
      : (s === 0 && isFirstWar) ? '✗'
      : s === 0 ? '0'
      : s.toLocaleString();
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

// Pure calculation for the Data tab's clan-wide summary row -- same shape
// as calcRow() but representing the whole clan instead of one player, so it
// replaces the removed Total Wars/Active/Best Avg/Clan Avg header banners.
// Score/trend/war-cells come from the clan's own per-war average (active
// players' scores averaged that war -- the same metric the old "Clan Avg"
// banner and the Graphic tab's clan-avg line both use), fed through the
// exact same pure calcAvg/calcTrend/heatClass helpers calcRow() uses, since
// those only operate on plain scores arrays and don't care whose they are.
// Participation/avg-battles instead average each active player's OWN
// computed rate, since those are genuinely "how are the members doing on
// average" rather than a single clan-wide score.
function calcClanSummaryRow(activePlayers, shownWars) {
  const clanScoresByWarIdx = WARS.map((w, idx) => {
    const vals = activePlayers.map(p => p.scores[idx]).filter(s => s !== null && s > 0);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  });

  // Same includeLive-respecting filter as effectiveScores() -- otherwise a
  // live, still-in-progress war's partial (and usually much lower) clan
  // average silently slides into the trailing window and drags "Avg (3W)"
  // below what the visible war-cell columns show, since those come from
  // shownWars/effectiveWars() and already exclude it.
  const effectiveClanScores = includeLive
    ? clanScoresByWarIdx
    : clanScoresByWarIdx.filter((_, i) => !WARS[i] || !WARS[i].isLive);
  const avg = calcAvg(effectiveClanScores, warWindow);
  const trendType = calcTrend(effectiveClanScores, warWindow);

  const playerParts = activePlayers.map(p => calcParticipation(swapperAwareScores(p), warWindow).pct);
  const partPct = playerParts.length ? playerParts.reduce((a, b) => a + b, 0) / playerParts.length : 0;
  const partClass = partPct >= PART_HIGH ? 'part-high' : partPct >= PART_MID ? 'part-mid' : 'part-low';

  const playerAvgDecks = activePlayers.map(p => calcAllWarsAvgDecks(p)).filter(d => d >= 0);
  const avgDecks = playerAvgDecks.length ? playerAvgDecks.reduce((a, b) => a + b, 0) / playerAvgDecks.length : null;
  const avgDecksDisplay = avgDecks !== null ? avgDecks.toFixed(1) + '/16' : '—';
  const avgDecksFracClass = avgDecks === null ? ''
    : avgDecks >= 15.5 ? 'avg-s'
    : avgDecks >= 13.5 ? 'avg-a'
    : avgDecks >= 11.5 ? 'avg-b'
    : avgDecks >= 7.5  ? 'avg-c'
    : 'avg-d';

  // Per-war deck value: total decks used by EVERYONE who has a real row for
  // that war (all of PLAYERS, not just currently-active roster -- this is a
  // historical fact about that specific war), divided by the fixed 50
  // attacker-slot cap (WAR_ROSTER_SIZE), not by however many people
  // happened to contribute. Summing (rather than averaging per-player)
  // handles a roster slot split across two swap accounts correctly -- their
  // partial totals just add back up to a full slot -- and a genuinely
  // unfilled slot correctly too -- it contributes 0, pulling the total
  // down -- neither of which an average over "whoever's nonzero" can tell
  // apart from the data alone. Shown as the same deck-frac overlay
  // buildRow() shows per player when the Battles toggle is on.
  const warCells = shownWars.map(w => {
    const idx = WARS.findIndex(x => x.id === w.id);
    const s = idx === -1 ? null : clanScoresByWarIdx[idx];
    const cellClass = heatClass(s);
    const text = s === null ? '·' : s === 0 ? '✗' : s.toLocaleString();
    const isRaw = idx !== -1 && !WARS[idx].isAuto;
    const totalDecks = idx === -1 ? 0 : PLAYERS.reduce((sum, p) => sum + ((p.decks && p.decks[idx] != null) ? p.decks[idx] : 0), 0);
    const deckValue = idx === -1 ? null : Math.round((totalDecks / WAR_ROSTER_SIZE) * 10) / 10;
    const deckClass = deckValue !== null ? deckFracClass(deckValue) : null;
    return { text, cellClass, isRaw, deckValue, deckClass };
  });

  return {
    avg, avgClass: avgClass(avg), partPct, partClass,
    avgDecksDisplay, avgDecksFracClass, trendType,
    activeCount: activePlayers.length, warCells
  };
}

// Render the clan-wide summary row from calcClanSummaryRow()'s output.
// Pure HTML building — add new numbers to calcClanSummaryRow() instead of
// deriving them inline here.
function buildClanSummaryRow(activePlayers, shownWars) {
  const r = calcClanSummaryRow(activePlayers, shownWars);
  const trendHtml = r.trendType === 'up'
    ? '<span class="trend-up">▲</span>'
    : r.trendType === 'down'
    ? '<span class="trend-down">▼</span>'
    : '<span class="trend-flat"></span>';
  const warCellsHtml = r.warCells.map(c => {
    const deckHtml = !sortBattles ? ''
      : c.isRaw
        ? '<span class="deck-frac deck-na">NA</span>'
        : c.deckValue !== null
          ? `<span class="deck-frac ${c.deckClass}">${c.deckValue}/16</span>`
          : '';
    return `<td class="wc ${c.cellClass}"><span class="wcell">${c.text}${deckHtml}</span></td>`;
  }).join('');

  return `<tr class="clan-summary-row">
    <td class="td-rank">★</td>
    <td class="td-player"><span class="player-name">United Clash</span></td>
    <td style="white-space:nowrap"><span class="pos-badge pos-clan">Clan</span></td>
    <td class="td-active" style="text-align:center;min-width:65px">${r.activeCount}</td>
    <td class="td-part"><div class="part-row">
      <span class="part-pct">${Math.round(r.partPct * 100)}%</span>
      <div class="part-bar-bg"><div class="part-bar-fill ${r.partClass}" style="width:${r.partPct*100}%"></div></div>
    </div></td>
    <td class="td-trend">${trendHtml}</td>
    <td class="td-avg" style="text-align:center;white-space:nowrap"><span class="wcell ${r.avgDecksFracClass}">${r.avgDecksDisplay}</span></td>
    <td class="td-avg ${r.avgClass}"><span class="wcell">${r.avg > 0 ? r.avg.toLocaleString() : '—'}</span></td>
    ${warCellsHtml}
  </tr>`;
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
    <td class="td-player"><span class="player-name">${p.name}${playerTagHtml(r.tag, 'dot')}</span>${r.promo}</td>
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

// localStorage read helper for the mobile name-pin toggle — wrapped in
// try/catch since localStorage can throw in some privacy modes, and a
// missing/blocked preference should just fall back to the default (on).
function mobilePinIsOff(kind) {
  try { return localStorage.getItem(kind === 'names' ? 'uc-pin-names' : 'uc-pin-header') === 'off'; }
  catch (e) { return false; }
}

function buildSection(title, color, players, isInactiveSection, shownWars, warHeaderHtml, showPinToggles, extraRowHtml = '') {
  if (!players.length) return '';
  const rows = players.map((p, i) => buildRow(p, i + 1, isInactiveSection, shownWars)).join('');
  // Mobile-only (see .mobile-pin-toggles CSS — display:none outside the
  // @media block) checkbox controlling the sticky name column below.
  // Only rendered next to the first section's title so there's one
  // shared control, not one per role-group section. The header row is
  // pinned unconditionally now (native position:sticky inside
  // .table-wrap's own bounded scroll box — see CSS), so there's nothing
  // left to toggle for that.
  const pinTogglesHtml = showPinToggles ? `
    <div class="mobile-pin-toggles">
      <label><input type="checkbox" ${mobilePinIsOff('names') ? '' : 'checked'} onchange="toggleMobilePin('names')"> Pin names</label>
    </div>` : '';
  return `<div class="section">
    <div class="section-hdr">
      <div class="section-stripe" style="background:${color}"></div>
      <div class="section-title">${title}</div>
      ${pinTogglesHtml}
      <div class="section-cnt">${players.length} members</div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="td-rank">#</th><th class="td-player">Player</th><th>Role</th>
        <th style="text-align:center">Active</th>
        <th>Participation</th><th style="text-align:center">Trend</th>
        <th style="text-align:center">Avg Battles</th>
        <th style="text-align:center">Avg (${warWindow === 0 ? 'All' : warWindow + 'W'})</th>
        ${warHeaderHtml}
      </tr></thead>
      <tbody>${extraRowHtml}${rows}</tbody>
    </table></div>
  </div>`;
}

// Mobile-only: applies the saved name-pin preference (body class) and
// measures the widest player name CURRENTLY on screen so the pinned name
// column (--player-col-w, read by CSS in index.html's @media block) is
// only ever as wide as the roster actually visible right now needs —
// search/sort/window changes all change what "widest visible name" means,
// so this re-runs after every renderData(), not just once at load.
// Portrait gets half that width (vs. landscape's full measured width) —
// portrait has much less horizontal room to spare for a name column that
// also has to share space with the horizontally-scrolling war columns.
function applyMobileDataPinning() {
  if (!window.matchMedia('(max-width: 768px)').matches) return;
  document.body.classList.toggle('pin-names-off', mobilePinIsOff('names'));

  let maxW = 0;
  document.querySelectorAll('#main .player-name').forEach(el => {
    maxW = Math.max(maxW, el.scrollWidth);
  });
  if (maxW > 0) {
    // +16 covers .td-player's own left/right padding so the name itself
    // isn't clipped right at its own edge.
    const full = maxW + 16;
    const isLandscape = window.matchMedia('(orientation: landscape)').matches;
    document.documentElement.style.setProperty('--player-col-w', (isLandscape ? full : full / 2) + 'px');
  }

  // table-layout:auto doesn't treat a <td>'s CSS width as a hard
  // constraint, so #'s ACTUAL rendered width can differ from what its
  // CSS declares — measure it directly so .td-player's left offset
  // lines up exactly, with no gap or overlap between the two.
  const rankCell = document.querySelector('#main .td-rank');
  if (rankCell) {
    document.documentElement.style.setProperty('--rank-col-w', rankCell.getBoundingClientRect().width + 'px');
  }
}

function toggleMobilePin(kind) {
  const key = kind === 'names' ? 'uc-pin-names' : 'uc-pin-header';
  const cls = kind === 'names' ? 'pin-names-off' : 'pin-header-off';
  const isOff = document.body.classList.toggle(cls);
  try { localStorage.setItem(key, isOff ? 'off' : 'on'); } catch (e) {}
}

function renderData() {
  // Controls live inside #main on mobile (see mountTabControls(), main.js)
  // -- they're the real elements, so they must be moved back out before
  // #main's innerHTML is replaced below or they'd be destroyed.
  parkTabControls();

  const { active, inactive } = filterPlayers();
  const { shown: shownWars, html: warHeaderHtml } = buildWarHeaders();

  // Clan summary row represents the WHOLE clan, so it's built from the
  // unfiltered active roster (not filterPlayers()'s search-narrowed list --
  // searching for one player shouldn't change the clan's own totals).
  const allActive = PLAYERS.filter(p => !isInactive(p));
  const clanRowHtml = buildClanSummaryRow(allActive, shownWars);

  // Mobile-only controls banner (window/sort/battles/live-data/personal
  // best) above the first section -- gold to match the Data tab's own
  // mode button and its Active Members section stripe.
  let html = tabControlBannerHtml('data');
  let firstSection = true;

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
      if (sorted.length) {
        html += buildSection(sec.label, sec.color, sorted, false, shownWars, warHeaderHtml, firstSection, firstSection ? clanRowHtml : '');
        firstSection = false;
      }
    }
  } else {
    html += buildSection('Active Members', 'var(--gold)', sortPlayers(active), false, shownWars, warHeaderHtml, true, clanRowHtml);
  }

  // Inactive section — always a collapsible button, never a toggle
  if (inactive.length) {
    if (showInactive) {
      html += buildSection('Inactive / Former Members', 'var(--text-dim)', sortPlayers(inactive), true, shownWars, warHeaderHtml, false);
      html += `<button class="show-inactive-btn" onclick="toggleInactive()">▴ Hide Inactive Members</button>`;
    } else {
      html += `<button class="show-inactive-btn" onclick="toggleInactive()">▸ Show ${inactive.length} Inactive / Former Members</button>`;
    }
  }

  document.getElementById('main').innerHTML = html;
  mountTabControls(); // main.js -- fills the banner above on mobile
  applyMobileDataPinning();
}

function toggleInactive() { showInactive = !showInactive; render(); }
