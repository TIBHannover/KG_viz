// Storyline — single-dataset flow. Launched either from the Sensemaking
// egonet's "⇄ Storyline" button, or directly on dataset selection in the
// Storytelling view (src/storytelling.js).
//
//   TOPIC  →  DATASET (the tile, reused as-is)  →  CONNECTORS  →  AVAILABLE CONNECTIONS
//
// CONNECTORS are split into two stacked bands — AUTHORS (top) and KEYWORDS
// (bottom) — to keep the width balanced. Each connector (a shared author or
// keyword) owns a small scrollable table of the datasets reachable through it
// (≤3 visible, scroll for the rest). Clicking a dataset title opens a NEW
// storyline seeded by it, tracked in the breadcrumb at the top.
//
// No "inference" framing — every connector is a stated shared property.

import { colorFor, esc, clip } from './helpers.js';

const GLYPH = { author: '✎', keyword: '#', org: '⌂', doi: '◈', energy: '√', observable: '∂' };
const MEMBER_CAP = 60;   // tiles shown per connector before "showing top N"

export function openStoryline(host, seed, ctx) {
  const { KG, nodeById, degree, adjacency } = ctx;

  host.__stRO?.disconnect();
  host.querySelector('.st-trail')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'st-trail';
  overlay.innerHTML = `
    <div class="st-trail-head">
      <span class="st-trail-title">STORYLINE</span>
      <span class="st-layout-toggle">
        <button data-layout="grid" title="Coordinate grid">⌗ Grid</button>
        <button data-layout="spine" title="Story spine (node-link)">⑂ Spine</button>
      </span>
      <span class="st-trail-hint">click a dataset title to drill in · breadcrumb to go back</span>
      <button class="st-trail-close" title="Close storyline">✕ close</button>
    </div>
    <div class="st-bc"></div>
    <div class="st-flowwrap"><div class="st-flow"></div></div>`;
  host.appendChild(overlay);
  const bc = overlay.querySelector('.st-bc');
  const flow = overlay.querySelector('.st-flow');
  const flowwrap = overlay.querySelector('.st-flowwrap');
  // Re-centre the spine when the canvas resizes (e.g. the split-layout transition).
  let roTimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(roTimer);
    roTimer = setTimeout(() => { if (layout === 'spine' && overlay.isConnected) renderSpine(); }, 90);
  });
  ro.observe(host);
  host.__stRO = ro;
  overlay.querySelector('.st-trail-close').onclick = () => { ro.disconnect(); host.__stRO = null; overlay.remove(); ctx.onClose?.(); };

  let trail = [seed];
  let layout = 'grid';   // 'grid' (coordinate rows) | 'spine' (node-link story spine)
  let selected = null;   // { prop, value } of the picked connector, or null
  const expandedTiles = new Set();   // connected-dataset ids whose tile is expanded to its record
  const expandedBands = new Set();   // connector props whose band is expanded past the cap
  const BAND_CAP = 10;               // connector chips shown per band before "＋N more"

  // Global indexes: each connector property → datasets that carry each value
  // (built once per launch). energy = cmenergies (√s) · observable = measured quantity.
  let idx = host.__stIndex;
  if (!idx || !idx.energyIndex) {
    const authorIndex = new Map(), keywordIndex = new Map(), energyIndex = new Map(), observableIndex = new Map();
    const push = (map, k, id) => { let a = map.get(k); if (!a) map.set(k, a = []); a.push(id); };
    KG.leafNodes.forEach(n => {
      (n.authors || []).forEach(a => push(authorIndex, a, n.id));
      (n.keywords || []).forEach(k => push(keywordIndex, k, n.id));
      (n.energies || []).forEach(e => push(energyIndex, e, n.id));
      (n.observables || []).forEach(o => push(observableIndex, o, n.id));
    });
    idx = host.__stIndex = { authorIndex, keywordIndex, energyIndex, observableIndex };
  }

  // Connectors = the dataset's OWN properties (ALL of them, from its metadata —
  // not just the ones that happen to form graph edges). Each connector's members =
  // the other datasets that also carry that author / keyword / energy / observable.
  function connectorsOf(focal) {
    const mk = (values, map) => (values || []).map(value => {
      const members = (map.get(value) || [])
        .filter(id => id !== focal.id)
        .map(id => nodeById[id]).filter(Boolean)
        .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
      return { value, members };
    });
    return {
      authors:     mk(focal.authors,     idx.authorIndex),
      keywords:    mk(focal.keywords,    idx.keywordIndex),
      energies:    mk(focal.energies,    idx.energyIndex),
      observables: mk(focal.observables, idx.observableIndex),
    };
  }

  // Expanded detail — ONLY what's not already shown elsewhere in the interface. The tile
  // chips carry author / organisation / keywords, and the connector bands carry keywords /
  // energy / observables, so this reveals just the abstract, cited DOIs and the link.
  function detailHTML(n) {
    const doiTxt = d => d.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    const sec = (k, body) => `<div class="st-det-sec"><div class="st-det-k">${k}</div>${body}</div>`;
    const body = `
      ${n.description ? sec('Abstract', `<div class="st-det-desc">${esc(n.description)}</div>`) : ''}
      ${n.dois?.length ? sec(`${GLYPH.doi} Cited DOIs`,
        n.dois.map(d => `<a class="st-det-link" href="${esc(d)}" target="_blank" rel="noopener">${esc(doiTxt(d))} ↗</a>`).join('')) : ''}
      ${n.uri ? `<a class="st-det-open" href="${esc(n.uri)}" target="_blank" rel="noopener">Open dataset ↗</a>` : ''}`;
    return `<div class="st-tile-detail">${body.trim() ? body : '<div class="st-det-empty">No further details.</div>'}</div>`;
  }
  // The toggle shown on connected tiles to expand/collapse their record in place.
  function expandToggle(n) {
    const open = expandedTiles.has(n.id);
    return `<button class="st-tile-toggle${open ? ' open' : ''}" data-toggle="${esc(n.id)}" title="${open ? 'Hide details' : 'Show more details'}">
      <span class="st-tile-toggle-cv">${open ? '▴' : '▾'}</span>${open ? 'Less' : 'More details'}</button>`;
  }

  // The focal dataset, rendered as an unboxed editorial block rather than a tile: it is the
  // SUBJECT of the story, so it gets headline treatment. Kicker (domain › cluster · deg) →
  // title → abstract → cited DOIs → link. Author/keywords are deliberately omitted — they
  // are the connector bands right below. A domain-hue left rule keeps the colour encoding.
  function focalBlockHTML(n) {
    const doiTxt = d => d.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    const sec = (k, body) => `<div class="st-det-sec"><div class="st-det-k">${k}</div>${body}</div>`;
    return `<div class="st-focal" style="border-left-color:${colorFor(n.hue)}">
      <div class="st-focal-kicker">
        <span class="st-focal-dot" style="background:${colorFor(n.hue)}"></span>
        <span>${esc(KG.domains[n.domain]?.label || '')} › ${esc(KG.clusters[n.cluster]?.label || '')}</span>
        <span class="st-focal-deg">deg ${degree[n.id] || 0}</span>
      </div>
      <div class="st-focal-title">${esc(n.title || n.label)}</div>
      ${n.description ? sec('Abstract', `<div class="st-det-desc">${esc(n.description)}</div>`) : ''}
      ${n.dois?.length ? sec(`${GLYPH.doi} Cited DOIs`,
        n.dois.map(d => `<a class="st-det-link" href="${esc(d)}" target="_blank" rel="noopener">${esc(doiTxt(d))} ↗</a>`).join('')) : ''}
      ${n.uri ? `<a class="st-det-open" href="${esc(n.uri)}" target="_blank" rel="noopener">Open dataset ↗</a>` : ''}
    </div>`;
  }

  function chipBtn(c, prop) {
    const sel = selected && selected.prop === prop && selected.value === c.value;
    return `<button class="st-chip st-cprop-${prop}${sel ? ' sel' : ''}" data-prop="${prop}" data-value="${esc(c.value)}" title="${esc(c.value)}">
      <span class="st-chip-g">${GLYPH[prop]}</span>
      <span class="st-chip-v">${esc(clip(c.value, 32))}</span>
      <span class="st-chip-n">${c.members.length}</span>
    </button>`;
  }

  // A connector band's chips: rarest (most specific → fewest shared datasets) first, so the
  // discriminating connectors lead; capped at BAND_CAP with an inline "＋N more" expander.
  function bandChips(band) {
    const list = band.list.slice().sort((a, b) => a.members.length - b.members.length);
    const expanded = expandedBands.has(band.prop);
    const shown = expanded ? list : list.slice(0, BAND_CAP);
    let html = shown.map(c => chipBtn(c, band.prop)).join('');
    if (list.length > BAND_CAP)
      html += `<button class="st-more-chip" data-band="${esc(band.prop)}">${expanded ? '▴ show less' : `＋${list.length - BAND_CAP} more`}</button>`;
    return html;
  }
  // Full tile + description, shown in the Connected-datasets coordinate.
  function dsTileHTML(n) {
    const open = expandedTiles.has(n.id);
    const kw = (n.keywords || []).slice(0, 3).map(k => `<span class="sm-tile-chip">${GLYPH.keyword} ${esc(clip(k, 16))}</span>`).join('');
    return `<div class="sm-tile st-dstile${open ? ' is-expanded' : ''}" data-eid="${esc(n.id)}" style="border-left-color:${colorFor(n.hue)}">
      <div class="sm-tile-top"><span class="sm-tile-dot" style="background:${colorFor(n.hue)}"></span><span class="sm-tile-deg">deg ${degree[n.id] || 0}</span></div>
      <div class="sm-tile-title" title="${esc(n.title || n.label)}">${esc(n.title || n.label)}</div>
      <div class="sm-tile-meta">${esc(KG.domains[n.domain]?.label || '')} › ${esc(KG.clusters[n.cluster]?.label || '')}</div>
      ${n.description ? `<div class="st-dstile-desc">${esc(n.description)}</div>` : ''}
      <div class="sm-tile-chips">
        ${n.authors?.[0] ? `<span class="sm-tile-chip">${GLYPH.author} ${esc(clip(n.authors[0], 18))}</span>` : ''}
        ${n.orgName ? `<span class="sm-tile-chip">${GLYPH.org} ${esc(clip(n.orgName, 18))}</span>` : ''}
        ${kw}
      </div>
      ${open ? detailHTML(n) : ''}
      ${expandToggle(n)}
    </div>`;
  }
  const axisCell = (label, row) => `<div class="st-axis" style="grid-row:${row}"><span class="st-axis-l">${label}</span><span class="st-axis-tick"></span></div>`;

  function renderBreadcrumb() {
    bc.innerHTML = `<span class="st-bc-k">TRAIL</span>` + trail.map((n, i) => {
      const cur = i === trail.length - 1;
      return `<button class="st-bc-crumb${cur ? ' current' : ''}" data-i="${i}" title="${esc(n.title || n.label)}">
        <span class="st-dot" style="background:${colorFor(n.hue)}"></span>${esc(clip(n.label, 26))}</button>`
        + (i < trail.length - 1 ? `<span class="st-bc-sep">›</span>` : '');
    }).join('');
    bc.querySelectorAll('.st-bc-crumb').forEach(b => b.onclick = () => { trail = trail.slice(0, +b.dataset.i + 1); selected = null; expandedBands.clear(); render(); });
  }

  // Connector bands the focal dataset actually has (shared by both layouts).
  function bandsOf(focal) {
    const conn = connectorsOf(focal);
    return [
      { prop: 'author',     label: 'Authors',     list: conn.authors },
      { prop: 'keyword',    label: 'Keywords',    list: conn.keywords },
      { prop: 'energy',     label: 'Energy √s',   list: conn.energies },
      { prop: 'observable', label: 'Observables', list: conn.observables },
    ].filter(b => b.list.length);
  }

  function render() {
    renderBreadcrumb();
    overlay.querySelectorAll('.st-layout-toggle button')
      .forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
    if (layout === 'spine') renderSpine(); else renderGrid();
  }
  overlay.querySelectorAll('.st-layout-toggle button').forEach(b => b.onclick = () => {
    layout = b.dataset.layout; render();
    flowwrap.scrollTop = 0; flowwrap.scrollLeft = 0;
  });

  function renderGrid() {
    const focal = trail[trail.length - 1];
    const cl = KG.clusters[focal.cluster];
    const bands = bandsOf(focal);

    // Row layout: Topic (1) · Dataset (2) · one row per band · Connected datasets (last).
    let r = 2;
    bands.forEach(b => { b.row = ++r; });
    const connRow = ++r;

    // Connected-datasets coordinate: a prompt until a connector is picked, then tiles.
    let connected;
    if (!selected) {
      connected = `<div class="st-prompt"><span class="st-prompt-mk">↑</span> Select a connector above (author, keyword, energy or observable) to reveal its connected datasets.</div>`;
    } else {
      const band = bands.find(b => b.prop === selected.prop);
      const c = band?.list.find(x => x.value === selected.value);
      const members = c ? c.members : [];
      const shown = members.slice(0, MEMBER_CAP);
      connected = members.length
        ? `<div class="st-tilegrid">${shown.map(dsTileHTML).join('')}</div>`
          + (members.length > MEMBER_CAP ? `<div class="st-more">Showing top ${MEMBER_CAP} of ${members.length}.</div>` : '')
        : `<div class="st-prompt">No other dataset shares this ${selected.prop}.</div>`;
    }

    // Coordinate grid: col 1 = Y-axis · col 2 = content.
    let html = `<div class="st-coord">`
      + axisCell('Topic', '1') + axisCell('Dataset', '2')
      + bands.map(b => axisCell(b.label, String(b.row))).join('')
      + axisCell('Connected datasets', String(connRow))
      + `<div class="st-cell" style="grid-row:1;grid-column:2">
           <div class="st-topic"><div class="st-topic-k">TOPIC</div><div class="st-topic-l">${esc(cl?.label || '')}</div><div class="st-topic-s">${esc(KG.domains[focal.domain]?.label || '')}</div></div>
         </div>`
      + `<div class="st-cell" style="grid-row:2;grid-column:2">${focalBlockHTML(focal)}</div>`
      + bands.map(b => `<div class="st-cell st-chips" style="grid-row:${b.row};grid-column:2">${bandChips(b)}</div>`).join('')
      + `<div class="st-cell" style="grid-row:${connRow};grid-column:2">${connected}</div>`
      + `</div>`;
    flow.innerHTML = html;

    // pick a connector → fill the Connected-datasets coordinate (toggle off if re-clicked)
    flow.querySelectorAll('.st-chip').forEach(b => b.onclick = () => {
      const prop = b.dataset.prop, value = b.dataset.value;
      selected = (selected && selected.prop === prop && selected.value === value) ? null : { prop, value };
      render();
    });
    // reveal / collapse the rest of a connector band (＋N more)
    flow.querySelectorAll('.st-more-chip').forEach(b => b.onclick = () => {
      const p = b.dataset.band;
      expandedBands.has(p) ? expandedBands.delete(p) : expandedBands.add(p);
      render();
    });
    // click a dataset tile → drill in (new focal, reset selection + band expansion)
    flow.querySelectorAll('.st-dstile').forEach(t => t.onclick = () => {
      const n = nodeById[t.dataset.eid];
      if (!n) return;
      trail.push(n); selected = null; expandedBands.clear(); render();
      flowwrap.scrollTop = 0; flowwrap.scrollLeft = 0;
    });
    // expand/collapse a connected tile's record in place.
    // stopPropagation keeps the connected-tile drill-in from also firing.
    flow.querySelectorAll('.st-tile-toggle').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const id = b.dataset.toggle;
      expandedTiles.has(id) ? expandedTiles.delete(id) : expandedTiles.add(id);
      render();
    });
    // clicks inside the expanded detail (DOI links, "Open dataset") must not
    // bubble to the tile's drill-in handler and open a new storyline.
    flow.querySelectorAll('.st-tile-detail').forEach(d => d.onclick = ev => ev.stopPropagation());
  }

  // ════════════════════════════════════════════════════════════════
  //  SPINE layout — a vertical narrative trunk of hub nodes, each fanning out to ALL of
  //  its values (nothing collapsed). Nodes are absolutely-positioned HTML (so the focal
  //  tile stays a real tile) over an SVG layer that draws the trunk + spokes.
  //     TOPIC → DATASET(+abstract) → AUTHORS → KEYWORDS → ENERGY → OBSERVABLES → CONNECTED
  // ════════════════════════════════════════════════════════════════
  function renderSpine() {
    const focal = trail[trail.length - 1];
    const cl = KG.clusters[focal.cluster];
    const bands = bandsOf(focal);

    const PAD = 20, VAL_W = 200, VAL_H = 26, ROW_H = 34, GAP_X = 34;
    const HUB_H = 34, V_GAP = 34;
    // Trunk (y-axis) centred in the available canvas width, so the spine sits in the middle.
    const AREA = Math.max(560, (flowwrap.clientWidth || 900) - 48);
    const TRUNK_X = Math.round(AREA / 2);

    flow.innerHTML = `<div class="st-spine"><svg class="sp-edges"></svg></div>`;
    const spine = flow.querySelector('.st-spine');
    const svg = flow.querySelector('.sp-edges');

    let maxRight = 0;
    const edges = [];
    const add = (cls, x, w, html, data) => {
      const el = document.createElement('div');
      el.className = 'sp-node ' + cls;
      el.style.left = x + 'px'; el.style.width = w + 'px';
      el.innerHTML = html;
      if (data) Object.assign(el.dataset, data);
      spine.appendChild(el);
      maxRight = Math.max(maxRight, x + w);
      return el;
    };
    // fan ALL values of a hub out to alternating left/right columns
    const fan = (items, hubBottom, mk) => {
      const top = hubBottom + 16;
      items.forEach((it, i) => {
        const right = i % 2 === 1, row = Math.floor(i / 2);
        const x = right ? TRUNK_X + GAP_X : TRUNK_X - GAP_X - VAL_W;
        const yy = top + row * ROW_H;
        mk(it, x, yy);
        edges.push({ x1: TRUNK_X, y1: hubBottom, x2: right ? x : x + VAL_W, y2: yy + VAL_H / 2, cls: 'sp-spoke' });
      });
      const rows = Math.ceil(items.length / 2);
      return rows ? top + (rows - 1) * ROW_H + VAL_H : hubBottom;
    };

    let y = PAD;
    // TOPIC
    const topicW = 300;
    const topicEl = add('sp-topic', TRUNK_X - topicW / 2, topicW,
      `<div class="sp-k">TOPIC</div><div class="sp-topic-l">${esc(cl?.label || '')}</div><div class="sp-topic-s">${esc(KG.domains[focal.domain]?.label || '')}</div>`);
    topicEl.style.top = y + 'px';
    let prevBottom = y + topicEl.offsetHeight;
    y = prevBottom + V_GAP;

    // DATASET — unboxed text block, centred on the trunk (trunk enters top/exits bottom)
    const FOCAL_W = Math.min(720, AREA - 40);
    const focalEl = add('sp-focal', TRUNK_X - FOCAL_W / 2, FOCAL_W, focalBlockHTML(focal));
    focalEl.style.top = y + 'px';
    edges.push({ x1: TRUNK_X, y1: prevBottom, x2: TRUNK_X, y2: y, cls: 'sp-trunk' });
    prevBottom = y + focalEl.offsetHeight;
    y = prevBottom + V_GAP;

    // CONNECTOR HUBS — every value fanned out, none collapsed
    bands.forEach(b => {
      const hubW = 190, hubY = y;
      const hubEl = add('sp-hub sp-cprop-' + b.prop, TRUNK_X - hubW / 2, hubW,
        `<span class="sp-hub-g">${GLYPH[b.prop]}</span><span class="sp-hub-l">${esc(b.label.toUpperCase())}</span><span class="sp-hub-n">${b.list.length}</span>`);
      hubEl.style.top = hubY + 'px';
      edges.push({ x1: TRUNK_X, y1: prevBottom, x2: TRUNK_X, y2: hubY, cls: 'sp-trunk' });
      const hubBottom = hubY + HUB_H;
      const list = b.list.slice().sort((p, q) => p.members.length - q.members.length);
      const fanBottom = fan(list, hubBottom, (c, x, yy) => {
        const sel = selected && selected.prop === b.prop && selected.value === c.value;
        const el = add(`sp-val sp-cprop-${b.prop}${sel ? ' sel' : ''}`, x, VAL_W,
          `<span class="sp-val-g">${GLYPH[b.prop]}</span><span class="sp-val-v" title="${esc(c.value)}">${esc(clip(c.value, 24))}</span><span class="sp-val-n">${c.members.length}</span>`,
          { prop: b.prop, value: c.value });
        el.style.top = yy + 'px';
      });
      prevBottom = hubBottom;
      y = fanBottom + V_GAP;
    });

    // CONNECTED DATASETS
    const chubW = 230, chubY = y;
    const chubEl = add('sp-hub sp-hub-conn', TRUNK_X - chubW / 2, chubW,
      `<span class="sp-hub-l">CONNECTED DATASETS</span>`);
    chubEl.style.top = chubY + 'px';
    edges.push({ x1: TRUNK_X, y1: prevBottom, x2: TRUNK_X, y2: chubY, cls: 'sp-trunk' });
    const chubBottom = chubY + HUB_H;
    let bottom = chubBottom;
    if (!selected) {
      const p = add('sp-prompt', TRUNK_X - 190, 380, 'Select a connector above to fan out its connected datasets.');
      p.style.top = (chubBottom + 16) + 'px';
      bottom = chubBottom + 16 + p.offsetHeight;
    } else {
      const band = bands.find(b => b.prop === selected.prop);
      const c = band?.list.find(x => x.value === selected.value);
      const members = c ? c.members : [];
      const shown = members.slice(0, MEMBER_CAP);
      bottom = fan(shown, chubBottom, (m, x, yy) => {
        const el = add('sp-val sp-conn', x, VAL_W,
          `<span class="sp-val-dot" style="background:${colorFor(m.hue)}"></span><span class="sp-val-v" title="${esc(m.title || m.label)}">${esc(clip(m.title || m.label, 24))}</span><span class="sp-val-n">${degree[m.id] || 0}</span>`,
          { eid: m.id });
        el.style.top = yy + 'px';
      });
      if (!members.length) {
        const p = add('sp-prompt', TRUNK_X - 190, 380, `No other dataset shares this ${selected.prop}.`);
        p.style.top = (chubBottom + 16) + 'px';
        bottom = chubBottom + 16 + p.offsetHeight;
      } else if (members.length > MEMBER_CAP) {
        const p = add('sp-prompt', TRUNK_X - 190, 380, `Showing the ${MEMBER_CAP} most-connected of ${members.length}.`);
        p.style.top = (bottom + 12) + 'px';
        bottom = bottom + 12 + p.offsetHeight;
      }
    }

    // size the canvas + paint the edges beneath the nodes. Width = the area (so the
    // centred trunk lands in the middle of the pane); grows only if content overflows.
    const W = Math.max(AREA, maxRight + PAD), H = bottom + PAD;
    spine.style.width = W + 'px'; spine.style.height = H + 'px';
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.innerHTML = edges.map(e => e.cls === 'sp-trunk'
      ? `<line class="sp-trunk" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"/>`
      : `<path class="sp-spoke" d="M${e.x1},${e.y1} C${e.x1},${(e.y1 + e.y2) / 2} ${e.x2},${(e.y1 + e.y2) / 2} ${e.x2},${e.y2}"/>`).join('')
      + edges.filter(e => e.cls === 'sp-trunk').map(e => `<circle class="sp-joint" cx="${e.x2}" cy="${e.y2}" r="3"/>`).join('');

    // interactions
    spine.querySelectorAll('.sp-val[data-prop]').forEach(el => el.onclick = () => {
      const prop = el.dataset.prop, value = el.dataset.value;
      selected = (selected && selected.prop === prop && selected.value === value) ? null : { prop, value };
      render();
    });
    spine.querySelectorAll('.sp-val[data-eid]').forEach(el => el.onclick = () => {
      const n = nodeById[el.dataset.eid];
      if (!n) return;
      trail.push(n); selected = null; expandedBands.clear(); render();
      flowwrap.scrollTop = 0; flowwrap.scrollLeft = 0;
    });
    spine.querySelectorAll('.sp-focal').forEach(d => d.onclick = ev => ev.stopPropagation());
  }

  render();
}
