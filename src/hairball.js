// Hairball: dense force-directed canvas view of all leaf nodes + cross/intra edges.

import * as d3 from 'd3';
import { EnergyKG } from './data.js';

function colorFor(hue, lightness = 0.58, chroma = 0.15) {
  return `oklch(${lightness} ${chroma} ${hue})`;
}

// Canvas-safe colour constants (CSS vars don't resolve in canvas context)
const C_INK   = '#1b1e23';
const C_INK_3 = '#8b9199';
const C_TEAL  = 'oklch(0.55 0.12 200)';
const C_AMBER = 'oklch(0.60 0.16 60)';

const LINK_STYLE = {
  intra:   { color: C_INK_3, alpha: 0.28 },
  sibling: { color: C_TEAL,  alpha: 0.28 },
  cross:   { color: C_AMBER, alpha: 0.20 },
  hub:     { color: C_INK_3, alpha: 0.36 },
};

export function renderHairball(container) {
  container.innerHTML = '';
  const KG = EnergyKG;
  const data = {
    nodes: KG.leafNodes.map(n => ({ ...n })),
    links: KG.edges.map(e => ({ ...e }))
  };

  const wrap = document.createElement('div');
  wrap.className = 'view-wrap hairball-wrap';
  container.appendChild(wrap);

  // Side panel
  const side = document.createElement('aside');
  side.className = 'side-panel';
  side.innerHTML = `
    <div class="panel-title">HAIRBALL</div>
    <div class="panel-sub">Full topology · ${data.nodes.length.toLocaleString()} datasets · ${data.links.length.toLocaleString()} relations</div>
    <div class="panel-section">
      <div class="panel-h">Selection</div>
      <div id="hb-selected" class="panel-empty">Hover a node to inspect.</div>
    </div>
    <div class="panel-section">
      <div class="panel-h">Domains</div>
      <div id="hb-legend" class="legend"></div>
    </div>
    <div class="panel-section">
      <div class="panel-h">Filter by domain</div>
      <div id="hb-filter" class="filter"></div>
    </div>
    <div class="panel-section">
      <div class="panel-h">Display</div>
      <label class="toggle"><input type="checkbox" id="hb-cross" checked> Show cross-domain edges</label>
      <label class="toggle"><input type="checkbox" id="hb-labels"> Always show labels</label>
    </div>
    <div class="panel-foot">
      <span class="kbd">click</span> select+highlight ·
      <span class="kbd">drag</span> reposition (stays) ·
      <span class="kbd">shift+drag</span> release back
    </div>
  `;
  wrap.appendChild(side);

  // Canvas container
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  canvasWrap.style.cssText = 'position:relative;overflow:hidden;';
  wrap.appendChild(canvasWrap);

  let W = canvasWrap.clientWidth || 1100;
  let H = canvasWrap.clientHeight || 800;

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:default;';
  canvasWrap.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Pre-compute node colours (only 4 hue values across all domains)
  const nodeColor  = {}, nodeStroke = {};
  KG.TAXONOMY.forEach(d => {
    nodeColor[d.hue]  = colorFor(d.hue);
    nodeStroke[d.hue] = colorFor(d.hue, 0.42, 0.1);
  });

  // State
  let transform    = d3.zoomIdentity;
  let selectedId   = null;
  let hoveredNode  = null;
  let pinned       = null;
  let draggingNode = null;
  let dragDownPt   = null;
  let dragMoved    = false;
  let suppressClick = false;
  const activeDomains = new Set(KG.TAXONOMY.map(d => d.id));
  const GRID = 60;

  // ── World-coord helpers ──────────────────────────────────────────────────────
  function clientToWorld(cx, cy) {
    const r = canvas.getBoundingClientRect();
    const px = (cx - r.left) * (W / r.width);
    const py = (cy - r.top)  * (H / r.height);
    return { x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k };
  }

  // Hit-test against each node's true radius plus a constant ~4px screen
  // tolerance, so the clickable area always matches the drawn node regardless
  // of zoom (a fixed world-space threshold was too small zoomed in, too grabby
  // zoomed out).
  function findNode(cx, cy) {
    const { x, y } = clientToWorld(cx, cy);
    const slop = 4 / transform.k;
    let best = null, bd = Infinity;
    for (const n of data.nodes) {
      if (n.x === undefined) continue;
      const r = 2.4 + Math.sqrt(n.weight) * 1.6 + slop;
      const d2 = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d2 <= r * r && d2 < bd) { bd = d2; best = n; }
    }
    return best;
  }

  // ── Zoom: skip drag-to-pan when starting on a node ──────────────────────────
  const zoom = d3.zoom()
    .scaleExtent([0.04, 8])
    .filter(e => e.type === 'wheel' || e.button !== 0 || !findNode(e.clientX, e.clientY))
    .on('zoom', e => { transform = e.transform; draw(); });
  d3.select(canvas).call(zoom);

  // ── Adjacency (for highlight) ────────────────────────────────────────────────
  const adjacency = new Map();
  data.links.forEach(l => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    if (!adjacency.has(s)) adjacency.set(s, new Set());
    if (!adjacency.has(t)) adjacency.set(t, new Set());
    adjacency.get(s).add(t);
    adjacency.get(t).add(s);
  });

  // ── Mouse events ─────────────────────────────────────────────────────────────
  canvas.addEventListener('mousemove', e => {
    if (draggingNode) {
      const w = clientToWorld(e.clientX, e.clientY);
      if (!dragMoved) {
        const dx = w.x - dragDownPt.x, dy = w.y - dragDownPt.y;
        if ((dx * dx + dy * dy) * transform.k * transform.k > 9) dragMoved = true; // >3px on screen
      }
      if (dragMoved) { draggingNode.fx = w.x; draggingNode.fy = w.y; }
      return; // sim tick → draw()
    }
    const n = findNode(e.clientX, e.clientY);
    if (n !== hoveredNode) {
      hoveredNode = n;
      canvas.style.cursor = n ? 'pointer' : 'default';
      if (!pinned) showInfo(n);
      draw();
    }
  });

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const n = findNode(e.clientX, e.clientY);
    if (!n) return;
    draggingNode = n;
    dragMoved = false;
    dragDownPt = clientToWorld(e.clientX, e.clientY);
    n.fx = n.x; n.fy = n.y;
    sim.alphaTarget(0.3).restart();
  });

  canvas.addEventListener('mouseup', e => {
    if (!draggingNode) return;
    sim.alphaTarget(0);
    if (e.shiftKey) { draggingNode.fx = null; draggingNode.fy = null; }
    else { draggingNode.fx = draggingNode.x; draggingNode.fy = draggingNode.y; }
    if (dragMoved) suppressClick = true; // a real drag — don't let the click toggle selection
    draggingNode = null;
  });

  canvas.addEventListener('click', e => {
    if (suppressClick) { suppressClick = false; return; }
    const n = findNode(e.clientX, e.clientY);
    if (n) {
      if (selectedId === n.id) { selectedId = null; pinned = null; showInfo(null); }
      else { selectedId = n.id; pinned = n; showInfo(n); }
    } else {
      selectedId = null; pinned = null; showInfo(null);
    }
    draw();
  });

  // ── Draw ─────────────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Grid in screen space
    ctx.strokeStyle = 'rgba(20,30,45,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = GRID * transform.k;
    const ox = ((transform.x % step) + step) % step;
    const oy = ((transform.y % step) + step) % step;
    for (let x = ox - step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy - step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    const showCross  = document.getElementById('hb-cross')?.checked !== false;
    const showLabels = document.getElementById('hb-labels')?.checked === true;
    const hasSel     = selectedId !== null;
    const neighbors  = hasSel ? (adjacency.get(selectedId) || new Set()) : null;

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // ── Links batched by kind × highlight bucket (4 stroke() calls per kind) ──
    const batches = {};
    for (const l of data.links) {
      if (typeof l.source !== 'object') continue; // forceLink not yet resolved
      const sd = l.source.domain, td = l.target.domain;
      if (!showCross && l.kind === 'cross') continue;
      if (!activeDomains.has(sd) || !activeDomains.has(td)) continue;
      const kind = l.kind || 'cross';
      if (!batches[kind]) batches[kind] = { normal: [], active: [], dim: [] };
      if (hasSel) {
        const active = l.source.id === selectedId || l.target.id === selectedId;
        (active ? batches[kind].active : batches[kind].dim).push(l);
      } else {
        batches[kind].normal.push(l);
      }
    }
    ctx.lineWidth = 0.55;
    for (const [kind, b] of Object.entries(batches)) {
      const s = LINK_STYLE[kind] || LINK_STYLE.cross;
      ctx.strokeStyle = s.color;
      for (const [bucket, alpha] of [
        [b.normal, s.alpha],
        [b.active, Math.min(1, s.alpha * 3.2)],
        [b.dim,    0.016],
      ]) {
        if (!bucket.length) continue;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (const l of bucket) {
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
        }
        ctx.stroke();
      }
    }

    // ── Nodes ─────────────────────────────────────────────────────────────────
    ctx.lineWidth = 0.6;
    for (const n of data.nodes) {
      if (n.x === undefined) continue;
      const active      = activeDomains.has(n.domain);
      const isSelected  = n.id === selectedId;
      const isNeighbor  = hasSel && neighbors.has(n.id);
      const isHovered   = n === hoveredNode;

      ctx.globalAlpha = !active ? 0.04
        : hasSel ? (isSelected ? 1 : isNeighbor ? 0.82 : 0.07)
        : (isHovered ? 1 : 0.8);

      const r = 2.4 + Math.sqrt(n.weight) * 1.6 + (isSelected || isHovered ? 1.4 : 0);
      ctx.fillStyle   = nodeColor[n.hue]  || colorFor(n.hue);
      ctx.strokeStyle = nodeStroke[n.hue] || colorFor(n.hue, 0.42, 0.1);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // ── Labels ────────────────────────────────────────────────────────────────
    if (showLabels || transform.k > 1.6) {
      ctx.globalAlpha  = showLabels ? 0.82 : Math.min(1, (transform.k - 1.6) / 0.6);
      ctx.fillStyle    = C_INK;
      ctx.font         = `${Math.max(7, 9 / transform.k)}px "Space Grotesk",system-ui,sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      for (const n of data.nodes) {
        if (n.x === undefined || !activeDomains.has(n.domain)) continue;
        if (hasSel && n.id !== selectedId && !neighbors.has(n.id)) continue;
        ctx.fillText(n.label, n.x, n.y - (2.4 + Math.sqrt(n.weight) * 1.6) - 1);
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── Force simulation ─────────────────────────────────────────────────────────
  const sim = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d => d.id)
      .distance(d => d.kind === 'cross' ? 90 : 35)
      .strength(d => d.kind === 'cross' ? 0.05 : 0.5))
    .force('charge', d3.forceManyBody().strength(-22).distanceMax(280))
    .force('center',  d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide().radius(d => 4 + Math.sqrt(d.weight)))
    .force('domain',  domainCenterForce())
    .alphaDecay(0.03)
    .on('tick', draw);

  function domainCenterForce() {
    const domains = KG.TAXONOMY.map(d => d.id);
    const centers = {};
    domains.forEach((id, i) => {
      const a = (i / domains.length) * Math.PI * 2 - Math.PI / 2;
      centers[id] = {
        x: W / 2 + Math.cos(a) * Math.min(W, H) * 0.28,
        y: H / 2 + Math.sin(a) * Math.min(W, H) * 0.28,
      };
    });
    return function(alpha) {
      for (const n of data.nodes) {
        const c = centers[n.domain];
        if (!c) continue;
        n.vx += (c.x - n.x) * 0.04 * alpha;
        n.vy += (c.y - n.y) * 0.04 * alpha;
      }
    };
  }

  // ── Legend & domain chips ────────────────────────────────────────────────────
  KG.TAXONOMY.forEach(dom => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="dot" style="background:${colorFor(dom.hue)}"></span>
      <span class="name">${dom.label}</span>
      <span class="count">${KG.domains[dom.id].leafCount.toLocaleString()}</span>`;
    document.getElementById('hb-legend').appendChild(item);

    const chip = document.createElement('button');
    chip.className = 'chip active';
    chip.innerHTML = `<span class="dot" style="background:${colorFor(dom.hue)}"></span>${dom.label}`;
    chip.onclick = () => {
      if (activeDomains.has(dom.id)) { activeDomains.delete(dom.id); chip.classList.remove('active'); }
      else { activeDomains.add(dom.id); chip.classList.add('active'); }
      draw();
    };
    document.getElementById('hb-filter').appendChild(chip);
  });

  document.getElementById('hb-cross').addEventListener('change', draw);
  document.getElementById('hb-labels').addEventListener('change', draw);

  // ── Info panel ───────────────────────────────────────────────────────────────
  const infoEl = document.getElementById('hb-selected');
  function showInfo(d) {
    if (!d && !pinned) { infoEl.innerHTML = `<div class="panel-empty">Hover a node to inspect.</div>`; return; }
    const t   = d || pinned;
    const dom = KG.domains[t.domain];
    const cl  = KG.clusters[t.cluster];
    const deg = (adjacency.get(t.id) || new Set()).size;
    infoEl.innerHTML = `
      <div class="info-name" style="border-left-color:${colorFor(t.hue)}">${t.title || t.label}</div>
      <div class="info-meta">
        <div><span>Domain</span><b>${dom.label}</b></div>
        <div><span>Cluster</span><b>${cl.label}</b></div>
        <div><span>Edges</span><b>${deg}</b></div>
      </div>
      ${t.description ? `<div class="info-desc" style="font-size:10.5px;color:var(--ink-2);margin-top:6px;line-height:1.5;">${t.description.slice(0, 240)}${t.description.length > 240 ? '…' : ''}</div>` : ''}
    `;
  }

  const resetBtn = document.createElement('button');
  resetBtn.className = 'panel-btn';
  resetBtn.textContent = 'Release all pinned nodes';
  resetBtn.onclick = () => {
    data.nodes.forEach(n => { n.fx = null; n.fy = null; });
    sim.alpha(0.6).restart();
  };
  side.appendChild(resetBtn);

  // ── Resize ───────────────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    W = canvasWrap.clientWidth; H = canvasWrap.clientHeight;
    canvas.width = W; canvas.height = H;
    draw();
  });
  ro.observe(canvasWrap);

  // Initial fit
  setTimeout(() => {
    d3.select(canvas).call(zoom.transform, d3.zoomIdentity.scale(0.9));
  }, 150);
}
