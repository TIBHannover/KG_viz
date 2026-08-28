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

import * as d3 from 'd3';
import { colorFor, esc, clip } from './helpers.js';

const GLYPH = { author: '✎', keyword: '#', org: '⌂', doi: '◈', energy: '√', observable: '∂' };
const MEMBER_CAP = 60;   // tiles shown per connector before "showing top N"
// A connector's connected datasets bloom as a force-directed cluster ONLY while there are few
// enough for the node-link picture to say something. Past this the discs shrink, the labels
// collide and finding a specific dataset becomes a squinting exercise — so it switches to a
// scannable table instead (same call the connector bands make between tiles and a table).
const BLOOM_MAX = 8;      // members at or below this bloom as a node-link cluster
const MEMBER_ROWS_CAP = 200;   // rows listed in the table form before "＋N more"

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
      <span class="st-trail-hint">click a dataset title to drill in · breadcrumb jumps back &amp; forward, keeping each view</span>
      <button class="st-trail-close" title="Close storyline">✕ close</button>
    </div>
    <div class="st-bc"></div>
    <div class="st-flowwrap"><div class="st-flow"></div></div>
    <div class="sp-zoom" hidden>
      <button data-z="out" title="Zoom out">－</button>
      <button class="sp-zoom-pct" data-z="reset" title="Reset to 100%">100%</button>
      <button data-z="in" title="Zoom in">＋</button>
      <button data-z="fit" title="Fit spine to view">⤢ Fit</button>
    </div>`;
  host.appendChild(overlay);
  const bc = overlay.querySelector('.st-bc');
  const flow = overlay.querySelector('.st-flow');
  const flowwrap = overlay.querySelector('.st-flowwrap');
  const zoomCtl = overlay.querySelector('.sp-zoom');
  // Re-centre the spine when the canvas resizes (e.g. the split-layout transition).
  let roTimer;
  const ro = new ResizeObserver(() => {
    clearTimeout(roTimer);
    roTimer = setTimeout(() => { if (layout === 'spine' && overlay.isConnected) { stopPan(); renderSpine(); } }, 90);
  });
  ro.observe(host);
  host.__stRO = ro;
  overlay.querySelector('.st-trail-close').onclick = () => { ro.disconnect(); host.__stRO = null; overlay.remove(); ctx.onClose?.(); };

  // Navigation history is a stack of FRAMES, not just a list of nodes. Each frame remembers
  // the WHOLE view at that level — the focal dataset, the picked connector (i.e. the open
  // hairball) and its expanded bands/tiles — so jumping around the breadcrumb restores exactly
  // what you were looking at instead of resetting it. `cursor` points at the visible frame;
  // frames after it are kept (forward history) so you can step back out to where you were.
  const newFrame = (node, lay) => ({ node, selected: null, layout: lay, expandedBands: new Set(), expandedTiles: new Set() });
  let frames = [newFrame(seed, 'grid')];
  let cursor = 0;
  // Live mirrors of the current frame's state (kept so the render code below reads/writes plain
  // variables). snapshot() flushes them back into the frame before any navigation; loadFrame()
  // re-points them at another frame.
  let layout, selected, expandedTiles, expandedBands;
  const BAND_CAP = 10;               // connector chips shown per band before "＋N more"
  function snapshot() {
    const f = frames[cursor];
    f.layout = layout; f.selected = selected; f.expandedBands = expandedBands; f.expandedTiles = expandedTiles;
  }
  function loadFrame(i) {
    cursor = Math.max(0, Math.min(i, frames.length - 1));
    const f = frames[cursor];
    layout = f.layout; selected = f.selected; expandedBands = f.expandedBands; expandedTiles = f.expandedTiles;
  }
  // Drill into a dataset: remember the current view, drop any forward history that would be
  // orphaned by this new branch, then push and show a fresh frame (same layout mode).
  function drillInto(n) {
    if (!n) return;
    snapshot();
    frames = frames.slice(0, cursor + 1);
    frames.push(newFrame(n, layout));
    loadFrame(frames.length - 1);
    render();
    stopPan();
    flowwrap.scrollTop = 0; flowwrap.scrollLeft = 0;
  }
  loadFrame(0);

  // ── Spine zoom (CSS-transform based, so it never re-runs the force layout). The spine's
  // natural size (spineW × spineH) is remembered by renderSpine; applyZoom scales the .st-spine
  // and reserves the scaled footprint on .st-flow so the scrollbars stay correct. ──
  const ZOOM_MIN = 0.2, ZOOM_MAX = 3;
  let zoom = 1, spineW = 0, spineH = 0;
  function applyZoom() {
    const spine = flow.querySelector('.st-spine');
    if (spine) {
      spine.style.transformOrigin = 'top left';
      spine.style.transform = zoom === 1 ? '' : `scale(${zoom})`;
      // Size .st-flow to the SCALED footprint (overriding its min-width:100%) and centre it, so a
      // spine narrower than the pane sits centred — there is no horizontal scrollbar to nudge.
      flow.style.minWidth = '0';
      flow.style.margin = '0 auto';
      flow.style.width = (spineW * zoom) + 'px';
      flow.style.height = (spineH * zoom) + 'px';
    }
    const pct = zoomCtl.querySelector('.sp-zoom-pct');
    if (pct) pct.textContent = Math.round(zoom * 100) + '%';
  }
  // Set zoom, keeping the point (cx,cy) — in flowwrap-viewport coords — stationary on screen.
  function setZoom(z, cx, cy) {
    z = Math.max(ZOOM_MIN, Math.min(z, ZOOM_MAX));
    if (z === zoom) return;
    const rect = flowwrap.getBoundingClientRect();
    if (cx == null) { cx = rect.width / 2; cy = rect.height / 2; }
    const contentX = flowwrap.scrollLeft + cx, contentY = flowwrap.scrollTop + cy;
    const k = z / zoom;
    zoom = z; applyZoom();
    flowwrap.scrollLeft = contentX * k - cx;
    flowwrap.scrollTop = contentY * k - cy;
  }
  // Fit the whole spine within the viewport (never upscales past 1:1). Because the fit zoom always
  // makes the spine fit horizontally, the centred flow needs no horizontal scroll — start at top.
  function fitSpine() {
    if (!spineW || !spineH) return;
    const padX = 40, padY = 40;
    const z = Math.min((flowwrap.clientWidth - padX) / spineW, (flowwrap.clientHeight - padY) / spineH, 1);
    zoom = Math.max(ZOOM_MIN, z); applyZoom();
    flowwrap.scrollTop = 0; flowwrap.scrollLeft = 0;
  }
  // ── Animated pan ("camera move"). Picking a connector puts its bloom off to the right, often
  // entirely off-screen — a hard jump there is disorienting and a fit rescales the whole spine.
  // Gliding the viewport instead keeps the zoom level AND lets you watch where you travelled, so
  // the spatial model survives. pendingBloomPan is set true by a connector SELECT (not deselect)
  // and consumed at the end of the next renderSpine, once the bloom's DOM actually exists. ──
  let panRAF = 0, pendingBloomPan = false;
  const stopPan = () => { cancelAnimationFrame(panRAF); panRAF = 0; };
  function animatePan(toLeft, toTop, ms = 460) {
    stopPan();
    const maxL = Math.max(0, flowwrap.scrollWidth - flowwrap.clientWidth);
    const maxT = Math.max(0, flowwrap.scrollHeight - flowwrap.clientHeight);
    toLeft = Math.max(0, Math.min(toLeft, maxL));
    toTop = Math.max(0, Math.min(toTop, maxT));
    const fromLeft = flowwrap.scrollLeft, fromTop = flowwrap.scrollTop;
    const dL = toLeft - fromLeft, dT = toTop - fromTop;
    if (Math.abs(dL) < 1 && Math.abs(dT) < 1) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      flowwrap.scrollLeft = toLeft; flowwrap.scrollTop = toTop; return;
    }
    const t0 = performance.now();
    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // easeInOutCubic
    const step = now => {
      const k = ease(Math.min(1, (now - t0) / ms));
      flowwrap.scrollLeft = fromLeft + dL * k;
      flowwrap.scrollTop = fromTop + dT * k;
      if (k < 1) panRAF = requestAnimationFrame(step);
    };
    panRAF = requestAnimationFrame(step);
  }
  // Glide until rect `r` (viewport coords, e.g. from getBoundingClientRect) is framed in the
  // viewport — centred when it fits, else its top-left corner brought just inside. Measuring live
  // rects means zoom, padding and the centred .st-flow are all already baked in, so no separate
  // coordinate maths is needed here.
  function panToRect(r, horizOnly) {
    if (!r) return;
    const w = flowwrap.getBoundingClientRect();
    const PADV = 40;
    const wantX = r.width <= w.width ? (w.width - r.width) / 2 : PADV;
    const wantY = r.height <= w.height ? (w.height - r.height) / 2 : PADV;
    const toLeft = flowwrap.scrollLeft + ((r.left - w.left) - wantX);
    const toTop = horizOnly ? flowwrap.scrollTop : flowwrap.scrollTop + ((r.top - w.top) - wantY);
    animatePan(toLeft, toTop);
  }
  const panToEl = (el, horizOnly) => el && panToRect(el.getBoundingClientRect(), horizOnly);
  zoomCtl.querySelectorAll('button').forEach(b => b.onclick = () => {
    stopPan();
    const a = b.dataset.z;
    if (a === 'in') setZoom(zoom * 1.2);
    else if (a === 'out') setZoom(zoom / 1.2);
    else if (a === 'reset') setZoom(1);
    else if (a === 'fit') fitSpine();
  });
  // ⌘/Ctrl + wheel zooms toward the cursor (plain wheel still scrolls the pane). Either way the
  // user has taken the wheel, so any camera move in flight is abandoned rather than fought.
  flowwrap.addEventListener('wheel', e => {
    if (layout !== 'spine') return;
    stopPan();
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const rect = flowwrap.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  // Drag anywhere on the spine canvas to pan it (grab / grabbing). A small movement threshold
  // keeps plain clicks working — a connector pick / node drill-in only fires when you DON'T drag,
  // and the click the browser synthesises after a real drag is swallowed. Move/up listeners live
  // only for the duration of a drag, so nothing leaks when the storyline closes.
  flowwrap.addEventListener('mousedown', e => {
    if (layout !== 'spine' || e.button !== 0) return;
    stopPan();   // grabbing the canvas cancels any camera move in flight
    const sx = e.clientX, sy = e.clientY, l0 = flowwrap.scrollLeft, t0 = flowwrap.scrollTop;
    let moved = false;
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      flowwrap.classList.add('sp-grabbing');
      flowwrap.scrollLeft = l0 - (ev.clientX - sx);
      flowwrap.scrollTop = t0 - (ev.clientY - sy);
      ev.preventDefault();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      flowwrap.classList.remove('sp-grabbing');
      if (moved) {   // swallow the click that follows a real drag, then drop the guard
        const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
        flowwrap.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => flowwrap.removeEventListener('click', swallow, { capture: true }), 0);
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // Global indexes: each connector property → datasets that carry each value
  // (built once per launch). energy = cmenergies (√s) · observable = measured quantity.
  let idx = host.__stIndex;
  if (!idx || !idx.energyIndex) {
    const authorIndex = new Map(), keywordIndex = new Map(), energyIndex = new Map(), observableIndex = new Map();
    const push = (map, k, id) => { let a = map.get(k); if (!a) map.set(k, a = []); a.push(id); };
    KG.leafNodes.forEach(n => {
      (n.authors || []).forEach(a => push(authorIndex, a, n.id));
      // Keywords are indexed by concept IRI, so datasets connect only when they
      // share the SAME concept (homonyms like the OEO vs MENO "radiation" stay apart).
      (n.keywordConcepts || []).forEach(kc => push(keywordIndex, kc.iri, n.id));
      (n.energies || []).forEach(e => push(energyIndex, e, n.id));
      (n.observables || []).forEach(o => push(observableIndex, o, n.id));
    });
    idx = host.__stIndex = { authorIndex, keywordIndex, energyIndex, observableIndex };
  }

  // Connectors = the dataset's OWN properties (ALL of them, from its metadata —
  // not just the ones that happen to form graph edges). Each connector's members =
  // the other datasets that also carry that author / keyword / energy / observable.
  function connectorsOf(focal) {
    // members of a connector = the OTHER datasets sharing that key, degree-sorted.
    const membersOf = (map, key) => (map.get(key) || [])
      .filter(id => id !== focal.id)
      .map(id => nodeById[id]).filter(Boolean)
      .sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
    // Each connector carries `value` (the MATCH key + selection identity) and
    // `label` (the DISPLAYED text). For authors/energy/observables they coincide;
    // for keywords `value` is the concept IRI while `label` is its rdfs:label.
    const mk   = (values,   map) => (values   || []).map(value            => ({ value, label: value, members: membersOf(map, value) }));
    const mkKw = (concepts, map) => (concepts || []).map(({ iri, label }) => ({ value: iri, label,   members: membersOf(map, iri)   }));
    return {
      authors:     mk(focal.authors,           idx.authorIndex),
      keywords:    mkKw(focal.keywordConcepts, idx.keywordIndex),
      energies:    mk(focal.energies,          idx.energyIndex),
      observables: mk(focal.observables,       idx.observableIndex),
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

  // A connector's signal quality, for visual flagging (see .st-chip-*/.sp-val-* CSS):
  //   'dead' — no OTHER dataset shares it: a branch to nowhere → dimmed grey.
  //   'red'  — very broad: shared by >500 datasets. Filled solid red with NO outline; the fill
  //            DEEPENS with the connection count, reaching maximum redness at 2000+ (redFill).
  const RED_LOW = 500, RED_HIGH = 2000;
  const connClass = members => !members.length ? 'dead' : (members.length > RED_LOW ? 'red' : '');
  // Graduated red: light-ish at 500 → deep/max at 2000+ (darker & a touch more saturated).
  function redFill(count) {
    const t = Math.max(0, Math.min(1, (count - RED_LOW) / (RED_HIGH - RED_LOW)));
    const L = (0.56 - 0.18 * t).toFixed(3);   // lightness drops → darker with more connections
    const C = (0.155 + 0.06 * t).toFixed(3);  // chroma rises → a touch more saturated
    return `oklch(${L} ${C} 25)`;
  }
  const connHint = q => q === 'red' ? ' — very broad (>500 datasets share this)'
    : q === 'dead' ? ' — no other dataset shares this' : '';

  function chipBtn(c, prop) {
    const sel = selected && selected.prop === prop && selected.value === c.value;
    const q = sel ? '' : connClass(c.members);   // selection styling wins; don't flag while picked
    const style = q === 'red' ? ` style="background:${redFill(c.members.length)}"` : '';
    const disp = c.label ?? c.value;   // show the label; identity/matching stays on c.value
    return `<button class="st-chip st-cprop-${prop}${sel ? ' sel' : ''}${q ? ' st-chip-' + q : ''}"${style} data-prop="${prop}" data-value="${esc(c.value)}" title="${esc(disp)}${connHint(q)}">
      <span class="st-chip-g">${GLYPH[prop]}</span>
      <span class="st-chip-v">${esc(clip(disp, 32))}</span>
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
    bc.innerHTML = `<span class="st-bc-k">TRAIL</span>` + frames.map((f, i) => {
      const n = f.node, cur = i === cursor, ahead = i > cursor;
      return `<button class="st-bc-crumb${cur ? ' current' : ''}${ahead ? ' ahead' : ''}" data-i="${i}" title="${esc(n.title || n.label)}">
        <span class="st-dot" style="background:${colorFor(n.hue)}"></span>${esc(clip(n.label, 26))}</button>`
        + (i < frames.length - 1 ? `<span class="st-bc-sep">›</span>` : '');
    }).join('');
    // Jump to any crumb WITHOUT dropping the others — successors stay so you can step forward
    // again — and restore that frame's own connector/hairball state instead of clearing it.
    bc.querySelectorAll('.st-bc-crumb').forEach(b => b.onclick = () => { stopPan(); snapshot(); loadFrame(+b.dataset.i); render(); });
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

  // ── Spine "dataset boxes" — back to the original spine grammar (separate boxes on the trunk,
  //    joined by edges) rather than one monolithic card. DATASET title → ABSTRACT → one boxed
  //    section per connector property, each its own node. Authors & keywords (usually long)
  //    render as STANDARD-SIZE SCROLLABLE tables; energy stays as tiles; observables are tiles
  //    when few (≤ TILE_MAX) and a table when many. Every row / tile is a clickable CONNECTOR —
  //    picking one blooms its connected datasets off that section's own box. ──
  const TILE_MAX = 6;   // observables at or below this render as tiles; above it, a table
  function connRow(c, prop) {
    const sel = selected && selected.prop === prop && selected.value === c.value;
    const q = sel ? '' : connClass(c.members);   // selection styling wins; don't flag while picked
    const style = q === 'red' ? ` style="background:${redFill(c.members.length)}"` : '';
    const disp = c.label ?? c.value;   // show the label; identity/matching stays on c.value
    return `<button class="sp-row sp-cprop-${prop}${sel ? ' sel' : ''}${q ? ' sp-row-' + q : ''}"${style} data-prop="${prop}" data-value="${esc(c.value)}" title="${esc(disp)}${connHint(q)}">
      <span class="sp-row-g">${GLYPH[prop]}</span>
      <span class="sp-row-v">${esc(disp)}</span>
      <span class="sp-row-n">${c.members.length}</span>
    </button>`;
  }
  function connTile(c, prop) {
    const sel = selected && selected.prop === prop && selected.value === c.value;
    const q = sel ? '' : connClass(c.members);
    const style = q === 'red' ? ` style="background:${redFill(c.members.length)}"` : '';
    const disp = c.label ?? c.value;   // show the label; identity/matching stays on c.value
    return `<button class="sp-val sp-cprop-${prop}${sel ? ' sel' : ''}${q ? ' sp-val-' + q : ''}"${style} data-prop="${prop}" data-value="${esc(c.value)}" title="${esc(disp)}${connHint(q)}">
      <span class="sp-val-g">${GLYPH[prop]}</span>
      <span class="sp-val-v">${esc(clip(disp, 24))}</span>
      <span class="sp-val-n">${c.members.length}</span>
    </button>`;
  }
  // TITLE content — kicker + headline. NOTE: this returns the INNER content only; the box chrome
  // (background/border/shadow) is carried by the outer .sp-node the caller places it in via
  // placeBox() — wrapping it again here was the bug behind the double-nested "2 layers" look.
  function titleBoxHTML(n) {
    return `<div class="sp-card-kicker">
        <span class="sp-card-dot" style="background:${colorFor(n.hue)}"></span>
        <span>${esc(KG.domains[n.domain]?.label || '')} › ${esc(KG.clusters[n.cluster]?.label || '')}</span>
        <span class="sp-card-deg">deg ${degree[n.id] || 0}</span>
      </div>
      <div class="sp-card-title">${esc(n.title || n.label)}</div>`;
  }
  // ABSTRACT content — text + cited DOIs + link. Inner content only (see titleBoxHTML note).
  function abstractBoxHTML(n) {
    const doiTxt = d => d.replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    return `<div class="sp-sec-h"><span class="sp-sec-k">Abstract</span></div>
      ${n.description ? `<div class="sp-abstract">${esc(n.description)}</div>` : `<div class="sp-empty">No abstract provided.</div>`}
      ${n.dois?.length ? `<div class="sp-dois">${n.dois.map(d => `<a class="st-det-link" href="${esc(d)}" target="_blank" rel="noopener">${esc(doiTxt(d))} ↗</a>`).join('')}</div>` : ''}
      ${n.uri ? `<a class="st-det-open" href="${esc(n.uri)}" target="_blank" rel="noopener">Open dataset ↗</a>` : ''}`;
  }
  // Connector-property content (Authors / Keywords / Energy √s / Observables) — header + table/tiles.
  // Every section's OUTER node is the plain full-weight .sp-box. Authors' table and the tile bands
  // render flat/bare inside it; keyword and observable-as-table nest a second, lightened inner box
  // (.sp-table-light) — observable only falls back to that past TILE_MAX, keyword always uses it.
  function bandBoxHTML(band) {
    const list = band.list.slice().sort((p, q) => p.members.length - q.members.length);  // rarest first
    const rows = () => list.map(c => connRow(c, band.prop)).join('');
    const tiles = () => `<div class="sp-tiles">${list.map(c => connTile(c, band.prop)).join('')}</div>`;
    let body;
    if (band.prop === 'author') body = `<div class="sp-table">${rows()}</div>`;               // flat — outer box is the only frame
    else if (band.prop === 'keyword') body = `<div class="sp-table-light">${rows()}</div>`;    // inner box, lightened — same as observables-as-table
    else if (band.prop === 'energy') body = tiles();
    else body = list.length <= TILE_MAX ? tiles() : `<div class="sp-table-light">${rows()}</div>`;   // observables: tiles, or a lightened inner table
    return `<div class="sp-sec-h"><span class="sp-sec-k">${esc(band.label)}</span><span class="sp-sec-n">${band.list.length}</span></div>
      ${body}`;
  }
  // CONNECTED DATASETS in table form — used once a connector has more members than a node-link
  // cluster can usefully show (see BLOOM_MAX). Same grammar as the connector bands: a header, then
  // a scrollable list. Rows are ordered by degree (connectorsOf already sorts that way), so the
  // best-connected datasets lead. Each row drills in, exactly like a bloom node.
  function membersBoxHTML(members, propLabel, connLabel) {
    const shown = members.slice(0, MEMBER_ROWS_CAP);
    const rows = shown.map(m => `<button class="sp-mrow" data-eid="${esc(m.id)}" title="${esc(m.title || m.label)}">
        <span class="sp-mrow-dot" style="background:${colorFor(m.hue)}"></span>
        <span class="sp-mrow-v">${esc(m.title || m.label)}</span>
        <span class="sp-mrow-n">${degree[m.id] || 0}</span>
      </button>`).join('');
    const more = members.length > MEMBER_ROWS_CAP
      ? `<div class="sp-empty">＋${members.length - MEMBER_ROWS_CAP} more not listed (top ${MEMBER_ROWS_CAP} by degree)</div>` : '';
    return `<div class="sp-sec-h">
        <span class="sp-sec-k">Datasets sharing this ${esc(propLabel)}</span>
        <span class="sp-sec-n">${members.length}</span>
      </div>
      <div class="sp-mrow-sub">${esc(connLabel)}</div>
      <div class="sp-mtable">${rows}</div>
      ${more}`;
  }

  function render() {
    renderBreadcrumb();
    overlay.querySelectorAll('.st-layout-toggle button')
      .forEach(b => b.classList.toggle('active', b.dataset.layout === layout));
    zoomCtl.hidden = layout !== 'spine';   // zoom controls belong to the spine only
    flowwrap.classList.toggle('sp-pannable', layout === 'spine');   // grab cursor in the spine
    if (layout === 'spine') renderSpine(); else renderGrid();
  }
  overlay.querySelectorAll('.st-layout-toggle button').forEach(b => b.onclick = () => {
    layout = b.dataset.layout; render();
    stopPan();
    flowwrap.scrollTop = 0; flowwrap.scrollLeft = 0;
  });

  function renderGrid() {
    flow.style.width = flow.style.height = flow.style.minWidth = flow.style.margin = '';   // drop any spine-zoom footprint
    const focal = frames[cursor].node;
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
    // click a dataset tile → drill in (new frame; current view is kept in the breadcrumb)
    flow.querySelectorAll('.st-dstile').forEach(t => t.onclick = () => drillInto(nodeById[t.dataset.eid]));
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
  //  SPINE layout — a vertical narrative trunk of boxed sections, each fanning out to ALL of
  //  its values (nothing collapsed). Nodes are absolutely-positioned HTML (so the focal
  //  tile stays a real tile) over an SVG layer that draws the trunk + spokes.
  //     TITLE(+domain›cluster) → ABSTRACT → AUTHORS → KEYWORDS → ENERGY → OBSERVABLES
  //  Picking a connector value blooms ITS connected datasets into a small force-directed
  //  hairball (adaptive-L2 style) hanging off that value, on its own side of the trunk.
  // ════════════════════════════════════════════════════════════════
  function renderSpine() {
    // Keep the viewport where it is across a re-render. Replacing flow.innerHTML momentarily
    // collapses the scroll height, which would otherwise snap the pane back to the top when a
    // connector is picked. Callers that want a reset (drill-in, layout toggle) zero it after.
    const keepTop = flowwrap.scrollTop, keepLeft = flowwrap.scrollLeft;
    const focal = frames[cursor].node;
    const bands = bandsOf(focal);

    const PAD = 20, V_GAP = 34, GAP_X = 44;
    // Trunk (y-axis) centred in the available canvas width, so the spine sits in the middle.
    const AREA = Math.max(560, (flowwrap.clientWidth || 900) - 48);
    const TRUNK_X = Math.round(AREA / 2);
    const CARD_W = Math.min(600, AREA - 40);   // the dataset card's fixed, readable width

    flow.innerHTML = `<div class="st-spine"><svg class="sp-edges"></svg></div>`;
    const spine = flow.querySelector('.st-spine');
    const svg = flow.querySelector('.sp-edges');

    let maxRight = 0, minLeft = PAD;
    const edges = [];
    const add = (cls, x, w, html, data) => {
      const el = document.createElement('div');
      el.className = 'sp-node ' + cls;
      el.style.left = x + 'px'; el.style.width = w + 'px';
      el.innerHTML = html;
      if (data) Object.assign(el.dataset, data);
      spine.appendChild(el);
      maxRight = Math.max(maxRight, x + w);
      minLeft = Math.min(minLeft, x);
      return el;
    };
    let y = PAD;
    // TITLE → ABSTRACT → one boxed section per connector property — SEPARATE nodes on the
    // trunk (matching the original spine grammar), each joined by a trunk edge. TITLE leads (no
    // standalone TOPIC node — its domain›cluster info already lives in the title box's kicker),
    // so the trunk's first edge is drawn INTO title from whatever the caller placed before it.
    const boxX = TRUNK_X - CARD_W / 2, boxRight = boxX + CARD_W;
    let prevBottom = null;   // null until the first box is placed — no trunk edge above the first node
    const placeBox = (cls, html) => {
      const el = add(cls, boxX, CARD_W, html);
      el.style.top = y + 'px';
      if (prevBottom !== null) edges.push({ x1: TRUNK_X, y1: prevBottom, x2: TRUNK_X, y2: y, cls: 'sp-trunk' });
      prevBottom = y + el.offsetHeight;
      y = prevBottom + V_GAP;
      return el;
    };
    const titleEl = placeBox('sp-box sp-box-title', titleBoxHTML(focal));
    titleEl.style.borderLeftColor = colorFor(focal.hue);   // the kicker's accent rule
    placeBox('sp-box', abstractBoxHTML(focal));
    // Track the box + on-screen span of whichever band the selected connector belongs to, so the
    // bloom can anchor its spoke to THAT box specifically (not the whole stack).
    let selBox = null;   // { top, bottom }
    const groupTop = y;   // top of the FIRST band box — marks where "connectors" begin
    bands.forEach(b => {
      const el = placeBox('sp-box', bandBoxHTML(b));
      if (selected && selected.prop === b.prop) {
        selBox = { el, top: prevBottom - el.offsetHeight, bottom: prevBottom };
      }
    });
    let bottom = prevBottom;
    // A single dashed outline drawn BEHIND Authors/Keywords/Energy/Observables (whichever the
    // focal dataset actually has), marking them as a set: these are the sections that can branch
    // into other datasets, unlike the title/abstract above.
    if (bands.length) {
      const GROUP_PAD = 10;
      edges.push({ cls: 'sp-conn-group', x1: boxX - GROUP_PAD, y1: groupTop - GROUP_PAD, x2: boxRight + GROUP_PAD, y2: bottom + GROUP_PAD });
      minLeft = Math.min(minLeft, boxX - GROUP_PAD);
      maxRight = Math.max(maxRight, boxRight + GROUP_PAD);
    }

    // CONNECTED DATASETS — picking any connector (a table row or a tile) branches ITS connected
    // datasets off the RIGHT of that connector's own box, with the spoke leaving the box edge level
    // with the picked row. HOW they're drawn depends on how many there are:
    //   ≤ BLOOM_MAX — a force-directed cluster housed in a rounded rectangle; member↔member threads
    //                 stay hidden until a node is hovered. The picture earns its place at this size.
    //   > BLOOM_MAX — a scrollable table, because a node-link cluster of dozens (or thousands) of
    //                 discs is unreadable and unsearchable. Same box grammar as the connector bands.
    if (selected && selBox) {
      const band = bands.find(b => b.prop === selected.prop);
      const c = band?.list.find(x => x.value === selected.value);
      const all = c ? c.members : [];
      const shown = all.slice(0, MEMBER_CAP);
      const sx = boxRight;
      let spokeY = (selBox.top + selBox.bottom) / 2;
      spokeY = Math.max(selBox.top + 14, Math.min(spokeY, selBox.bottom - 14));
      if (!shown.length) {
        const p = add('sp-prompt', sx + GAP_X, 380, `No other dataset shares this ${selected.prop}.`);
        p.style.top = spokeY + 'px';
        edges.push({ x1: sx, y1: spokeY, x2: sx + GAP_X, y2: spokeY, cls: 'sp-spoke', horiz: true });
        maxRight = Math.max(maxRight, sx + GAP_X + 380);
        bottom = Math.max(bottom, spokeY + 30);
      } else if (all.length > BLOOM_MAX) {
        // ── TABLE form: one boxed, scrollable list of the connected datasets ──
        const MEM_W = Math.min(560, CARD_W);
        const mx = sx + GAP_X;
        const el = add('sp-box sp-members', mx, MEM_W,
          membersBoxHTML(all, selected.prop, c.label ?? c.value));
        const mh = el.offsetHeight;
        let mTop = spokeY - mh / 2;
        if (mTop < selBox.top) mTop = selBox.top;   // don't let the list ride above its own box
        el.style.top = mTop + 'px';
        edges.push({ x1: sx, y1: spokeY, x2: mx, y2: mTop + mh / 2, cls: 'sp-spoke', horiz: true });
        maxRight = Math.max(maxRight, mx + MEM_W);
        bottom = Math.max(bottom, mTop + mh);
      } else {
        // ── build the ego graph: member nodes + real KG edges among the shown members ──
        const LABEL_W = 108, LABEL_H = 28;   // two-line title footprint under each node
        const nodeR = n => Math.max(6, Math.min(15, 5 + Math.sqrt(degree[n.id] || 0) * 1.1));
        const idSet = new Set(shown.map(m => m.id));
        const simNodes = shown.map(m => ({ id: m.id, hue: m.hue, r: nodeR(m), title: m.title || m.label }));
        const simIndex = new Map(simNodes.map(sn => [sn.id, sn]));
        const seen = new Set();
        const simLinks = [];
        shown.forEach(m => (adjacency.get(m.id) || []).forEach(e => {
          if (!idSet.has(e.id)) return;
          const key = m.id < e.id ? m.id + '|' + e.id : e.id + '|' + m.id;
          if (seen.has(key)) return;
          seen.add(key);
          simLinks.push({ source: m.id, target: e.id });
        }));
        // ── settle a spread-out force layout synchronously (no animation) around the origin.
        // Collision reserves the label footprint so the two-line titles below each node clear ──
        d3.forceSimulation(simNodes)
          .force('link', d3.forceLink(simLinks).id(d => d.id).distance(96).strength(0.28))
          .force('charge', d3.forceManyBody().strength(-320))
          .force('collide', d3.forceCollide().radius(d => Math.max(d.r + 10, LABEL_W / 2 + 4)).iterations(8))
          .force('x', d3.forceX(0).strength(0.03))
          .force('y', d3.forceY(0).strength(0.04))
          .stop().tick(320);
        // ── translate the settled blob so it hangs off the card's right edge, centred on the spoke.
        // The bbox includes each node's label footprint so nothing clips at the edges ──
        let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
        simNodes.forEach(n => {
          const half = Math.max(n.r, LABEL_W / 2);
          bMinX = Math.min(bMinX, n.x - half); bMaxX = Math.max(bMaxX, n.x + half);
          bMinY = Math.min(bMinY, n.y - n.r); bMaxY = Math.max(bMaxY, n.y + n.r + LABEL_H);
        });
        const tx = (sx + GAP_X) - bMinX;
        let ty = spokeY - (bMinY + bMaxY) / 2;
        if (bMinY + ty < selBox.top) ty = selBox.top - bMinY;   // don't let the bloom ride above its box
        simNodes.forEach(n => { n.x += tx; n.y += ty; });
        // ── the members are HOUSED in a rectangle, and the connector's thread lands on the box
        //    (not on one node): every member shares this connector, so the container IS the link.
        //    Push the box FIRST so it paints behind the threads. ──
        const RECT_PAD = 16;
        const rL = bMinX + tx - RECT_PAD, rT = bMinY + ty - RECT_PAD;
        const rR = bMaxX + tx + RECT_PAD, rB = bMaxY + ty + RECT_PAD;
        edges.push({ cls: 'sp-rect', x1: rL, y1: rT, x2: rR, y2: rB });
        edges.push({ x1: sx, y1: spokeY, x2: rL, y2: (rT + rB) / 2, cls: 'sp-spoke', horiz: true });
        maxRight = Math.max(maxRight, rR); bottom = Math.max(bottom, rB);
        // ── member↔member threads (the hairball). Tagged with their endpoints and HIDDEN by
        //    default (see .sp-gedge CSS); hovering a node reveals only that node's threads ──
        simLinks.forEach(l => {
          const a = simIndex.get(typeof l.source === 'object' ? l.source.id : l.source);
          const b = simIndex.get(typeof l.target === 'object' ? l.target.id : l.target);
          if (a && b) edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, cls: 'sp-gedge', a: a.id, b: b.id });
        });
        // ── node discs (domain-coloured, degree-sized) with a two-line title label below;
        //    both are clickable to drill in ──
        simNodes.forEach(n => {
          const d = n.r * 2;
          const el = add('sp-gnode', n.x - n.r, d, '', { eid: n.id });
          el.style.top = (n.y - n.r) + 'px';
          el.style.height = d + 'px';
          el.style.background = colorFor(n.hue);
          el.style.borderColor = colorFor(n.hue, 0.42, 0.1);
          el.title = n.title;
          const lab = add('sp-gnode-l', n.x - LABEL_W / 2, LABEL_W, esc(n.title), { eid: n.id });
          lab.style.top = (n.y + n.r + 3) + 'px';
          lab.title = n.title;
          bottom = Math.max(bottom, n.y + n.r + LABEL_H);
        });
      }
    }

    // A left-side branch can push nodes past the left edge (negative x). Slide the whole
    // spine right by that overflow so it's all visible; the pane scrolls for extra width.
    const dx = minLeft < PAD ? PAD - minLeft : 0;
    if (dx) {
      spine.querySelectorAll('.sp-node').forEach(el => { el.style.left = (parseFloat(el.style.left) + dx) + 'px'; });
      edges.forEach(e => { e.x1 += dx; e.x2 += dx; });
    }
    // size the canvas + paint the edges beneath the nodes.
    const W = Math.max(AREA, maxRight + dx + PAD), H = bottom + PAD;
    spine.style.width = W + 'px'; spine.style.height = H + 'px';
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.innerHTML = edges.map(e => {
      if (e.cls === 'sp-rect') return `<rect class="sp-rect" x="${e.x1}" y="${e.y1}" width="${e.x2 - e.x1}" height="${e.y2 - e.y1}" rx="14"/>`;
      if (e.cls === 'sp-conn-group') return `<rect class="sp-conn-group" x="${e.x1}" y="${e.y1}" width="${e.x2 - e.x1}" height="${e.y2 - e.y1}" rx="20"/>`;
      if (e.cls === 'sp-trunk') return `<line class="sp-trunk" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"/>`;
      if (e.cls === 'sp-gedge') return `<line class="sp-gedge" data-a="${esc(e.a)}" data-b="${esc(e.b)}" x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"/>`;
      const d = e.horiz   // branch spokes curve horizontally; hub→value spokes curve vertically
        ? `M${e.x1},${e.y1} C${(e.x1 + e.x2) / 2},${e.y1} ${(e.x1 + e.x2) / 2},${e.y2} ${e.x2},${e.y2}`
        : `M${e.x1},${e.y1} C${e.x1},${(e.y1 + e.y2) / 2} ${e.x2},${(e.y1 + e.y2) / 2} ${e.x2},${e.y2}`;
      return `<path class="sp-spoke" d="${d}"/>`;
    }).join('')
      + edges.filter(e => e.cls === 'sp-trunk').map(e => `<circle class="sp-joint" cx="${e.x2}" cy="${e.y2}" r="3"/>`).join('');

    // remember the natural size and re-apply the current zoom (scales .st-spine, resizes .st-flow)
    spineW = W; spineH = H;
    applyZoom();
    // restore the scroll position captured before the rebuild (see top of renderSpine)
    flowwrap.scrollTop = keepTop; flowwrap.scrollLeft = keepLeft;

    // interactions
    spine.querySelectorAll('[data-prop][data-value]').forEach(el => el.onclick = e => {
      e.stopPropagation();
      const prop = el.dataset.prop, value = el.dataset.value;
      const turningOn = !(selected && selected.prop === prop && selected.value === value);
      selected = turningOn ? { prop, value } : null;
      pendingBloomPan = turningOn;   // only glide the camera on SELECT — a deselect leaves it be
      render();
    });
    // drill in from either bloom form — a cluster node/label, or a row of the members table
    spine.querySelectorAll('[data-eid]').forEach(el => el.onclick = e => {
      e.stopPropagation();
      drillInto(nodeById[el.dataset.eid]);
    });
    spine.querySelectorAll('.sp-box a').forEach(a => a.onclick = ev => ev.stopPropagation());
    // member threads are hidden until you hover a node — then only that node's threads light up.
    const edgeByNode = new Map();
    svg.querySelectorAll('.sp-gedge').forEach(ln => [ln.dataset.a, ln.dataset.b].forEach(id => {
      if (!edgeByNode.has(id)) edgeByNode.set(id, []);
      edgeByNode.get(id).push(ln);
    }));
    spine.querySelectorAll('.sp-gnode, .sp-gnode-l').forEach(el => {
      const inc = edgeByNode.get(el.dataset.eid) || [];
      el.addEventListener('mouseenter', () => inc.forEach(ln => ln.classList.add('show')));
      el.addEventListener('mouseleave', () => inc.forEach(ln => ln.classList.remove('show')));
    });

    // If this render was triggered by SELECTING a connector, glide the camera to frame whatever
    // just branched out — the members table, the housed cluster of nodes, or the "no other dataset
    // shares this" prompt. Runs last so the DOM (and its layout) already reflects the new pick.
    if (pendingBloomPan) {
      pendingBloomPan = false;
      const table = spine.querySelector('.sp-members');
      const gnodes = spine.querySelectorAll('.sp-gnode');
      if (table) {
        panToEl(table);
      } else if (gnodes.length) {
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        gnodes.forEach(n => {
          const rc = n.getBoundingClientRect();
          l = Math.min(l, rc.left); t = Math.min(t, rc.top);
          r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
        });
        panToRect({ left: l, top: t, width: r - l, height: b - t });
      } else {
        panToEl(spine.querySelector('.sp-prompt'));
      }
    }
  }

  render();
}
