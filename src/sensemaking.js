// Sensemaking Explorer — two coordinated views over the NFDI4Energy dataset catalog:
//   1. Adjacency Matrix (split: matrix ½ · dataset TILES ½)
//        · tiles default to all datasets (ranked); clicking a matrix cell filters them
//        · each tile carries its own detail (title, domain·cluster, author, org, keywords)
//   2. Egonet Explorer (expandable layered tree) — click a tile to open it here
//
// Edges carry their provenance:  e.via = { prop, value }  ·  e.vias = [{prop,value}…]

import * as d3 from 'd3';
import { EnergyKG } from './data.js';
import { openStoryline } from './storyline.js';
import { colorFor, esc, clip, viaKey, groupByVia, acronymOf } from './helpers.js';

const PROP_META = {
  author:  { label: 'Author',       glyph: '✎', predicate: 'dct:creator → pro:Author' },
  doi:     { label: 'Cited DOI',    glyph: '◈', predicate: 'datacite:isDescribedBy' },
  contact: { label: 'Contact',      glyph: '✉', predicate: 'vcard:fn' },
  // Publisher is display-only metadata, never an edge (it just mirrors the
  // source domain) — `link:false` keeps it out of the linkable-property lists.
  org:     { label: 'Publisher',    glyph: '⌂', predicate: 'dct:publisher', link: false },
  keyword: { label: 'Keyword',      glyph: '#', predicate: 'dcat:keyword' },
};
// Properties that actually form edges (used for the facet chips & egonet legend)
const LINK_PROPS = Object.entries(PROP_META).filter(([, m]) => m.link !== false);
const KIND_META = {
  intra:   { label: 'Intra-cluster',  desc: 'same cluster',     color: 'var(--teal)',          hex: '#3fc8c0' },
  sibling: { label: 'Sibling',        desc: 'same domain',      color: 'var(--amber)',         hex: '#e7a23c' },
  cross:   { label: 'Cross-domain',   desc: 'different domain', color: 'oklch(0.55 0.18 320)', hex: '#a23bb5' },
};

export function renderSensemaking(container, options = {}) {
  container.innerHTML = '';
  const KG = EnergyKG;
  const title = options.title || 'Sensemaking Explorer';
  // Storytelling mode: selecting a dataset opens the Storyline trail directly
  // instead of the Egonet tree (see src/storytelling.js).
  const directStoryline = !!options.directStoryline;

  // ── Node lookup + degrees
  const nodeById = {};
  KG.leafNodes.forEach(n => (nodeById[n.id] = n));
  const degree = {}, extDeg = {};
  KG.leafNodes.forEach(n => { degree[n.id] = 0; extDeg[n.id] = 0; });
  KG.edges.forEach(e => {
    degree[e.source] = (degree[e.source] || 0) + 1;
    degree[e.target] = (degree[e.target] || 0) + 1;
    const sn = nodeById[e.source], tn = nodeById[e.target];
    if (sn && tn && sn.cluster !== tn.cluster) {
      extDeg[e.source] = (extDeg[e.source] || 0) + 1;
      extDeg[e.target] = (extDeg[e.target] || 0) + 1;
    }
  });

  // ── Adjacency carrying edge provenance
  const adjacency = new Map();
  KG.leafNodes.forEach(n => adjacency.set(n.id, []));
  KG.edges.forEach(e => {
    adjacency.get(e.source)?.push({ id: e.target, kind: e.kind, via: e.via, vias: e.vias || [] });
    adjacency.get(e.target)?.push({ id: e.source, kind: e.kind, via: e.via, vias: e.vias || [] });
  });

  // ── Per-node set of relationship props it participates in (for the "Linked via" facet)
  const viaProps = new Map();   // nodeId → Set<'author'|'doi'|'contact'|'org'|'keyword'>
  KG.leafNodes.forEach(n => viaProps.set(n.id, new Set()));
  KG.edges.forEach(e => {
    const list = e.vias && e.vias.length ? e.vias : (e.via ? [e.via] : []);
    const sp = viaProps.get(e.source), tp = viaProps.get(e.target);
    for (const v of list) { if (!v?.prop) continue; sp?.add(v.prop); tp?.add(v.prop); }
  });

  // ── Clusters ordered by domain then size
  const domainOrder = KG.TAXONOMY.map(d => d.id);
  const clusterList = Object.values(KG.clusters)
    .filter(c => c.leafCount > 0)
    .sort((a, b) => {
      const di = domainOrder.indexOf(a.domain), dj = domainOrder.indexOf(b.domain);
      return di !== dj ? di - dj : b.leafCount - a.leafCount;
    });

  // Unique acronym per cluster — shared by the matrix labels, bundle ring, and both legends.
  const clusterAcro = {};
  { const used = new Map();
    clusterList.forEach(c => {
      let a = acronymOf(c.label);
      if (used.has(a)) { const n = used.get(a) + 1; used.set(a, n); a += n; } else used.set(a, 1);
      clusterAcro[c.id] = a;
    }); }
  // The acronym → full-name key, shown in a corner of the matrix / bundle.
  function acroLegend(side) {
    const el = document.createElement('div');
    el.className = 'sm-acro-legend' + (side === 'right' ? ' sm-acro-right' : side === 'below' ? ' sm-acro-below' : '');
    el.innerHTML = `<div class="sm-acro-head">CLUSTER KEY</div>` + clusterList.map(c =>
      `<div class="sm-acro-row">
        <span class="sm-acro-tag" style="color:${colorFor(c.hue, 0.45, 0.15)};border-color:${colorFor(c.hue, 0.62, 0.12)}">${esc(clusterAcro[c.id])}</span>
        <span class="sm-acro-name">${esc(c.label)}</span>
      </div>`).join('');
    return el;
  }

  // ── Cluster×cluster connectivity + intra counts
  const matrixData = {}, intraCount = {};
  clusterList.forEach(c => (matrixData[c.id] = {}));
  KG.edges.forEach(e => {
    const sn = nodeById[e.source], tn = nodeById[e.target];
    if (!sn || !tn) return;
    if (sn.cluster === tn.cluster) { intraCount[sn.cluster] = (intraCount[sn.cluster] || 0) + 1; return; }
    matrixData[sn.cluster][tn.cluster] = (matrixData[sn.cluster][tn.cluster] || 0) + 1;
    matrixData[tn.cluster][sn.cluster] = (matrixData[tn.cluster][sn.cluster] || 0) + 1;
  });

  // ════════════════════════════════════════════════════════════
  //  Skeleton (no left panel — tiles live in the matrix's right pane)
  // ════════════════════════════════════════════════════════════
  const main = document.createElement('div');
  main.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;height:100%;overflow:hidden;position:relative;';
  const toolbar = document.createElement('div');
  toolbar.className = 'breadcrumb-bar';
  toolbar.style.gap = '8px';
  toolbar.innerHTML = directStoryline
    ? `<button id="st-lens-btn" class="st-lens-btn" title="Structure the dataset list by cluster connectivity">◫ Filterix</button>`
    : `<span style="font-weight:600;font-size:13px;color:var(--ink);">${esc(title)}</span>
       <span class="crumb-sep">·</span>
       <span id="sm-view-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-3);letter-spacing:0.14em;">CLUSTER × CLUSTER CONNECTIVITY</span>`;
  main.appendChild(toolbar);
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';
  main.appendChild(canvasWrap);
  container.appendChild(main);

  // ── State
  let currentView = 'matrix';
  let selectedNode = null;
  let sortMode = 'degree';
  let matrixSvg = null;
  let mxRefresh = null;                    // matrix: re-applies the crosshair for the current selection
  let matrixDisplayW = null;               // matrix: user-dragged display width (px); null = auto-fit column
  let storyCloseLens = null;               // storytelling: hides the Filterix overlay (set in renderStoryLayout)
  let storySetSplit = null;                // storytelling: sets the split layout state ('browse'|'filterix'|'story')
  let matrixHighlightCluster = null;
  let matrixLink = null;                   // matrix only: a selected connection { a, b }
  let matrixMode = 'matrix';              // 'matrix' | 'chord' | 'bundle'
  let chordSvg = null, chordClusters = [];
  let bundleSvg = null, bundleLeaves = {};
  let tileFilter = { mode: 'all' };       // {mode:'all'} | {mode:'cluster',id} | {mode:'pair',a,b}
  let relFacet = new Set();               // "Linked via" facet: subset of author|doi|contact|org|keyword (empty = all)
  let tileView = 'tiles';                 // 'tiles' (card grid) | 'table' (dense, sortable comparison)
  let tableColW = {};                     // table view: drag-resized column widths (px), keyed by column key
  let egoTrail = [];
  let egoPane = null;                     // current ego column DOM node (set by renderEgonet)

  // ════════════════════════════════════════════════════════════
  //  VIEW 1 — Adjacency matrix (left) · dataset tiles (right)
  // ════════════════════════════════════════════════════════════
  function kindLegendHTML() {
    return `<div class="sm-kind-legend">
      ${Object.entries(KIND_META).map(([k, m]) =>
        `<span class="sm-kind-item"><span class="sm-kind-sw" style="background:${m.color}"></span>${m.label}<span class="sm-kind-desc">(${m.desc})</span></span>`).join('')}
    </div>`;
  }

  // ── Shared markup + wiring, reused by the Sensemaking three-column layout and
  //    the Storytelling split layout (tiles left · storyline right + lens overlay).
  function matrixColMarkup() {
    return `
      <div class="sm-matrix-toolbar">
        <div class="sm-mode-toggle">
          <button data-mode="matrix" class="${matrixMode === 'matrix' ? 'active' : ''}">▦ Matrix</button>
          <button data-mode="chord" class="${matrixMode === 'chord' ? 'active' : ''}">◍ Chord</button>
          <button data-mode="bundle" class="${matrixMode === 'bundle' ? 'active' : ''}">❀ Bundle</button>
        </div>
      </div>
      ${kindLegendHTML()}
      <div class="sm-matrix-scroll"></div>`;
  }
  function tilesColMarkup() {
    return `
      <div class="sm-tiles-head">
        <div class="sm-tiles-row">
          <input id="sm-search" autocomplete="off" placeholder="Search datasets — title · keyword · author…">
          <button class="sm-sort-btn active" data-sort="degree">Total deg</button>
          <button class="sm-sort-btn" data-sort="external">External</button>
          <div class="sm-view-toggle">
            <button data-view="tiles" class="${tileView === 'tiles' ? 'active' : ''}" title="Card grid — best for small result sets">▦</button>
            <button data-view="table" class="${tileView === 'table' ? 'active' : ''}" title="Dense table — best for ranking &amp; comparison">≣</button>
          </div>
        </div>
        <div class="sm-tiles-row sm-facet-row" id="sm-facet-row">
          <span class="sm-facet-label">Linked via</span>
          ${LINK_PROPS.map(([prop, m]) =>
            `<button class="sm-facet-chip${relFacet.has(prop) ? ' active' : ''}" data-prop="${prop}" title="${esc(m.predicate)}">
               <span class="sm-facet-glyph">${m.glyph}</span>${m.label}</button>`).join('')}
          <button class="sm-facet-clear" id="sm-facet-clear" style="${relFacet.size ? '' : 'display:none'}">reset</button>
        </div>
        <div class="sm-tiles-context" id="sm-tiles-context"></div>
      </div>
      <div class="sm-tiles-grid" id="sm-tiles-grid"></div>`;
  }
  // Wire the matrix/chord/bundle mode toggle within `scope` and draw the active one.
  function wireMatrixControls(scope) {
    const scroll = scope.querySelector('.sm-matrix-scroll');
    drawActiveLeft(scroll);
    scope.querySelectorAll('.sm-mode-toggle button').forEach(b => b.addEventListener('click', () => {
      matrixMode = b.dataset.mode;
      scope.querySelectorAll('.sm-mode-toggle button').forEach(x => x.classList.toggle('active', x.dataset.mode === matrixMode));
      drawActiveLeft(scroll);
    }));
    return scroll;
  }
  // Wire the tiles head (search · sort · view toggle · facets) within `scope`.
  function wireTilesControls(scope) {
    const search = scope.querySelector('#sm-search');
    search.addEventListener('input', () => renderTiles());
    scope.querySelectorAll('.sm-sort-btn').forEach(b => b.addEventListener('click', () => {
      sortMode = b.dataset.sort;
      scope.querySelectorAll('.sm-sort-btn').forEach(x => x.classList.toggle('active', x.dataset.sort === sortMode));
      renderTiles();
    }));
    scope.querySelectorAll('.sm-view-toggle button').forEach(b => b.addEventListener('click', () => {
      tileView = b.dataset.view;
      scope.querySelectorAll('.sm-view-toggle button').forEach(x => x.classList.toggle('active', x.dataset.view === tileView));
      renderTiles();
    }));
    const facetRow = scope.querySelector('#sm-facet-row');
    const facetClear = scope.querySelector('#sm-facet-clear');
    function syncFacetChips() {
      facetRow.querySelectorAll('.sm-facet-chip').forEach(x => x.classList.toggle('active', relFacet.has(x.dataset.prop)));
      facetClear.style.display = relFacet.size ? '' : 'none';
    }
    facetRow.querySelectorAll('.sm-facet-chip').forEach(b => b.addEventListener('click', () => {
      const p = b.dataset.prop;
      relFacet.has(p) ? relFacet.delete(p) : relFacet.add(p);
      syncFacetChips();
      renderTiles();
    }));
    facetClear.addEventListener('click', () => { relFacet.clear(); syncFacetChips(); renderTiles(); });
  }

  // Sensemaking layout — matrix | tiles | egonet.
  function renderMatrix() {
    canvasWrap.innerHTML = '';
    const threecol = document.createElement('div');
    threecol.className = 'sm-three-col';
    threecol.innerHTML = `
      <div class="sm-col-matrix">${matrixColMarkup()}</div>
      <div class="sm-col-tiles">${tilesColMarkup()}</div>
      <div class="sm-col-ego"></div>`;
    canvasWrap.appendChild(threecol);
    wireMatrixControls(threecol.querySelector('.sm-col-matrix'));
    wireTilesControls(threecol);
    renderTiles();
  }

  // Storytelling layout — tiles/table on the LEFT, storyline canvas on the RIGHT.
  // "Filterix" (the matrix/chord/bundle lens) is not inline; it opens as an overlay
  // OVER THE RIGHT CANVAS ONLY and is used to STRUCTURE the left-hand list: clicking
  // a cluster or a connection filters the datasets live (the list is visible beside
  // the overlay). Click again / click empty space to deselect; ✕ to close.
  function canvasPromptHTML() {
    return `<div class="st-canvas-empty">
      <div class="st-canvas-empty-mk">◇</div>
      <div class="st-canvas-empty-t">Select a dataset to build its storyline</div>
      <div class="st-canvas-empty-s">Pick a dataset from the list on the left. Use <b>◫ Filterix</b> to structure that list by cluster connectivity first.</div>
    </div>`;
  }
  function renderStoryLayout() {
    canvasWrap.innerHTML = '';
    const split = document.createElement('div');
    split.className = 'st-split';
    split.innerHTML = `
      <div class="sm-col-tiles st-left">${tilesColMarkup()}</div>
      <div class="st-canvas st-right">${canvasPromptHTML()}</div>`;
    canvasWrap.appendChild(split);
    const canvas = split.querySelector('.st-canvas');

    // Filterix overlay — hidden until the toolbar button is pressed. Mounted on the
    // right canvas so it only covers that pane, leaving the tile list interactive.
    const mo = document.createElement('div');
    mo.className = 'st-matrix-overlay';
    mo.style.display = 'none';
    mo.innerHTML = `
      <div class="st-mo-head">
        <span class="st-mo-title">◫ FILTERIX</span>
        <span class="st-mo-hint">click a cluster / connection to structure the list · click again or empty space to clear</span>
        <button class="st-mo-close" title="Close Filterix">✕ close</button>
      </div>
      <div class="sm-col-matrix">${matrixColMarkup()}</div>`;
    canvas.appendChild(mo);

    // Layout states drive the split ratio (CSS transitions grid-template-columns):
    //   browse   → tiles fill the canvas (right pane collapsed)
    //   filterix → tiles ~60% · Filterix ~40%
    //   story    → tiles ~30% · storyline spine ~70%
    const setState = s => {
      split.classList.toggle('fx-open', s === 'filterix');
      split.classList.toggle('story-open', s === 'story');
    };
    const hasStory = () => !!canvas.querySelector('.st-trail');
    storySetSplit = setState;
    storyCloseLens = () => { mo.style.display = 'none'; };   // hide Filterix (state handled by caller)

    let matrixWired = false;
    const openLens = () => {
      setState('filterix');
      mo.style.display = 'flex';
      // Draw only once the overlay is visible — the matrix sizes to its container.
      if (!matrixWired) { wireMatrixControls(mo.querySelector('.sm-col-matrix')); matrixWired = true; }
      else drawActiveLeft(mo.querySelector('.sm-matrix-scroll'));
    };
    const closeLens = () => { mo.style.display = 'none'; setState(hasStory() ? 'story' : 'browse'); };
    mo.querySelector('.st-mo-close').onclick = closeLens;
    const lensBtn = main.querySelector('#st-lens-btn');
    if (lensBtn) lensBtn.onclick = () => (mo.style.display === 'none' ? openLens() : closeLens());
    // Re-fit the matrix once the split finishes resizing (it sizes to its container).
    split.addEventListener('transitionend', e => {
      if (e.propertyName === 'grid-template-columns' && mo.style.display !== 'none' && matrixWired)
        drawActiveLeft(mo.querySelector('.sm-matrix-scroll'));
    });

    wireTilesControls(split);
    renderTiles();
  }

  // dispatch to the active left-pane visualization
  function drawActiveLeft(host) {
    if (matrixMode === 'chord') drawChord(host);
    else if (matrixMode === 'bundle') drawBundle(host);
    else drawMatrix(host);
  }
  function applyLeftHighlight(id) {
    if (matrixMode === 'chord') applyChordHighlight(id);
    else if (matrixMode === 'bundle') applyBundleHighlight(id);
    else { if (id == null) matrixLink = null; applyMatrixHighlight(); }
  }

  function drawMatrix(host) {
    host.innerHTML = '';
    const { width: PW = 540, height: PH = 600 } = host.getBoundingClientRect();
    const n = clusterList.length;
    // No top margin — the matrix sits flush at the top; a single domain colour bar runs
    // down the left edge (bracketing each domain's run of rows).
    const ml = 12, mt = 2, mr = 8, mb = 8;
    // Size to the column WIDTH (fills it, bolder cells) and let it scroll vertically.
    const cellSize = Math.max(20, Math.min(52, (PW - ml - mr) / n));
    const W = ml + n * cellSize + mr, H = mt + n * cellSize + mb;

    matrixSvg = d3.select(host).append('svg').attr('width', W).attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`).style('display', 'block').style('margin', '0 auto auto 0');
    // Apply any user-chosen size (drag-to-resize); the viewBox scales all content to fit.
    if (matrixDisplayW) matrixSvg.style('width', matrixDisplayW + 'px').style('height', (matrixDisplayW * H / W) + 'px');

    const maxW = Math.max(1, d3.max(clusterList.flatMap(a => clusterList.map(b => matrixData[a.id]?.[b.id] || 0))));
    const g = matrixSvg.append('g').attr('transform', `translate(${ml},${mt})`);

    // Domain colour bar down the left edge, bracketing each domain's run of rows.
    const breaks = []; let last = null;
    clusterList.forEach((c, i) => { if (c.domain !== last) { breaks.push({ domain: c.domain, start: i }); last = c.domain; } });
    breaks.forEach((dk, di) => {
      const next = di + 1 < breaks.length ? breaks[di + 1].start : n;
      const span = (next - dk.start) * cellSize, p0 = dk.start * cellSize;
      const dh = KG.domains[dk.domain].hue, col = colorFor(dh, 0.6, 0.14);
      const dlabel = `${KG.domains[dk.domain].label} · ${next - dk.start} cluster${next - dk.start === 1 ? '' : 's'}`;
      g.append('rect').attr('x', -8).attr('y', p0 + 1).attr('width', 4).attr('height', span - 2).attr('fill', col).attr('rx', 2)
        .append('title').text(dlabel);
    });

    // Lower triangle + diagonal (symmetric matrix — upper triangle is redundant).
    const cells = [];
    clusterList.forEach((rowC, ri) => clusterList.forEach((colC, ci) => {
      if (ci > ri) return;
      cells.push({ rowC, colC, ri, ci, w: matrixData[rowC.id]?.[colC.id] || 0, diag: rowC.id === colC.id });
    }));
    const compact = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(v);
    const fitFont = (text, avail, max) => Math.max(6, Math.min(max, avail / (String(text).length * 0.62)));

    // ── Wired matrix (white): the diagonal holds the cluster COMPONENTS (chips); each
    //    link is a thin trace with a distinct PIN on each component's edge, routed along
    //    the row and up the column, bending at a via that carries the link count. Pins are
    //    spread along each edge so a component sprouts many separate legs (detail), and
    //    every trace terminates on its two components — no row/column ambiguity.
    // ── Heatmap: off-diagonal tiles coloured by link count (faint → rich teal); the
    //    diagonal holds the cluster component chips. Selecting a tile draws GUIDE LINES
    //    from it to its two diagonal chips — the only time grid lines appear, so they
    //    unambiguously trace the one chosen connection.
    const gap = Math.max(1.6, cellSize * 0.13);
    const rad = Math.min(4, cellSize * 0.22);
    const inner = cellSize - gap;
    const heat = v => {
      if (v <= 0) return 'oklch(0.975 0.004 200)';
      const t = Math.sqrt(v / maxW);
      return `oklch(${(0.94 - t * 0.52).toFixed(3)} ${(0.03 + t * 0.13).toFixed(3)} 195)`;
    };
    const darkTile = v => Math.sqrt(v / maxW) > 0.46;

    const cellG = g.selectAll('g.sm-cell').data(cells).enter().append('g')
      .attr('class', 'sm-cell').attr('transform', d => `translate(${d.ci * cellSize},${d.ri * cellSize})`)
      .style('cursor', d => (d.w > 0 || d.diag) ? 'pointer' : 'default');

    cellG.append('rect')
      .attr('class', d => d.diag ? 'sm-mx-node' : (d.w > 0 ? 'sm-mx-tile' : 'sm-mx-tile sm-mx-empty'))
      .attr('x', gap / 2).attr('y', gap / 2).attr('width', inner).attr('height', inner).attr('rx', rad)
      .attr('fill', d => d.diag ? colorFor(d.rowC.hue, 0.94, 0.05) : heat(d.w))
      .attr('stroke', d => d.diag ? colorFor(d.rowC.hue, 0.55, 0.15) : null);

    const diag = cellG.filter(d => d.diag);
    const conn = cellG.filter(d => !d.diag && d.w > 0);

    cellG.filter(d => d.diag || d.w > 0).append('title').text(d => d.diag
      ? `${d.rowC.label} (${clusterAcro[d.rowC.id]}) · ${d.rowC.leafCount.toLocaleString()} datasets`
      : `${d.rowC.label} ↔ ${d.colC.label} · ${d.w.toLocaleString()} link${d.w === 1 ? '' : 's'}`);

    if (cellSize >= 20) {
      diag.append('text').attr('class', 'sm-mx-acro').attr('pointer-events', 'none')
        .attr('x', cellSize / 2).attr('y', cellSize * 0.36).attr('dy', '0.32em').attr('text-anchor', 'middle')
        .attr('font-size', d => fitFont(clusterAcro[d.rowC.id], cellSize - 4, cellSize * 0.28))
        .attr('fill', d => colorFor(d.rowC.hue, 0.42, 0.15)).text(d => clusterAcro[d.rowC.id]);
      diag.append('text').attr('class', 'sm-mx-count').attr('pointer-events', 'none')
        .attr('x', cellSize / 2).attr('y', cellSize * 0.68).attr('dy', '0.32em').attr('text-anchor', 'middle')
        .attr('font-size', d => fitFont(compact(d.rowC.leafCount), cellSize - 5, cellSize * 0.3))
        .attr('fill', 'var(--ink)').text(d => compact(d.rowC.leafCount));
    }
    if (cellSize >= 16) {
      conn.append('text').attr('class', 'sm-mx-val').attr('pointer-events', 'none')
        .attr('x', cellSize / 2).attr('y', cellSize / 2).attr('dy', '0.32em').attr('text-anchor', 'middle')
        .attr('font-size', d => fitFont(compact(d.w), inner - 3, cellSize * 0.33))
        .attr('fill', d => darkTile(d.w) ? '#fff' : 'var(--ink-2)').text(d => compact(d.w));
    }

    // Guide-line layer (on top) — populated only for the selected connection: two lines
    // from the cell to its two diagonal chips, with PIN markers at both chip ends + the cell.
    const guideG = g.append('g').attr('class', 'sm-mx-guide').attr('pointer-events', 'none');
    function drawGuides(sel) {
      guideG.selectAll('*').remove();
      if (!sel || sel.diag) return;
      const cx = sel.ci * cellSize + cellSize / 2, cy = sel.ri * cellSize + cellSize / 2;
      const rowX = sel.ri * cellSize, colY = (sel.ci + 1) * cellSize;   // row-chip left edge · column-chip bottom edge
      guideG.append('line').attr('class', 'sm-guide').attr('x1', cx).attr('y1', cy).attr('x2', rowX).attr('y2', cy);
      guideG.append('line').attr('class', 'sm-guide').attr('x1', cx).attr('y1', cy).attr('x2', cx).attr('y2', colY);
      const pr = Math.max(2.4, cellSize * 0.11);
      guideG.append('circle').attr('class', 'sm-guide-dot').attr('cx', cx).attr('cy', cy).attr('r', pr);
      guideG.append('circle').attr('class', 'sm-guide-pin').attr('cx', rowX).attr('cy', cy).attr('r', pr * 0.72);
      guideG.append('circle').attr('class', 'sm-guide-pin').attr('cx', cx).attr('cy', colY).attr('r', pr * 0.72);
    }

    // ── Highlight: a tile + its two component chips. Guide lines / pins / dimming appear
    //    on SELECT only.
    function chipGlow(d) {
      const ids = !d ? [] : d.diag ? [d.rowC.id] : [d.rowC.id, d.colC.id];
      cellG.each(function (x) { d3.select(this).select('.sm-mx-node').classed('mx-lit', ids.includes(x.rowC.id)); });
    }
    function currentSelCell() {
      if (matrixLink) return cells.find(c => !c.diag && ((c.rowC.id === matrixLink.a && c.colC.id === matrixLink.b) || (c.rowC.id === matrixLink.b && c.colC.id === matrixLink.a)));
      if (matrixHighlightCluster) return cells.find(c => c.diag && c.rowC.id === matrixHighlightCluster);
      return null;
    }
    mxRefresh = () => {
      const selD = currentSelCell();
      // Cells to keep bright = the selected cell + the two diagonal chips of the connection.
      let keep = null;
      if (selD && !selD.diag) {
        keep = new Set([selD,
          cells.find(c => c.diag && c.rowC.id === selD.rowC.id),
          cells.find(c => c.diag && c.rowC.id === selD.colC.id)]);
      } else if (selD && selD.diag) {
        keep = new Set([selD]);
      }
      cellG.each(function (x) {
        d3.select(this).select('rect').classed('cell-sel', x === selD);
        d3.select(this).attr('opacity', keep ? (keep.has(x) ? 1 : 0.14) : 1);   // dim the unrelated cells
      });
      drawGuides(selD);
      chipGlow(selD);
    };

    const clearSelection = () => {
      if (!matrixHighlightCluster && !matrixLink) return;
      matrixHighlightCluster = null; matrixLink = null; applyMatrixHighlight(); setTileFilter({ mode: 'all' });
    };
    cellG.on('mouseenter', (ev, d) => { if (d.diag || d.w > 0) chipGlow(d); })
      .on('mouseleave', () => chipGlow(currentSelCell()))
      .on('click', (ev, d) => {
        if (!(d.diag || d.w > 0)) return;
        ev.stopPropagation();
        if (d.diag) {
          if (matrixHighlightCluster === d.rowC.id) { clearSelection(); return; }
          matrixHighlightCluster = d.rowC.id; matrixLink = null; applyMatrixHighlight(); setTileFilter({ mode: 'cluster', id: d.rowC.id });
        } else {
          const same = matrixLink && ((matrixLink.a === d.rowC.id && matrixLink.b === d.colC.id) || (matrixLink.a === d.colC.id && matrixLink.b === d.rowC.id));
          if (same) { clearSelection(); return; }
          matrixHighlightCluster = null; matrixLink = { a: d.rowC.id, b: d.colC.id }; applyMatrixHighlight(); setTileFilter({ mode: 'pair', a: d.rowC.id, b: d.colC.id });
        }
      });
    // Clicking empty space clears the current selection.
    matrixSvg.on('click', clearSelection);

    host.style.position = 'relative';
    host.appendChild(acroLegend('right'));

    // ── Resize grip: drag the bottom-right corner to resize the matrix (crop-style);
    //    double-click to reset to the auto fit. Lives in viewBox space so it rides the corner.
    const gs = 16;
    const grip = matrixSvg.append('g').attr('class', 'sm-mx-resize').style('cursor', 'nwse-resize')
      .attr('transform', `translate(${W - gs},${H - gs})`);
    grip.append('rect').attr('width', gs).attr('height', gs).attr('fill', 'transparent');
    grip.append('path').attr('class', 'sm-mx-resize-grip')
      .attr('d', `M${gs - 3},4 L4,${gs - 3} M${gs - 3},9 L9,${gs - 3} M${gs - 3},14 L14,${gs - 3}`);
    grip.on('click', ev => ev.stopPropagation())
      .on('dblclick', ev => {
        ev.stopPropagation();
        matrixDisplayW = null;
        matrixSvg.style('width', W + 'px').style('height', H + 'px');
      });
    grip.call(d3.drag()
      .on('drag', ev => {
        const r = matrixSvg.node().getBoundingClientRect();
        const w = Math.max(160, Math.min(1600, ev.sourceEvent.clientX - r.left + gs));
        matrixDisplayW = w;
        matrixSvg.style('width', w + 'px').style('height', (w * H / W) + 'px');
      }));

    if (matrixHighlightCluster || matrixLink) applyMatrixHighlight();
  }

  // The matrix highlight is entirely the crosshair for the current selection.
  function applyMatrixHighlight() { if (mxRefresh) mxRefresh(); }

  // ── Chord diagram: same cluster×cluster data as the matrix, friendlier idiom.
  //    Arcs = clusters (grouped/coloured by domain) · ribbons = connection counts.
  function drawChord(host) {
    host.innerHTML = '';
    chordSvg = null;
    const { width: PW = 540, height: PH = 600 } = host.getBoundingClientRect();

    // only clusters that actually have cross-cluster connections appear in the chord
    chordClusters = clusterList.filter(c =>
      clusterList.some(o => o.id !== c.id && (matrixData[c.id]?.[o.id] || 0) > 0));
    const N = chordClusters.length;
    if (N < 2) { host.innerHTML = '<div class="sm-tiles-empty" style="padding:20px;">No inter-cluster connections to chart.</div>'; return; }

    const matrix = chordClusters.map(a => chordClusters.map(b =>
      a.id === b.id ? 0 : (matrixData[a.id]?.[b.id] || 0)));

    const size = Math.max(240, Math.min(PW, PH) - 10);
    const cx = PW / 2, cy = PH / 2, R = size / 2;
    const labelMargin = Math.min(116, R * 0.36);
    const arcOuter = Math.max(46, R - labelMargin);
    const arcInner = arcOuter - 12, bandInner = arcOuter + 4, bandOuter = arcOuter + 9;

    const chords = d3.chord().padAngle(0.025).sortSubgroups(d3.descending)(matrix);

    const svg = d3.select(host).append('svg').attr('width', PW).attr('height', PH)
      .attr('viewBox', `0 0 ${PW} ${PH}`).style('display', 'block');
    chordSvg = svg;
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
    const arc = d3.arc().innerRadius(arcInner).outerRadius(arcOuter);
    const ribbon = d3.ribbon().radius(arcInner);

    const tip = d3.select(host).append('div').attr('class', 'sm-tooltip')
      .style('position', 'absolute').style('opacity', 0).style('pointer-events', 'none').style('z-index', 20);

    // ribbons (connections)
    g.append('g').selectAll('path.chord-ribbon').data(chords).enter().append('path')
      .attr('class', 'chord-ribbon').attr('d', ribbon)
      .attr('fill', d => colorFor(chordClusters[d.source.index].hue, 0.6, 0.13))
      .attr('fill-opacity', 0.55)
      .attr('stroke', d => colorFor(chordClusters[d.source.index].hue, 0.5, 0.1)).attr('stroke-opacity', 0.3)
      .on('mouseover', (ev, d) => {
        const a = chordClusters[d.source.index], b = chordClusters[d.target.index];
        tip.html(`<b style="color:${colorFor(a.hue)}">${esc(a.label)}</b> <span style="color:var(--ink-3)">↔</span> <b style="color:${colorFor(b.hue)}">${esc(b.label)}</b>
          <div style="color:var(--amber);font-family:'JetBrains Mono',monospace;font-size:11px;margin-top:4px;">${d.source.value} connection${d.source.value === 1 ? '' : 's'}</div>`).style('opacity', 1);
      })
      .on('mousemove', ev => tip.style('left', (ev.offsetX + 14) + 'px').style('top', (ev.offsetY - 10) + 'px'))
      .on('mouseout', () => tip.style('opacity', 0))
      .on('click', (ev, d) => {
        const a = chordClusters[d.source.index], b = chordClusters[d.target.index];
        matrixHighlightCluster = null; matrixLink = null; applyChordHighlight(null); setTileFilter({ mode: 'pair', a: a.id, b: b.id });
      });

    // arcs (clusters)
    const grp = g.append('g').selectAll('g.chord-grp').data(chords.groups).enter().append('g').attr('class', 'chord-grp');
    grp.append('path').attr('class', 'chord-arc').attr('d', arc)
      .attr('fill', d => colorFor(chordClusters[d.index].hue, 0.62, 0.15))
      .attr('stroke', d => colorFor(chordClusters[d.index].hue, 0.42, 0.1))
      .on('mouseover', (ev, d) => {
        applyChordHighlight(chordClusters[d.index].id);
        const c = chordClusters[d.index];
        tip.html(`<b style="color:${colorFor(c.hue)}">${esc(c.label)}</b>
          <div style="color:var(--ink-3);font-size:10px;margin-top:3px;">${esc(KG.domains[c.domain].label)} · ${c.leafCount} datasets · ${d.value} connections</div>`).style('opacity', 1);
      })
      .on('mousemove', ev => tip.style('left', (ev.offsetX + 14) + 'px').style('top', (ev.offsetY - 10) + 'px'))
      .on('mouseout', () => { tip.style('opacity', 0); applyChordHighlight(matrixHighlightCluster); })
      .on('click', (ev, d) => {
        const c = chordClusters[d.index];
        matrixHighlightCluster = c.id; applyChordHighlight(c.id); setTileFilter({ mode: 'cluster', id: c.id });
      });

    // cluster labels around the ring
    grp.append('text').attr('class', 'chord-label')
      .each(d => { d.mid = (d.startAngle + d.endAngle) / 2; }).attr('dy', '0.32em')
      .attr('transform', d => `rotate(${d.mid * 180 / Math.PI - 90}) translate(${arcOuter + 6}) ${d.mid > Math.PI ? 'rotate(180)' : ''}`)
      .attr('text-anchor', d => d.mid > Math.PI ? 'end' : 'start')
      .attr('fill', d => colorFor(chordClusters[d.index].hue, 0.48, 0.14))
      .style('cursor', 'pointer')
      .text(d => clip(chordClusters[d.index].label, 24))
      .on('click', (ev, d) => {
        const c = chordClusters[d.index];
        matrixHighlightCluster = c.id; applyChordHighlight(c.id); setTileFilter({ mode: 'cluster', id: c.id });
      });

    // outer domain bands
    const bands = [];
    chords.groups.forEach(d => {
      const dom = chordClusters[d.index].domain, lastB = bands[bands.length - 1];
      if (lastB && lastB.domain === dom) lastB.end = d.endAngle;
      else bands.push({ domain: dom, start: d.startAngle, end: d.endAngle });
    });
    const bandArc = d3.arc().innerRadius(bandInner).outerRadius(bandOuter);
    g.append('g').selectAll('path.chord-band').data(bands).enter().append('path')
      .attr('class', 'chord-band')
      .attr('d', d => bandArc({ startAngle: d.start, endAngle: d.end }))
      .attr('fill', d => colorFor(KG.domains[d.domain].hue, 0.55, 0.13)).attr('opacity', 0.85)
      .append('title').text(d => KG.domains[d.domain].label);

    applyChordHighlight(matrixHighlightCluster);
  }

  function applyChordHighlight(clusterId) {
    if (!chordSvg) return;
    const idx = clusterId ? chordClusters.findIndex(c => c.id === clusterId) : -1;
    chordSvg.selectAll('.chord-ribbon').attr('fill-opacity', d =>
      idx < 0 ? 0.55 : ((d.source.index === idx || d.target.index === idx) ? 0.78 : 0.05));
    chordSvg.selectAll('.chord-arc').attr('opacity', d => idx < 0 ? 1 : (d.index === idx ? 1 : 0.32));
    chordSvg.selectAll('.chord-label').attr('opacity', d => idx < 0 ? 1 : (d.index === idx ? 1 : 0.4));
  }

  // ── Hierarchical edge bundling (Holten): clusters on a ring ordered by the
  //    domain→cluster hierarchy; links curve along the hierarchy, so same-domain
  //    connections bundle toward their domain and the two communities stay apart.
  function drawBundle(host) {
    host.innerHTML = '';
    bundleSvg = null; bundleLeaves = {};
    const { width: PW = 540, height: PH = 600 } = host.getBoundingClientRect();

    const size = Math.max(240, Math.min(PW, PH) - 10);
    const cx = PW / 2, cy = PH / 2, R = size / 2;
    const labelMargin = Math.min(128, R * 0.42);
    const radius = Math.max(50, R - labelMargin);

    // hierarchy: root → domain → cluster
    const domainsData = KG.TAXONOMY
      .map(d => ({ id: d.id, hue: d.hue, children: clusterList.filter(c => c.domain === d.id) }))
      .filter(d => d.children.length);
    const root = d3.hierarchy({ id: 'root', children: domainsData }, d => d.children);
    d3.cluster().size([2 * Math.PI, radius])(root);
    const leaves = root.leaves();
    leaves.forEach(l => { bundleLeaves[l.data.id] = l; });

    // links between connected clusters
    const links = [];
    for (let i = 0; i < clusterList.length; i++)
      for (let j = i + 1; j < clusterList.length; j++) {
        const a = clusterList[i], b = clusterList[j], w = matrixData[a.id]?.[b.id] || 0;
        if (w > 0 && bundleLeaves[a.id] && bundleLeaves[b.id])
          links.push({ source: bundleLeaves[a.id], target: bundleLeaves[b.id], w, a, b });
      }

    const line = d3.lineRadial().curve(d3.curveBundle.beta(0.85)).radius(d => d.y).angle(d => d.x);
    const svg = d3.select(host).append('svg').attr('width', PW).attr('height', PH)
      .attr('viewBox', `0 0 ${PW} ${PH}`).style('display', 'block');
    bundleSvg = svg;
    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    const tip = d3.select(host).append('div').attr('class', 'sm-tooltip')
      .style('position', 'absolute').style('opacity', 0).style('pointer-events', 'none').style('z-index', 20);

    // links (bundled curves)
    g.append('g').attr('fill', 'none').selectAll('path.heb-link').data(links).enter().append('path')
      .attr('class', 'heb-link')
      .attr('d', d => line(d.source.path(d.target)))
      .attr('stroke', d => colorFor(d.a.hue, 0.6, 0.13))
      .attr('stroke-width', d => Math.max(0.6, Math.min(4, 0.4 + Math.log2(d.w + 1))))
      .attr('stroke-opacity', 0.32)
      .on('mouseover', function (ev, d) {
        d3.select(this).attr('stroke-opacity', 0.95).raise();
        tip.html(`<b style="color:${colorFor(d.a.hue)}">${esc(d.a.label)}</b> <span style="color:var(--ink-3)">↔</span> <b style="color:${colorFor(d.b.hue)}">${esc(d.b.label)}</b>
          <div style="color:var(--amber);font-family:'JetBrains Mono',monospace;font-size:11px;margin-top:4px;">${d.w} connection${d.w === 1 ? '' : 's'}</div>`).style('opacity', 1);
      })
      .on('mousemove', ev => tip.style('left', (ev.offsetX + 14) + 'px').style('top', (ev.offsetY - 10) + 'px'))
      .on('mouseout', function () { tip.style('opacity', 0); applyBundleHighlight(matrixHighlightCluster); })
      .on('click', (ev, d) => { matrixHighlightCluster = null; matrixLink = null; applyBundleHighlight(null); setTileFilter({ mode: 'pair', a: d.a.id, b: d.b.id }); });

    // cluster nodes + labels around the ring
    const node = g.append('g').selectAll('g.heb-node').data(leaves).enter().append('g')
      .attr('class', 'heb-node')
      .attr('transform', d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0)`);
    node.append('circle').attr('r', 2.6).attr('fill', d => colorFor(d.data.hue));
    node.append('text')
      .attr('dy', '0.31em')
      .attr('x', d => d.x < Math.PI ? 8 : -8)
      .attr('text-anchor', d => d.x < Math.PI ? 'start' : 'end')
      .attr('transform', d => d.x < Math.PI ? null : 'rotate(180)')
      .attr('fill', d => colorFor(d.data.hue, 0.48, 0.14))
      .style('cursor', 'pointer')
      .text(d => clusterAcro[d.data.id])
      .on('mouseover', (ev, d) => {
        applyBundleHighlight(d.data.id);
        const c = d.data, conn = clusterList.reduce((s, o) => s + (matrixData[c.id]?.[o.id] || 0), 0);
        tip.html(`<b style="color:${colorFor(c.hue)}">${esc(c.label)}</b>
          <div style="color:var(--ink-3);font-size:10px;margin-top:3px;">${esc(KG.domains[c.domain].label)} · ${c.leafCount} datasets · ${conn} connections</div>`).style('opacity', 1);
      })
      .on('mousemove', ev => tip.style('left', (ev.offsetX + 14) + 'px').style('top', (ev.offsetY - 10) + 'px'))
      .on('mouseout', () => { tip.style('opacity', 0); applyBundleHighlight(matrixHighlightCluster); })
      .on('click', (ev, d) => { matrixHighlightCluster = d.data.id; applyBundleHighlight(d.data.id); setTileFilter({ mode: 'cluster', id: d.data.id }); });

    // Acronym key — maps each ring acronym back to its full cluster name.
    host.style.position = 'relative';
    host.appendChild(acroLegend('left'));

    applyBundleHighlight(matrixHighlightCluster);
  }

  function applyBundleHighlight(clusterId) {
    if (!bundleSvg) return;
    const nbrs = clusterId
      ? new Set(clusterList.filter(c => (matrixData[clusterId]?.[c.id] || 0) > 0).map(c => c.id))
      : null;
    bundleSvg.selectAll('.heb-link').attr('stroke-opacity', d =>
      !clusterId ? 0.32 : ((d.a.id === clusterId || d.b.id === clusterId) ? 0.9 : 0.03));
    bundleSvg.selectAll('.heb-node text').attr('opacity', d =>
      !clusterId ? 1 : (d.data.id === clusterId || nbrs.has(d.data.id) ? 1 : 0.22));
    bundleSvg.selectAll('.heb-node circle').attr('opacity', d =>
      !clusterId ? 1 : (d.data.id === clusterId || nbrs.has(d.data.id) ? 1 : 0.25));
  }

  // Single entry point for "a dataset was picked" — routes to the Egonet tree
  // (default) or straight into the Storyline trail (storytelling mode).
  function openSelected(n) {
    if (directStoryline) {
      selectedNode = n;
      highlightSelected();
      // Picking a dataset opens the spine (canvas ~70%, tiles shrink left) and hides Filterix.
      storySetSplit?.('story');
      storyCloseLens?.();
      // Storyline renders INTO the right-hand canvas pane (not a full overlay).
      const canvas = canvasWrap.querySelector('.st-canvas');
      if (!canvas) return;
      openStoryline(canvas, n, {
        KG, nodeById, degree, adjacency,
        // Restore the prompt WITHOUT wiping the canvas — the Filterix overlay is also a
        // child here, so `innerHTML = …` would destroy it and break re-opening Filterix.
        onClose: () => {
          selectedNode = null; highlightSelected();
          storySetSplit?.('browse');   // collapse the canvas → tiles fill again
          canvas.querySelector('.st-trail')?.remove();
          if (!canvas.querySelector('.st-canvas-empty')) canvas.insertAdjacentHTML('afterbegin', canvasPromptHTML());
        },
      });
    } else {
      openEgonet(n, true);
    }
  }

  function setTileFilter(f) { tileFilter = f; renderTiles(); }

  // Mark the tile/row matching the current selection so the source of the open
  // egonet stays visible. Safe to call any time; re-applied after every re-render.
  function highlightSelected() {
    const grid = canvasWrap.querySelector('#sm-tiles-grid');
    if (!grid) return;
    grid.querySelectorAll('[data-node]').forEach(el =>
      el.classList.toggle('is-selected', !!selectedNode && el.dataset.node === selectedNode.id));
  }

  // Resolve the current filter → { nodes, viaByNode, label }
  function tileSet() {
    if (tileFilter.mode === 'cluster') {
      const cl = KG.clusters[tileFilter.id];
      const nodes = KG.leafNodes.filter(n => n.cluster === tileFilter.id);
      return { nodes, viaByNode: null,
        label: `<span class="sm-ctx-dot" style="background:${colorFor(cl.hue)}"></span>${esc(cl.label)} · ${nodes.length} datasets`,
        clearable: true };
    }
    if (tileFilter.mode === 'pair') {
      const a = KG.clusters[tileFilter.a], b = KG.clusters[tileFilter.b];
      const aSet = new Set(KG.leafNodes.filter(n => n.cluster === a.id).map(n => n.id));
      const bSet = new Set(KG.leafNodes.filter(n => n.cluster === b.id).map(n => n.id));
      const viaByNode = {}; const involved = new Set();
      KG.edges.forEach(e => {
        const cross = (aSet.has(e.source) && bSet.has(e.target)) || (bSet.has(e.source) && aSet.has(e.target));
        if (!cross) return;
        [[e.source, e.target], [e.target, e.source]].forEach(([id, other]) => {
          involved.add(id);
          (viaByNode[id] ??= []).push({ via: e.via, other: nodeById[other] });
        });
      });
      const nodes = [...involved].map(id => nodeById[id]).filter(Boolean);
      return { nodes, viaByNode,
        label: `<span class="sm-ctx-dot" style="background:${colorFor(a.hue)}"></span>${esc(a.label)} <span class="sm-ctx-x">↔</span> <span class="sm-ctx-dot" style="background:${colorFor(b.hue)}"></span>${esc(b.label)} · ${nodes.length} datasets connected`,
        clearable: true };
    }
    return { nodes: KG.leafNodes.slice(), viaByNode: null, label: `All datasets · ${KG.leafNodes.length}`, clearable: false };
  }

  function renderTiles() {
    const grid = canvasWrap.querySelector('#sm-tiles-grid');
    const ctx = canvasWrap.querySelector('#sm-tiles-context');
    if (!grid || !ctx) return;
    const q = (canvasWrap.querySelector('#sm-search')?.value || '').toLowerCase().trim();

    const { nodes, viaByNode, label, clearable } = tileSet();
    let list = nodes;
    if (q) list = list.filter(n =>
      n.label?.toLowerCase().includes(q) || n.title?.toLowerCase().includes(q) ||
      n.keywords?.some(k => k.toLowerCase().includes(q)) ||
      n.energies?.some(e => e.toLowerCase().includes(q)) ||
      n.observables?.some(o => o.toLowerCase().includes(q)) ||
      n.authors?.some(a => a.toLowerCase().includes(q)) ||
      n.orgName?.toLowerCase().includes(q));
    // "Linked via" facet — keep datasets participating in ≥1 connection of any selected type (OR)
    if (relFacet.size) list = list.filter(n => {
      const ps = viaProps.get(n.id);
      if (!ps) return false;
      for (const p of relFacet) if (ps.has(p)) return true;
      return false;
    });
    const metric = sortMode === 'external' ? extDeg : degree;
    list = list.slice().sort((a, b) => (metric[b.id] || 0) - (metric[a.id] || 0));

    const facetLabel = relFacet.size
      ? ` <span class="sm-ctx-x">·</span> linked via ${[...relFacet].map(p => PROP_META[p].label).join(' / ')} <span class="sm-ctx-x">·</span> ${list.length} match`
      : '';
    ctx.innerHTML = `<span class="sm-ctx-label">${label}${facetLabel}</span>` +
      (clearable ? `<button class="sm-tiles-clear" id="sm-tiles-clear">clear ×</button>` : '');
    const clearBtn = ctx.querySelector('#sm-tiles-clear');
    if (clearBtn) clearBtn.onclick = () => { matrixHighlightCluster = null; applyLeftHighlight(null); setTileFilter({ mode: 'all' }); };

    const cap = 300;
    const shown = list.slice(0, cap);
    // Dedup + cap a node's provenance edges into ≤3 distinct via-chips (shared by both views)
    const viaChipsFor = (n, len) => {
      const viaInfo = viaByNode?.[n.id];
      if (!viaInfo) return '';
      return [...new Map(viaInfo.map(v => [`${v.via?.prop}:${v.via?.value}`, v.via])).values()].slice(0, 3)
        .map(v => `<span class="sm-tile-via-chip" title="${esc(PROP_META[v?.prop]?.predicate || '')}">${PROP_META[v?.prop]?.glyph || '·'} ${esc(clip(v?.value || '', len))}</span>`).join('');
    };
    const emptyHTML = `<div class="sm-tiles-empty">No datasets match “${esc(q)}”.</div>`;

    if (tileView === 'table') {
      grid.classList.add('as-table');
      // Bar reflects the active sort metric so the ranking is visible, not just sorted.
      const metric = sortMode === 'external' ? extDeg : degree;
      const maxMetric = Math.max(1, d3.max(shown, n => metric[n.id] || 0) || 1);
      const pairMode = !!viaByNode;
      const dash = '<span class="sm-td-empty">—</span>';
      const cell = (v, full) => v ? `<span title="${esc(full ?? v)}">${esc(v)}</span>` : dash;

      // One source of truth for the columns → keeps colgroup, headers, and cells aligned.
      const cols = [
        { key: 'deg', label: sortMode === 'external' ? 'Ext deg' : 'Total deg', w: 120, cls: 'sm-td-deg',
          cell: n => { const mv = metric[n.id] || 0; return `<div class="sm-deg-cell" title="total deg ${degree[n.id] || 0} · external ${extDeg[n.id] || 0}"><span class="sm-deg-num">${mv}</span><span class="sm-deg-bar"><span style="width:${(mv / maxMetric * 100).toFixed(1)}%;background:${colorFor(n.hue)}"></span></span></div>`; } },
        { key: 'title', label: 'Dataset', w: 300, cls: 'sm-td-title',
          cell: n => `<span class="sm-tile-dot" style="background:${colorFor(n.hue)}"></span><span class="sm-td-title-txt" title="${esc(n.title || n.label)}">${esc(n.title || n.label)}</span>` },
        { key: 'cluster', label: 'Cluster', w: 150, cls: 'sm-td-cluster',
          cell: n => cell(KG.clusters[n.cluster].label, `${KG.domains[n.domain].label} › ${KG.clusters[n.cluster].label}`) },
        { key: 'author', label: 'Author', w: 150, cls: '', cell: n => cell(n.authors?.[0], (n.authors || []).join(', ')) },
        { key: 'desc', label: 'Description', w: 320, cls: 'sm-td-desc', cell: n => cell(n.description) },
        ...(pairMode ? [{ key: 'via', label: 'Linked via', w: 180, cls: 'sm-td-via', cell: n => viaChipsFor(n, 16) || dash }] : []),
      ];

      const colgroup = cols.map(c => `<col data-col="${c.key}" style="width:${tableColW[c.key] ?? c.w}px">`).join('');
      const thead = cols.map((c, i) =>
        `<th class="${c.cls}">${esc(c.label)}${i < cols.length - 1 ? `<span class="sm-col-resize" data-col="${c.key}"></span>` : ''}</th>`).join('');
      const tbody = shown.map(n =>
        `<tr class="sm-tr" data-node="${esc(n.id)}">${cols.map(c => `<td class="${c.cls}">${c.cell(n)}</td>`).join('')}</tr>`).join('');

      grid.innerHTML = shown.length
        ? `<table class="sm-table"><colgroup>${colgroup}</colgroup><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`
        : emptyHTML;

      // Excel-like resizing — drag a header's right edge to set that column's width.
      grid.querySelectorAll('.sm-col-resize').forEach(handle => {
        handle.addEventListener('mousedown', ev => {
          ev.preventDefault(); ev.stopPropagation();
          const key = handle.dataset.col;
          const colEl = grid.querySelector(`col[data-col="${key}"]`);
          const startX = ev.clientX, startW = colEl.getBoundingClientRect().width;
          handle.classList.add('dragging');
          document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
          const onMove = e => { const w = Math.max(56, startW + (e.clientX - startX)); colEl.style.width = w + 'px'; tableColW[key] = w; };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            handle.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = '';
          };
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
      });
    } else {
      grid.classList.remove('as-table');
      grid.innerHTML = shown.map(n => {
        const viaChips = viaChipsFor(n, 18);
        const kwChips = (n.keywords || []).slice(0, 3).map(k => `<span class="sm-tile-chip">${PROP_META.keyword.glyph} ${esc(clip(k, 16))}</span>`).join('');
        return `<div class="sm-tile" data-node="${esc(n.id)}" style="border-left-color:${colorFor(n.hue)}">
          <div class="sm-tile-top">
            <span class="sm-tile-dot" style="background:${colorFor(n.hue)}"></span>
            <span class="sm-tile-deg">deg ${degree[n.id] || 0}</span>
          </div>
          <div class="sm-tile-title" title="${esc(n.title || n.label)}">${esc(clip(n.title || n.label, 90))}</div>
          <div class="sm-tile-meta">${esc(KG.domains[n.domain].label)} › ${esc(KG.clusters[n.cluster].label)}</div>
          <div class="sm-tile-chips">
            ${n.authors?.[0] ? `<span class="sm-tile-chip">${PROP_META.author.glyph} ${esc(clip(n.authors[0], 18))}</span>` : ''}
            ${n.orgName ? `<span class="sm-tile-chip">${PROP_META.org.glyph} ${esc(clip(n.orgName, 18))}</span>` : ''}
            ${kwChips}
          </div>
          ${viaChips ? `<div class="sm-tile-via"><span class="sm-tile-via-k">linked via</span>${viaChips}</div>` : ''}
        </div>`;
      }).join('') || emptyHTML;
    }

    if (list.length > cap) {
      const more = document.createElement('div');
      more.className = 'sm-tiles-empty';
      more.textContent = `Showing top ${cap} of ${list.length} — refine the search.`;
      grid.appendChild(more);
    }

    grid.querySelectorAll('[data-node]').forEach(t => t.addEventListener('click', () => {
      const n = nodeById[t.dataset.node]; if (!n) return;
      openSelected(n);
    }));
    highlightSelected();
  }

  // ════════════════════════════════════════════════════════════
  //  VIEW 2 — Egonet: expandable layered tree
  // ════════════════════════════════════════════════════════════
  function openEgonet(center, pushTrail) {
    if (pushTrail) {
      const i = egoTrail.indexOf(center.id);
      if (i >= 0) egoTrail = egoTrail.slice(0, i + 1);
      else egoTrail.push(center.id);
    }
    selectedNode = center;     // single source of truth → keeps the tile/row highlight in sync
    highlightSelected();
    renderEgonet(center);
  }

  const ROOT_CAP = 12, EXPAND_CAP = 8;
  let egoTreeRoot = null;

  function neighboursOf(id) {
    const seen = new Map();
    (adjacency.get(id) || []).forEach(e => { if (!seen.has(e.id)) seen.set(e.id, e); });
    return [...seen.values()].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
  }
  function collectIds(tn, set) { set.add(tn.id); tn.children.forEach(c => collectIds(c, set)); }
  function expandTree(tn, cap) {
    if (tn.expanded) return;
    const visible = new Set(); collectIds(egoTreeRoot, visible);
    const fresh = neighboursOf(tn.id).filter(e => !visible.has(e.id));
    // Pick top-cap by degree, then reorder so same-via children are adjacent.
    tn.children = groupByVia(fresh.slice(0, cap)).map(e => ({
      id: e.id, node: nodeById[e.id], children: [], expanded: false,
      edge: { kind: e.kind, via: e.via, vias: e.vias },
    }));
    tn.expanded = true;
  }
  function collapseTree(tn) { tn.children = []; tn.expanded = false; }
  function availableCount(tn) {
    const visible = new Set(); collectIds(egoTreeRoot, visible);
    return neighboursOf(tn.id).filter(e => !visible.has(e.id)).length;
  }

  // Inner HTML for the detail popover anchored to a node (full dataset record).
  function detailInner(n, isRoot) {
    const doiTxt = d => d.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    return `
      <div class="ego-pop-head">
        <span class="ego-detail-dot" style="background:${colorFor(n.hue)}"></span>
        <span class="ego-detail-kicker">${isRoot ? 'ROOT NODE' : 'DATASET'}</span>
        <span class="ego-detail-deg">deg ${degree[n.id] || 0} · ext ${extDeg[n.id] || 0}</span>
        <button class="ego-pop-close" data-id="${esc(n.id)}" title="Close detail">×</button>
      </div>
      <div class="ego-detail-title" title="${esc(n.title || n.label)}">${esc(n.title || n.label)}</div>
      <div class="ego-detail-meta">${esc(KG.domains[n.domain].label)} › ${esc(KG.clusters[n.cluster].label)}</div>
      ${n.authors?.length ? `<div class="ego-detail-sec"><div class="ego-detail-k">${PROP_META.author.glyph} Authors</div>
        <div class="ego-detail-chips">${n.authors.map(a => `<span class="ego-detail-chip">${esc(a)}</span>`).join('')}</div></div>` : ''}
      ${n.orgName ? `<div class="ego-detail-sec"><div class="ego-detail-k">${PROP_META.org.glyph} Organisation</div>
        <div class="ego-detail-chips"><span class="ego-detail-chip">${esc(n.orgName)}</span></div></div>` : ''}
      ${n.keywords?.length ? `<div class="ego-detail-sec"><div class="ego-detail-k">${PROP_META.keyword.glyph} Keywords</div>
        <div class="ego-detail-chips">${n.keywords.map(k => `<span class="ego-detail-chip">${esc(k)}</span>`).join('')}</div></div>` : ''}
      ${n.energies?.length ? `<div class="ego-detail-sec"><div class="ego-detail-k">√ Energy √s (GeV)</div>
        <div class="ego-detail-chips">${n.energies.map(e => `<span class="ego-detail-chip">${esc(e)}</span>`).join('')}</div></div>` : ''}
      ${n.observables?.length ? `<div class="ego-detail-sec"><div class="ego-detail-k">∂ Observables</div>
        <div class="ego-detail-chips">${n.observables.map(o => `<span class="ego-detail-chip">${esc(o)}</span>`).join('')}</div></div>` : ''}
      ${n.description ? `<div class="ego-detail-sec"><div class="ego-detail-k">Abstract</div>
        <div class="ego-detail-desc">${esc(n.description)}</div></div>` : ''}
      ${n.dois?.length ? `<div class="ego-detail-sec"><div class="ego-detail-k">${PROP_META.doi.glyph} Cited DOIs</div>
        ${n.dois.map(d => `<a class="ego-detail-link" href="${esc(d)}" target="_blank" rel="noopener">${esc(doiTxt(d))} ↗</a>`).join('')}</div>` : ''}
      ${n.uri ? `<a class="ego-detail-open" href="${esc(n.uri)}" target="_blank" rel="noopener">Open dataset ↗</a>` : ''}
      ${!isRoot ? `<button class="ego-detail-recenter" data-id="${esc(n.id)}">Re-centre on this node →</button>` : ''}
    `;
  }

  function renderEgonet(center) {
    const threecol = canvasWrap.querySelector('.sm-three-col');
    const egoCol = threecol?.querySelector('.sm-col-ego');
    if (!egoCol) return;
    egoCol.innerHTML = '';
    egoPane = egoCol;
    threecol.classList.add('ego-open');
    document.getElementById('sm-view-label').textContent = `EGONET · ${center.label.toUpperCase()}`;

    // Close button — collapses the ego col and restores the matrix view
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ego-col-close';
    closeBtn.textContent = '← back';
    closeBtn.onclick = () => {
      threecol.classList.remove('ego-open');
      document.getElementById('sm-view-label').textContent = 'CLUSTER × CLUSTER CONNECTIVITY';
      selectedNode = null; egoTrail = [];
      highlightSelected();
      // Clear ego col content after the CSS transition finishes
      setTimeout(() => { egoCol.innerHTML = ''; egoPane = null; }, 400);
    };
    egoCol.appendChild(closeBtn);

    // Launcher for the separate Storyline Trail — a context-preserving exploration
    // trail that overlays the whole canvas (its own feature, beside the egonet).
    const trailBtn = document.createElement('button');
    trailBtn.className = 'st-launch';
    trailBtn.innerHTML = '⇄ Storyline';
    trailBtn.title = 'Explore this node as a context-preserving storyline trail';
    trailBtn.onclick = () => openStoryline(canvasWrap, center, { KG, nodeById, degree, adjacency });
    egoCol.appendChild(trailBtn);

    egoTreeRoot = { id: center.id, node: center, children: [], expanded: false, edge: null };
    expandTree(egoTreeRoot, ROOT_CAP);

    // Which nodes currently have their detail popover open (all minimised by
    // default — the user maximises a block on demand via its chevron).
    const openDetails = new Set();

    // ── Breadcrumb (#5)
    const bc = document.createElement('div');
    bc.className = 'ego-breadcrumb';
    bc.innerHTML = `<span class="ego-bc-label">TRAIL</span>` + egoTrail.map((id, i) => {
      const nn = nodeById[id]; const cur = id === center.id;
      return `<button class="ego-bc-crumb${cur ? ' current' : ''}" data-id="${esc(id)}" title="${esc(nn?.title || '')}">
        <span class="ego-bc-dot" style="background:${colorFor(nn?.hue || 0)}"></span>${esc(clip(nn?.label || id, 22))}</button>`
        + (i < egoTrail.length - 1 ? `<span class="ego-bc-sep">→</span>` : '');
    }).join('');
    egoCol.appendChild(bc);
    bc.querySelectorAll('.ego-bc-crumb').forEach(b => b.addEventListener('click', () => {
      const n = nodeById[b.dataset.id]; if (!n) return;
      selectedNode = n; openEgonet(n, true);
    }));

    // Compute VW/VH from the full container since the ego col may still be animating
    const { width: CW = 900, height: VH = 640 } = canvasWrap.getBoundingClientRect();
    const VW = Math.max(400, Math.round(CW * 0.56));
    const svg = d3.select(egoCol).append('svg').attr('class', 'graph-svg')
      .attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${VW} ${VH}`);
    const rootG = svg.append('g');
    const edgeLayer = rootG.append('g');
    const nodeLayer = rootG.append('g');
    const zoom = d3.zoom().scaleExtent([0.25, 2.2]).on('zoom', e => rootG.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    const CARD_W = 250, NB_H = 62, ROOT_H = 132, COL = CARD_W + 116, ROW = 80;
    const VIA_R = 11; // via-marker (hexagon) radius
    function edgePath(a, b) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    }
    // Bundled edge: parent → shared junction J → child (the parent→J halves
    // overlap across a group, forming the bundle trunk; the J→child halves fan out).
    function bundlePath(px, py, jx, jy, cx, cy) {
      const m1 = (px + jx) / 2, m2 = (jx + cx) / 2;
      return `M${px},${py} C${m1},${py} ${m1},${jy} ${jx},${jy} C${m2},${jy} ${m2},${cy} ${cx},${cy}`;
    }
    function hexPoints(r) {
      const p = [];
      for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i - Math.PI / 2; p.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`); }
      return p.join(' ');
    }

    // Tooltip shown when hovering an edge's via-marker
    const tip = document.createElement('div');
    tip.className = 'ego-tip'; tip.style.display = 'none';
    egoCol.appendChild(tip);
    const moveTip = ev => { const [x, y] = d3.pointer(ev, egoCol); tip.style.left = (x + 14) + 'px'; tip.style.top = (y + 12) + 'px'; };
    const showTip = (ev, html) => { tip.innerHTML = html; tip.style.display = 'block'; moveTip(ev); };
    const hideTip = () => { tip.style.display = 'none'; };

    let firstDraw = true;
    function draw() {
      edgeLayer.selectAll('*').remove();
      nodeLayer.selectAll('*').remove();

      const hier = d3.hierarchy(egoTreeRoot, d => (d.children && d.children.length ? d.children : null));
      d3.tree().nodeSize([ROW, COL])(hier);
      const descendants = hier.descendants();
      const minX = d3.min(descendants, d => d.x);
      const top = 70, left = 40, positions = {};
      descendants.forEach(d => {
        const isRoot = d.depth === 0;
        positions[d.data.id] = { x: left + d.y, y: top + (d.x - minX), w: CARD_W, h: isRoot ? ROOT_H : NB_H };
      });

      const links = hier.links();

      // Bundle a parent's child-edges that share the same via value (e.g. same
      // author) → one junction + one hover-able marker instead of N duplicates.
      const bundles = new Map();
      links.forEach(l => {
        const v = l.target.data.edge.via;
        const key = l.source.data.id + '|' + viaKey(v);
        let bnd = bundles.get(key);
        if (!bnd) { bnd = { parentId: l.source.data.id, via: v, links: [] }; bundles.set(key, bnd); }
        bnd.links.push(l);
      });

      const eg = edgeLayer.selectAll('g.ego-bundle').data([...bundles.values()])
        .enter().append('g').attr('class', 'ego-bundle');

      eg.each(function (bnd) {
        const g = d3.select(this);
        const a = positions[bnd.parentId];
        const px = a.x + a.w, py = a.y + a.h / 2;
        const childPos = bnd.links.map(l => positions[l.target.data.id]);
        const cx = childPos[0].x;                              // children share x (same depth)
        const jx = px + (cx - px) * 0.48;                      // junction sits in the inter-card gap
        const jy = d3.mean(childPos, c => c.y + c.h / 2);
        const groupColor = KIND_META[bnd.links[0].target.data.edge.kind]?.color || 'var(--ink-2)';

        // Bundled curves: trunk overlaps, fans out to each child
        bnd.links.forEach(l => {
          const b = positions[l.target.data.id];
          g.append('path').attr('fill', 'none')
            .attr('stroke', KIND_META[l.target.data.edge.kind]?.color || groupColor)
            .attr('stroke-width', 1.6).attr('stroke-opacity', 0.72)
            .attr('d', bundlePath(px, py, jx, jy, b.x, b.y + b.h / 2));
        });

        // Marker: hexagon enclosing the property glyph (+ count badge when bundled)
        if (bnd.via) {
          const m = g.append('g').attr('class', 'ego-via-marker')
            .attr('transform', `translate(${jx},${jy})`).style('cursor', 'help');
          m.append('polygon').attr('points', hexPoints(VIA_R))
            .attr('fill', 'var(--bg)').attr('stroke', groupColor).attr('stroke-width', 1.2);
          m.append('text').attr('text-anchor', 'middle').attr('dy', '0.32em')
            .attr('font-size', 10).attr('fill', 'var(--ink)')
            .text(PROP_META[bnd.via.prop]?.glyph || '·');
          if (bnd.links.length > 1) {
            m.append('circle').attr('cx', VIA_R - 1).attr('cy', -(VIA_R - 1)).attr('r', 6).attr('fill', groupColor);
            m.append('text').attr('x', VIA_R - 1).attr('y', -(VIA_R - 1)).attr('dy', '0.32em')
              .attr('text-anchor', 'middle').attr('font-size', 7.5).attr('font-weight', 700).attr('fill', '#fff')
              .text(bnd.links.length);
          }
          const label = `<b>${esc(PROP_META[bnd.via.prop]?.label || bnd.via.prop)}</b> · ${esc(bnd.via.value)}`
            + (bnd.links.length > 1 ? `<br><span style="opacity:0.65">${bnd.links.length} datasets share this</span>` : '');
          m.on('mouseenter', ev => showTip(ev, label)).on('mousemove', moveTip).on('mouseleave', hideTip);
        }
      });

      descendants.forEach(d => {
        const tn = d.data, n = tn.node, p = positions[tn.id], isRoot = d.depth === 0;
        const avail = availableCount(tn);
        const badge = tn.expanded ? '−' : (avail > 0 ? `+${avail}` : '');
        const g = nodeLayer.append('g').attr('class', 'ego-node').attr('transform', `translate(${p.x},${p.y})`);
        const fo = g.append('foreignObject').attr('width', p.w).attr('height', p.h);
        const isOpen = openDetails.has(tn.id);
        const chevron = `<button class="ego-pop-toggle${isOpen ? ' open' : ''}" data-detail="${esc(tn.id)}" title="${isOpen ? 'Hide detail' : 'Show detail'}">${isOpen ? '▴' : '▾'}</button>`;
        const html = isRoot ? `
          <div class="ego-root-card" style="border-color:${colorFor(n.hue, 0.55, 0.15)}">
            <div class="ego-card-head">
              <span class="ego-card-dot" style="background:${colorFor(n.hue)}"></span>
              <span class="ego-card-deg">deg ${degree[n.id] || 0}</span>
              ${badge ? `<span class="ego-exp-badge">${badge}</span>` : ''}
              ${chevron}
            </div>
            <div class="ego-root-title" title="${esc(n.title || n.label)}">${esc(clip(n.title || n.label, 64))}</div>
            <div class="ego-card-sub">${esc(KG.domains[n.domain].label)} › ${esc(KG.clusters[n.cluster].label)}</div>
            <div class="ego-card-props">
              ${n.authors?.length ? `<div class="ego-prop-line"><span class="ego-gly">${PROP_META.author.glyph}</span>${esc(clip(n.authors.join(', '), 38))}</div>` : ''}
              ${n.orgName ? `<div class="ego-prop-line"><span class="ego-gly">${PROP_META.org.glyph}</span>${esc(clip(n.orgName, 38))}</div>` : ''}
              ${n.keywords?.length ? `<div class="ego-prop-line"><span class="ego-gly">${PROP_META.keyword.glyph}</span>${esc(clip(n.keywords.join(', '), 38))}</div>` : ''}
            </div>
          </div>` : `
          <div class="ego-nb-card ${tn.expanded ? 'is-expanded' : ''}" style="border-left-color:${KIND_META[tn.edge.kind].color}">
            <div class="ego-nb-top">
              <span class="ego-card-dot" style="background:${colorFor(n.hue)}"></span>
              <span class="ego-nb-title" title="${esc(n.title || n.label)}">${esc(clip(n.label, 28))}</span>
              ${badge ? `<span class="ego-exp-badge">${badge}</span>` : ''}
              <span class="ego-nb-deg">${degree[n.id] || 0}</span>
              ${chevron}
            </div>
            <div class="ego-nb-vias">${(tn.edge.vias || []).slice(0, 3).map(v =>
              `<span class="ego-via-chip" title="${esc(PROP_META[v.prop]?.predicate || '')}">${PROP_META[v.prop]?.glyph || '·'} ${esc(clip(v.value, 15))}</span>`).join('')}</div>
          </div>`;
        const inner = fo.append('xhtml:div').attr('class', 'ego-card-inner').html(html);

        // Chevron toggles the detail popover for this node (without expanding it).
        const chevEl = inner.node().querySelector('.ego-pop-toggle');
        if (chevEl) chevEl.addEventListener('click', ev => {
          ev.stopPropagation();
          openDetails.has(tn.id) ? openDetails.delete(tn.id) : openDetails.add(tn.id);
          draw();
        });

        let clickTimer = null;
        g.style('cursor', 'pointer')
          .on('click', ev => {
            ev.stopPropagation();
            selectedNode = n;
            if (clickTimer) return;
            clickTimer = setTimeout(() => {
              clickTimer = null;
              if (tn.expanded) collapseTree(tn); else expandTree(tn, isRoot ? ROOT_CAP : EXPAND_CAP);
              draw();
            }, 220);
          })
          .on('dblclick', ev => {
            ev.stopPropagation();
            if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
            selectedNode = n; openEgonet(n, true);
          });
      });

      // ── Detail popovers — anchored below their node, drawn in graph space so
      //    they pan/zoom with the tree. No layout reflow; multiple can be open.
      descendants.forEach(d => {
        if (!openDetails.has(d.data.id)) return;
        const n = d.data.node, p = positions[d.data.id], isRoot = d.depth === 0;
        const POP_W = 270;
        const pfo = nodeLayer.append('foreignObject')
          .attr('x', p.x).attr('y', p.y + p.h + 8)
          .attr('width', POP_W).attr('height', 460)
          .style('overflow', 'visible').style('pointer-events', 'none');
        const pdiv = pfo.append('xhtml:div').attr('class', 'ego-pop').style('pointer-events', 'auto');
        pdiv.html(detailInner(n, isRoot));
        const el = pdiv.node();
        el.querySelector('.ego-pop-close')?.addEventListener('click', ev => {
          ev.stopPropagation(); openDetails.delete(n.id); draw();
        });
        const rc = el.querySelector('.ego-detail-recenter');
        if (rc) rc.addEventListener('click', ev => {
          ev.stopPropagation(); const t = nodeById[rc.dataset.id];
          if (t) { selectedNode = t; openEgonet(t, true); }
        });
      });
      nodeLayer.raise();

      if (firstDraw) {
        firstDraw = false;
        const xs = descendants.map(d => positions[d.data.id]);
        const cW = d3.max(xs, p => p.x + p.w) + 40;
        const cH = d3.max(xs, p => p.y + p.h) + 40;
        const k = Math.max(0.45, Math.min((VW - 60) / cW, 1));
        const tx = Math.max(20, (VW - cW * k) / 2);
        const ty = cH * k <= VH - 80 ? (VH - cH * k) / 2 : 64;
        svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      }
    }
    draw();   // root's detail popover opens by default (seeded in openDetails)

    // ── Legend (#3)
    const legend = document.createElement('div');
    legend.className = 'ego-legend';
    legend.innerHTML = `
      <div class="sm-stat-head">EDGE COLOUR = TOPOLOGY</div>
      ${Object.values(KIND_META).map(m =>
        `<div class="ego-leg-row"><span class="ego-leg-sw" style="background:${m.color}"></span>${m.label} <span class="ego-leg-desc">${m.desc}</span></div>`).join('')}
      <div class="sm-stat-head" style="margin-top:8px;">EDGE MARKER ⬡ = SHARED PROPERTY</div>
      ${LINK_PROPS.map(([, m]) =>
        `<div class="ego-leg-row"><span class="ego-leg-gly">${m.glyph}</span>${m.label}</div>`).join('')}
      <div style="margin-top:6px;font-size:9px;color:var(--ink-3);">hover a ⬡ marker for the value · a badge counts datasets sharing it · click card → expand / collapse · dbl-click → re-centre · scroll to zoom</div>`;
    egoCol.appendChild(legend);
  }

  // ── Resize: matrix re-fits; egonet scales via its viewBox
  let rtimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(rtimer);
    rtimer = setTimeout(() => {
      if (currentView === 'matrix') {
        const host = canvasWrap.querySelector('.sm-matrix-scroll');
        // offsetParent is null while the lens overlay is hidden — skip those.
        if (host && host.offsetParent) drawActiveLeft(host);
      }
    }, 200);
  });
  ro.observe(canvasWrap);

  if (directStoryline) renderStoryLayout();
  else renderMatrix();
}
