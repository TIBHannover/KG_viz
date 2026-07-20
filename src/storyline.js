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

  host.querySelector('.st-trail')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'st-trail';
  overlay.innerHTML = `
    <div class="st-trail-head">
      <span class="st-trail-title">STORYLINE</span>
      <span class="st-trail-hint">click a dataset title to drill in · breadcrumb to go back</span>
      <button class="st-trail-close" title="Close storyline">✕ close</button>
    </div>
    <div class="st-bc"></div>
    <div class="st-flowwrap"><div class="st-flow"></div></div>`;
  host.appendChild(overlay);
  const bc = overlay.querySelector('.st-bc');
  const flow = overlay.querySelector('.st-flow');
  const flowwrap = overlay.querySelector('.st-flowwrap');
  overlay.querySelector('.st-trail-close').onclick = () => { overlay.remove(); ctx.onClose?.(); };

  let trail = [seed];
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

  // Focal detail shown BESIDE the focal tile (same Dataset row) — the parts not on the
  // tile: abstract · cited DOIs · link. Empty (no block) when the dataset has none.
  function focalDetailHTML(n) {
    const doiTxt = d => d.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    const sec = (k, body) => `<div class="st-det-sec"><div class="st-det-k">${k}</div>${body}</div>`;
    if (!(n.description || n.dois?.length || n.uri)) return '';
    return `<div class="st-focal-detail">
      ${n.description ? sec('Abstract', `<div class="st-det-desc">${esc(n.description)}</div>`) : ''}
      ${n.dois?.length ? sec(`${GLYPH.doi} Cited DOIs`,
        n.dois.map(d => `<a class="st-det-link" href="${esc(d)}" target="_blank" rel="noopener">${esc(doiTxt(d))} ↗</a>`).join('')) : ''}
      ${n.uri ? `<a class="st-det-open" href="${esc(n.uri)}" target="_blank" rel="noopener">Open dataset ↗</a>` : ''}
    </div>`;
  }

  // The focal dataset tile (abstract/DOI sit beside it — see focalDetailHTML).
  function tileHTML(n) {
    const kw = (n.keywords || []).slice(0, 3).map(k => `<span class="sm-tile-chip">${GLYPH.keyword} ${esc(clip(k, 16))}</span>`).join('');
    return `<div class="sm-tile st-tile" style="border-left-color:${colorFor(n.hue)}">
      <div class="sm-tile-top"><span class="sm-tile-dot" style="background:${colorFor(n.hue)}"></span><span class="sm-tile-deg">deg ${degree[n.id] || 0}</span></div>
      <div class="sm-tile-title" title="${esc(n.title || n.label)}">${esc(clip(n.title || n.label, 90))}</div>
      <div class="sm-tile-meta">${esc(KG.domains[n.domain].label)} › ${esc(KG.clusters[n.cluster].label)}</div>
      <div class="sm-tile-chips">
        ${n.authors?.[0] ? `<span class="sm-tile-chip">${GLYPH.author} ${esc(clip(n.authors[0], 18))}</span>` : ''}
        ${n.orgName ? `<span class="sm-tile-chip">${GLYPH.org} ${esc(clip(n.orgName, 18))}</span>` : ''}
        ${kw}
      </div>
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

  function render() {
    const focal = trail[trail.length - 1];
    const cl = KG.clusters[focal.cluster];
    const conn = connectorsOf(focal);
    // Connector bands (only those the focal dataset actually has), each its own row.
    const bands = [
      { prop: 'author',     label: 'Authors',     list: conn.authors },
      { prop: 'keyword',    label: 'Keywords',    list: conn.keywords },
      { prop: 'energy',     label: 'Energy √s',   list: conn.energies },
      { prop: 'observable', label: 'Observables', list: conn.observables },
    ].filter(b => b.list.length);
    renderBreadcrumb();

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
      + `<div class="st-cell st-dataset-cell" style="grid-row:2;grid-column:2">${tileHTML(focal)}${focalDetailHTML(focal)}</div>`
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

  render();
}
