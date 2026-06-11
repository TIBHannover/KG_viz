// Sensemaking Explorer — two coordinated views over the NFDI4Energy dataset catalog:
//   1. Adjacency Matrix (split: matrix ½ · dataset TILES ½)
//        · tiles default to all datasets (ranked); clicking a matrix cell filters them
//        · each tile carries its own detail (title, domain·cluster, author, org, keywords)
//   2. Egonet Explorer (expandable layered tree) — click a tile to open it here
//
// Edges carry their provenance:  e.via = { prop, value }  ·  e.vias = [{prop,value}…]

import * as d3 from 'd3';
import { EnergyKG } from './data.js';

function colorFor(hue, l = 0.72, c = 0.13) { return `oklch(${l} ${c} ${hue})`; }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));

const PROP_META = {
  author:  { label: 'Author',       glyph: '✎', predicate: 'dct:creator → pro:Author' },
  doi:     { label: 'Cited DOI',    glyph: '◈', predicate: 'datacite:isDescribedBy' },
  contact: { label: 'Contact',      glyph: '✉', predicate: 'vcard:fn' },
  org:     { label: 'Organisation', glyph: '⌂', predicate: 'dct:publisher → vcard:Organization' },
  keyword: { label: 'Keyword',      glyph: '#', predicate: 'dcat:keyword' },
};
const KIND_META = {
  intra:   { label: 'Intra-cluster',  desc: 'same cluster',     color: 'var(--teal)',          hex: '#3fc8c0' },
  sibling: { label: 'Sibling',        desc: 'same domain',      color: 'var(--amber)',         hex: '#e7a23c' },
  cross:   { label: 'Cross-domain',   desc: 'different domain', color: 'oklch(0.72 0.13 320)', hex: '#c879d6' },
};

export function renderSensemaking(container) {
  container.innerHTML = '';
  const KG = EnergyKG;

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

  // ── Clusters ordered by domain then size
  const domainOrder = KG.TAXONOMY.map(d => d.id);
  const clusterList = Object.values(KG.clusters)
    .filter(c => c.leafCount > 0)
    .sort((a, b) => {
      const di = domainOrder.indexOf(a.domain), dj = domainOrder.indexOf(b.domain);
      return di !== dj ? di - dj : b.leafCount - a.leafCount;
    });

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
  toolbar.innerHTML = `
    <button class="sm-view-btn active" data-view="matrix">Adjacency Matrix</button>
    <button class="sm-view-btn" data-view="egonet">Egonet Explorer</button>
    <span class="crumb-sep">·</span>
    <span id="sm-view-label" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-3);letter-spacing:0.14em;">CLUSTER × CLUSTER CONNECTIVITY</span>
  `;
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
  let matrixHighlightCluster = null;
  let matrixMode = 'matrix';              // 'matrix' | 'chord' | 'bundle'
  let chordSvg = null, chordClusters = [];
  let bundleSvg = null, bundleLeaves = {};
  let tileFilter = { mode: 'all' };       // {mode:'all'} | {mode:'cluster',id} | {mode:'pair',a,b}
  let egoTrail = [];

  toolbar.querySelectorAll('.sm-view-btn').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view)));

  function switchView(v) {
    currentView = v;
    toolbar.querySelectorAll('.sm-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    if (v === 'matrix') { document.getElementById('sm-view-label').textContent = 'CLUSTER × CLUSTER CONNECTIVITY'; renderMatrix(); }
    else { selectedNode ? openEgonet(selectedNode, true) : renderEgonetPlaceholder(); }
  }

  // ════════════════════════════════════════════════════════════
  //  VIEW 1 — Adjacency matrix (left) · dataset tiles (right)
  // ════════════════════════════════════════════════════════════
  function kindLegendHTML() {
    return `<div class="sm-kind-legend">
      ${Object.entries(KIND_META).map(([k, m]) =>
        `<span class="sm-kind-item"><span class="sm-kind-sw" style="background:${m.color}"></span>${m.label}<span class="sm-kind-desc">(${m.desc})</span></span>`).join('')}
    </div>`;
  }

  function renderMatrix() {
    canvasWrap.innerHTML = '';
    const split = document.createElement('div');
    split.className = 'sm-split';
    split.innerHTML = `
      <div class="sm-matrix-pane">
        <div class="sm-matrix-toolbar">
          <div class="sm-mode-toggle">
            <button data-mode="matrix" class="${matrixMode === 'matrix' ? 'active' : ''}">▦ Matrix</button>
            <button data-mode="chord" class="${matrixMode === 'chord' ? 'active' : ''}">◍ Chord</button>
            <button data-mode="bundle" class="${matrixMode === 'bundle' ? 'active' : ''}">❀ Bundle</button>
          </div>
        </div>
        ${kindLegendHTML()}
        <div class="sm-matrix-scroll"></div>
      </div>
      <div class="sm-tiles-pane">
        <div class="sm-tiles-head">
          <div class="sm-tiles-row">
            <input id="sm-search" autocomplete="off" placeholder="Search datasets — title · keyword · author…">
            <button class="sm-sort-btn active" data-sort="degree">Total deg</button>
            <button class="sm-sort-btn" data-sort="external">External</button>
          </div>
          <div class="sm-tiles-context" id="sm-tiles-context"></div>
        </div>
        <div class="sm-tiles-grid" id="sm-tiles-grid"></div>
      </div>`;
    canvasWrap.appendChild(split);

    const scroll = split.querySelector('.sm-matrix-scroll');
    drawActiveLeft(scroll);

    split.querySelectorAll('.sm-mode-toggle button').forEach(b => b.addEventListener('click', () => {
      matrixMode = b.dataset.mode;
      split.querySelectorAll('.sm-mode-toggle button').forEach(x => x.classList.toggle('active', x.dataset.mode === matrixMode));
      drawActiveLeft(scroll);
    }));

    const search = split.querySelector('#sm-search');
    search.addEventListener('input', () => renderTiles());
    split.querySelectorAll('.sm-sort-btn').forEach(b => b.addEventListener('click', () => {
      sortMode = b.dataset.sort;
      split.querySelectorAll('.sm-sort-btn').forEach(x => x.classList.toggle('active', x.dataset.sort === sortMode));
      renderTiles();
    }));

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
    else applyMatrixHighlight(id);
  }

  function drawMatrix(host) {
    host.innerHTML = '';
    const { width: PW = 540, height: PH = 600 } = host.getBoundingClientRect();
    const n = clusterList.length;
    const ml = 150, mt = 124, mr = 16, mb = 12;
    const fit = Math.min((PW - ml - mr) / n, (PH - mt - mb) / n);
    const cellSize = Math.max(15, Math.min(34, fit));
    const W = ml + n * cellSize + mr, H = mt + n * cellSize + mb;

    matrixSvg = d3.select(host).append('svg').attr('width', W).attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`).style('display', 'block');

    const maxW = Math.max(1, d3.max(clusterList.flatMap(a => clusterList.map(b => matrixData[a.id]?.[b.id] || 0))));
    const colorScale = v => `oklch(${0.24 + (v / maxW) * 0.5} ${0.02 + (v / maxW) * 0.18} 65)`;
    const g = matrixSvg.append('g').attr('transform', `translate(${ml},${mt})`);

    const breaks = []; let last = null;
    clusterList.forEach((c, i) => { if (c.domain !== last) { breaks.push({ domain: c.domain, start: i }); last = c.domain; } });
    breaks.forEach((dk, di) => {
      const next = di + 1 < breaks.length ? breaks[di + 1].start : n;
      const span = (next - dk.start) * cellSize, x0 = dk.start * cellSize;
      const dh = KG.domains[dk.domain].hue, col = colorFor(dh, 0.35, 0.07);
      g.append('rect').attr('x', x0).attr('y', -10).attr('width', span).attr('height', 6).attr('fill', col).attr('rx', 2);
      g.append('rect').attr('x', -10).attr('y', x0).attr('width', 6).attr('height', span).attr('fill', col).attr('rx', 2);
      g.append('text').attr('x', x0 + span / 2).attr('y', -mt + 18).attr('text-anchor', 'middle')
        .attr('font-family', "'JetBrains Mono',monospace").attr('font-size', 8).attr('letter-spacing', '0.08em')
        .attr('fill', colorFor(dh, 0.65, 0.1)).text(clip(KG.domains[dk.domain].label, 16).toUpperCase());
    });

    const cells = [];
    clusterList.forEach((rowC, ri) => clusterList.forEach((colC, ci) =>
      cells.push({ rowC, colC, ri, ci, w: matrixData[rowC.id]?.[colC.id] || 0, diag: rowC.id === colC.id })));
    const cellG = g.selectAll('g.sm-cell').data(cells).enter().append('g')
      .attr('class', 'sm-cell').attr('transform', d => `translate(${d.ci * cellSize},${d.ri * cellSize})`);
    cellG.append('rect').attr('width', cellSize - 1).attr('height', cellSize - 1).attr('rx', 1)
      .attr('fill', d => d.diag ? colorFor(d.rowC.hue, 0.30, 0.09) : (d.w > 0 ? colorScale(d.w) : 'var(--bg-3)'))
      .attr('stroke', 'var(--bg-2)').attr('stroke-width', 0.5)
      .style('cursor', d => (d.w > 0 || d.diag) ? 'pointer' : 'default');
    if (cellSize >= 17) {
      cellG.filter(d => d.diag).append('text').attr('x', cellSize / 2).attr('y', cellSize / 2).attr('dy', '0.32em')
        .attr('text-anchor', 'middle').attr('font-family', "'JetBrains Mono',monospace")
        .attr('font-size', Math.max(8, cellSize * 0.4)).attr('fill', d => colorFor(d.rowC.hue, 0.78, 0.12))
        .attr('pointer-events', 'none').text(d => d.rowC.leafCount);
      cellG.filter(d => !d.diag && d.w >= 3).append('text').attr('x', cellSize / 2).attr('y', cellSize / 2).attr('dy', '0.32em')
        .attr('text-anchor', 'middle').attr('font-family', "'JetBrains Mono',monospace")
        .attr('font-size', Math.max(7, cellSize * 0.32)).attr('fill', 'oklch(0.12 0.01 65)')
        .attr('pointer-events', 'none').text(d => d.w);
    }
    cellG.on('click', (ev, d) => {
      if (d.diag) { matrixHighlightCluster = d.rowC.id; applyMatrixHighlight(d.rowC.id); setTileFilter({ mode: 'cluster', id: d.rowC.id }); }
      else if (d.w > 0) { matrixHighlightCluster = null; applyMatrixHighlight(null); setTileFilter({ mode: 'pair', a: d.rowC.id, b: d.colC.id }); }
    });

    g.selectAll('text.sm-row-lbl').data(clusterList).enter().append('text').attr('class', 'sm-row-lbl')
      .attr('x', -14).attr('y', (d, i) => i * cellSize + cellSize / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
      .attr('font-size', Math.max(8, Math.min(cellSize * 0.5, 11))).attr('fill', d => colorFor(d.hue, 0.68, 0.1))
      .style('cursor', 'pointer').text(d => clip(d.label, 22))
      .on('click', (ev, d) => { matrixHighlightCluster = d.id; applyMatrixHighlight(d.id); setTileFilter({ mode: 'cluster', id: d.id }); });
    g.selectAll('text.sm-col-lbl').data(clusterList).enter().append('text').attr('class', 'sm-col-lbl')
      .attr('transform', (d, i) => `translate(${i * cellSize + cellSize / 2},-14) rotate(-50)`).attr('text-anchor', 'start')
      .attr('font-size', Math.max(8, Math.min(cellSize * 0.5, 11))).attr('fill', d => colorFor(d.hue, 0.68, 0.1))
      .text(d => clip(d.label, 20));

    if (matrixHighlightCluster) applyMatrixHighlight(matrixHighlightCluster);
  }

  function applyMatrixHighlight(clusterId) {
    if (!matrixSvg) return;
    matrixSvg.selectAll('g.sm-cell').select('rect').attr('opacity', function () {
      const d = d3.select(this.parentNode).datum();
      if (!d || !clusterId) return 1;
      return (d.rowC.id === clusterId || d.colC.id === clusterId) ? 1 : 0.18;
    });
  }

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
        matrixHighlightCluster = null; applyChordHighlight(null); setTileFilter({ mode: 'pair', a: a.id, b: b.id });
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
      .attr('fill', d => colorFor(chordClusters[d.index].hue, 0.72, 0.1))
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
      .on('click', (ev, d) => { matrixHighlightCluster = null; applyBundleHighlight(null); setTileFilter({ mode: 'pair', a: d.a.id, b: d.b.id }); });

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
      .attr('fill', d => colorFor(d.data.hue, 0.72, 0.1))
      .style('cursor', 'pointer')
      .text(d => clip(d.data.label, 22))
      .on('mouseover', (ev, d) => {
        applyBundleHighlight(d.data.id);
        const c = d.data, conn = clusterList.reduce((s, o) => s + (matrixData[c.id]?.[o.id] || 0), 0);
        tip.html(`<b style="color:${colorFor(c.hue)}">${esc(c.label)}</b>
          <div style="color:var(--ink-3);font-size:10px;margin-top:3px;">${esc(KG.domains[c.domain].label)} · ${c.leafCount} datasets · ${conn} connections</div>`).style('opacity', 1);
      })
      .on('mousemove', ev => tip.style('left', (ev.offsetX + 14) + 'px').style('top', (ev.offsetY - 10) + 'px'))
      .on('mouseout', () => { tip.style('opacity', 0); applyBundleHighlight(matrixHighlightCluster); })
      .on('click', (ev, d) => { matrixHighlightCluster = d.data.id; applyBundleHighlight(d.data.id); setTileFilter({ mode: 'cluster', id: d.data.id }); });

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

  function setTileFilter(f) { tileFilter = f; renderTiles(); }

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
      n.authors?.some(a => a.toLowerCase().includes(q)) ||
      n.orgName?.toLowerCase().includes(q));
    const metric = sortMode === 'external' ? extDeg : degree;
    list = list.slice().sort((a, b) => (metric[b.id] || 0) - (metric[a.id] || 0));

    ctx.innerHTML = `<span class="sm-ctx-label">${label}</span>` +
      (clearable ? `<button class="sm-tiles-clear" id="sm-tiles-clear">clear ×</button>` : '');
    const clearBtn = ctx.querySelector('#sm-tiles-clear');
    if (clearBtn) clearBtn.onclick = () => { matrixHighlightCluster = null; applyLeftHighlight(null); setTileFilter({ mode: 'all' }); };

    const cap = 300;
    grid.innerHTML = list.slice(0, cap).map(n => {
      const viaInfo = viaByNode?.[n.id];
      const viaChips = viaInfo
        ? [...new Map(viaInfo.map(v => [`${v.via?.prop}:${v.via?.value}`, v.via])).values()].slice(0, 3)
            .map(v => `<span class="sm-tile-via-chip" title="${esc(PROP_META[v?.prop]?.predicate || '')}">${PROP_META[v?.prop]?.glyph || '·'} ${esc(clip(v?.value || '', 18))}</span>`).join('')
        : '';
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
    }).join('') || `<div class="sm-tiles-empty">No datasets match “${esc(q)}”.</div>`;

    if (list.length > cap) {
      const more = document.createElement('div');
      more.className = 'sm-tiles-empty';
      more.textContent = `Showing top ${cap} of ${list.length} — refine the search.`;
      grid.appendChild(more);
    }

    grid.querySelectorAll('.sm-tile').forEach(t => t.addEventListener('click', () => {
      const n = nodeById[t.dataset.node]; if (!n) return;
      selectedNode = n; openEgonet(n, true); switchView('egonet');
    }));
  }

  // ════════════════════════════════════════════════════════════
  //  VIEW 2 — Egonet: expandable layered tree
  // ════════════════════════════════════════════════════════════
  function renderEgonetPlaceholder() {
    canvasWrap.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;
                  color:var(--ink-3);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.14em;">
        <div>OPEN A DATASET TILE FROM THE ADJACENCY MATRIX TAB</div>
        <div style="font-size:10px;opacity:0.55;">click a tile → its egonet opens here · click cards to expand · edges are labeled by the linking property</div>
      </div>`;
  }

  function openEgonet(center, pushTrail) {
    if (pushTrail) {
      const i = egoTrail.indexOf(center.id);
      if (i >= 0) egoTrail = egoTrail.slice(0, i + 1);
      else egoTrail.push(center.id);
    }
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
    tn.children = fresh.slice(0, cap).map(e => ({
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

  function renderEgonet(center) {
    canvasWrap.innerHTML = '';
    document.getElementById('sm-view-label').textContent = `EGONET · ${center.label.toUpperCase()}`;

    egoTreeRoot = { id: center.id, node: center, children: [], expanded: false, edge: null };
    expandTree(egoTreeRoot, ROOT_CAP);

    // ── Breadcrumb (#5)
    const bc = document.createElement('div');
    bc.className = 'ego-breadcrumb';
    bc.innerHTML = `<span class="ego-bc-label">TRAIL</span>` + egoTrail.map((id, i) => {
      const nn = nodeById[id]; const cur = id === center.id;
      return `<button class="ego-bc-crumb${cur ? ' current' : ''}" data-id="${esc(id)}" title="${esc(nn?.title || '')}">
        <span class="ego-bc-dot" style="background:${colorFor(nn?.hue || 0)}"></span>${esc(clip(nn?.label || id, 22))}</button>`
        + (i < egoTrail.length - 1 ? `<span class="ego-bc-sep">→</span>` : '');
    }).join('');
    canvasWrap.appendChild(bc);
    bc.querySelectorAll('.ego-bc-crumb').forEach(b => b.addEventListener('click', () => {
      const n = nodeById[b.dataset.id]; if (!n) return;
      selectedNode = n; openEgonet(n, true);
    }));

    const { width: VW = 900, height: VH = 640 } = canvasWrap.getBoundingClientRect();
    const svg = d3.select(canvasWrap).append('svg').attr('class', 'graph-svg')
      .attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${VW} ${VH}`);
    const rootG = svg.append('g');
    const edgeLayer = rootG.append('g');
    const nodeLayer = rootG.append('g');
    const zoom = d3.zoom().scaleExtent([0.25, 2.2]).on('zoom', e => rootG.attr('transform', e.transform));
    svg.call(zoom).on('dblclick.zoom', null);

    const CARD_W = 250, NB_H = 62, ROOT_H = 132, COL = CARD_W + 116, ROW = 80;
    function edgePath(a, b) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
      return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    }

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
      const eg = edgeLayer.selectAll('g.ego-edge').data(links).enter().append('g').attr('class', 'ego-edge');
      eg.append('path').attr('fill', 'none')
        .attr('stroke', l => KIND_META[l.target.data.edge.kind]?.color || 'var(--ink-2)')
        .attr('stroke-width', 1.6).attr('stroke-opacity', 0.72)
        .attr('d', l => edgePath(positions[l.source.data.id], positions[l.target.data.id]));
      const el = eg.append('g');
      el.append('rect').attr('rx', 3).attr('height', 15).attr('fill', 'var(--bg-2)')
        .attr('stroke', l => KIND_META[l.target.data.edge.kind]?.color || 'var(--ink-2)')
        .attr('stroke-opacity', 0.5).attr('stroke-width', 0.6);
      el.append('text').attr('font-family', "'JetBrains Mono',monospace").attr('font-size', 8.5)
        .attr('fill', 'var(--ink-2)').attr('dy', '0.32em')
        .text(l => { const v = l.target.data.edge.via; return v ? `${PROP_META[v.prop]?.glyph || '·'} ${clip(v.value, 18)}` : ''; });
      el.each(function (l) {
        const a = positions[l.source.data.id], b = positions[l.target.data.id];
        const x = (a.x + a.w + b.x) / 2, yy = ((a.y + a.h / 2) + (b.y + b.h / 2)) / 2;
        const t = d3.select(this).select('text'); const w = (t.text().length * 5.1) + 10;
        d3.select(this).select('rect').attr('x', x - w / 2).attr('y', yy - 7.5).attr('width', w);
        t.attr('x', x).attr('y', yy).attr('text-anchor', 'middle');
      });

      descendants.forEach(d => {
        const tn = d.data, n = tn.node, p = positions[tn.id], isRoot = d.depth === 0;
        const avail = availableCount(tn);
        const badge = tn.expanded ? '−' : (avail > 0 ? `+${avail}` : '');
        const g = nodeLayer.append('g').attr('class', 'ego-node').attr('transform', `translate(${p.x},${p.y})`);
        const fo = g.append('foreignObject').attr('width', p.w).attr('height', p.h);
        const html = isRoot ? `
          <div class="ego-root-card" style="border-color:${colorFor(n.hue, 0.7, 0.12)}">
            <div class="ego-card-head">
              <span class="ego-card-dot" style="background:${colorFor(n.hue)}"></span>
              <span class="ego-card-deg">deg ${degree[n.id] || 0}</span>
              ${badge ? `<span class="ego-exp-badge">${badge}</span>` : ''}
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
            </div>
            <div class="ego-nb-vias">${(tn.edge.vias || []).slice(0, 3).map(v =>
              `<span class="ego-via-chip" title="${esc(PROP_META[v.prop]?.predicate || '')}">${PROP_META[v.prop]?.glyph || '·'} ${esc(clip(v.value, 15))}</span>`).join('')}</div>
          </div>`;
        fo.append('xhtml:div').attr('class', 'ego-card-inner').html(html);

        let clickTimer = null;
        g.style('cursor', 'pointer')
          .on('click', ev => {
            ev.stopPropagation();
            if (clickTimer) return;
            clickTimer = setTimeout(() => {
              clickTimer = null;
              selectedNode = n;
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
    draw();

    // ── Legend (#3)
    const legend = document.createElement('div');
    legend.className = 'ego-legend';
    legend.innerHTML = `
      <div class="sm-stat-head">EDGE COLOUR = TOPOLOGY</div>
      ${Object.values(KIND_META).map(m =>
        `<div class="ego-leg-row"><span class="ego-leg-sw" style="background:${m.color}"></span>${m.label} <span class="ego-leg-desc">${m.desc}</span></div>`).join('')}
      <div class="sm-stat-head" style="margin-top:8px;">EDGE LABEL = SHARED PROPERTY</div>
      ${Object.values(PROP_META).map(m =>
        `<div class="ego-leg-row"><span class="ego-leg-gly">${m.glyph}</span>${m.label}</div>`).join('')}
      <div style="margin-top:6px;font-size:9px;color:var(--ink-3);">click card → expand / collapse · dbl-click → re-centre · scroll to zoom</div>`;
    canvasWrap.appendChild(legend);
  }

  // ── Resize: matrix re-fits; egonet scales via its viewBox
  let rtimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(rtimer);
    rtimer = setTimeout(() => {
      if (currentView === 'matrix') {
        const host = canvasWrap.querySelector('.sm-matrix-scroll');
        if (host) drawActiveLeft(host);
      }
    }, 200);
  });
  ro.observe(canvasWrap);

  renderMatrix();
}
