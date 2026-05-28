// Hairball: dense force-directed view of all leaf nodes + cross/intra edges.

import * as d3 from 'd3';
import { EnergyKG } from './data.js';

function colorFor(hue, lightness = 0.72, chroma = 0.13) {
  return `oklch(${lightness} ${chroma} ${hue})`;
}

export function renderHairball(container) {
  container.innerHTML = "";

  const KG = EnergyKG;
  const data = {
    nodes: KG.leafNodes.map(n => ({ ...n })),
    links: KG.edges.map(e => ({ ...e }))
  };

  const wrap = document.createElement("div");
  wrap.className = "view-wrap hairball-wrap";
  container.appendChild(wrap);

  // Side panel
  const side = document.createElement("aside");
  side.className = "side-panel";
  side.innerHTML = `
    <div class="panel-title">HAIRBALL</div>
    <div class="panel-sub">Full topology · ${data.nodes.length} datasets · ${data.links.length} relations</div>
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
      <label class="toggle"><input type="checkbox" id="hb-cross"> Show cross-domain edges</label>
      <label class="toggle"><input type="checkbox" id="hb-labels"> Always show labels</label>
    </div>
    <div class="panel-foot">
      <span class="kbd">click</span> select+highlight · <span class="kbd">drag</span> reposition (stays) · <span class="kbd">shift+drag</span> release back
    </div>
  `;
  wrap.appendChild(side);

  // SVG canvas
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  wrap.appendChild(canvasWrap);

  const W = canvasWrap.clientWidth || 1100;
  const H = canvasWrap.clientHeight || 800;

  const svg = d3.select(canvasWrap).append("svg")
    .attr("class", "graph-svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${W} ${H}`);

  // Defs: glow
  const defs = svg.append("defs");
  const f = defs.append("filter").attr("id", "hb-glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
  f.append("feGaussianBlur").attr("stdDeviation", "2").attr("result", "blur");
  const merge = f.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");

  // Subtle grid
  const grid = svg.append("g").attr("class", "grid-bg");
  const gridSize = 60;
  for (let x = 0; x < W; x += gridSize) {
    grid.append("line").attr("x1", x).attr("y1", 0).attr("x2", x).attr("y2", H);
  }
  for (let y = 0; y < H; y += gridSize) {
    grid.append("line").attr("x1", 0).attr("y1", y).attr("x2", W).attr("y2", y);
  }

  const root = svg.append("g").attr("class", "zoom-root");
  const linkLayer = root.append("g").attr("class", "links");
  const nodeLayer = root.append("g").attr("class", "nodes");
  const labelLayer = root.append("g").attr("class", "labels");

  const zoom = d3.zoom().scaleExtent([0.2, 6]).on("zoom", (e) => {
    root.attr("transform", e.transform);
    labelLayer.attr("opacity", document.getElementById("hb-labels")?.checked ? 1 : (e.transform.k > 1.6 ? 1 : 0));
  });
  svg.call(zoom);

  const linkSel = linkLayer.selectAll("line").data(data.links).enter().append("line")
    .attr("class", d => `link link-${d.kind}`)
    .attr("stroke-width", d => 0.4 + d.weight * 0.6);

  // Adjacency for fast neighbor lookup
  const adjacency = new Map();
  data.links.forEach(l => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    if (!adjacency.has(s)) adjacency.set(s, new Set());
    if (!adjacency.has(t)) adjacency.set(t, new Set());
    adjacency.get(s).add(t);
    adjacency.get(t).add(s);
  });

  let selectedId = null;

  const nodeSel = nodeLayer.selectAll("circle").data(data.nodes).enter().append("circle")
    .attr("class", "node")
    .attr("r", d => 2.4 + Math.sqrt(d.weight) * 1.6)
    .attr("fill", d => colorFor(d.hue))
    .attr("stroke", d => colorFor(d.hue, 0.9, 0.05))
    .attr("stroke-width", 0.6)
    .on("mouseover", (e, d) => showInfo(d, true))
    .on("mouseout", () => showInfo(null))
    .on("click", (e, d) => {
      e.stopPropagation();
      if (selectedId === d.id) { selectedId = null; clearHighlight(); pinned = null; showInfo(null); }
      else { selectedId = d.id; highlightNode(d); pinInfo(d); }
    })
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
        d3.select(event.sourceEvent.target).classed("dragging", true);
      })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d3.select(event.sourceEvent.target).classed("dragging", false);
        if (event.sourceEvent.shiftKey) {
          d.fx = null; d.fy = null;
          d3.select(event.sourceEvent.target).classed("pinned", false);
        } else {
          d3.select(event.sourceEvent.target).classed("pinned", true);
        }
      })
    );

  svg.on("click", () => {
    selectedId = null; pinned = null; clearHighlight(); showInfo(null);
  });

  function highlightNode(d) {
    const neighbors = adjacency.get(d.id) || new Set();
    nodeSel.classed("dim", n => n.id !== d.id && !neighbors.has(n.id))
           .classed("focus", n => n.id === d.id)
           .classed("neighbor", n => neighbors.has(n.id));
    linkSel.classed("active", l => (l.source.id === d.id || l.target.id === d.id))
           .classed("dim", l => !(l.source.id === d.id || l.target.id === d.id));
    labelSel.classed("visible", n => n.id === d.id || neighbors.has(n.id));
  }
  function clearHighlight() {
    nodeSel.classed("dim", false).classed("focus", false).classed("neighbor", false);
    linkSel.classed("active", false).classed("dim", false);
    labelSel.classed("visible", false);
  }

  const labelSel = labelLayer.selectAll("text").data(data.nodes).enter().append("text")
    .attr("class", "node-label")
    .attr("dy", -8)
    .text(d => d.label);

  // Force simulation
  const sim = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.links).id(d => d.id).distance(d => d.kind === "cross" ? 90 : 35).strength(d => d.kind === "cross" ? 0.05 : 0.5))
    .force("charge", d3.forceManyBody().strength(-22).distanceMax(280))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide().radius(d => 4 + Math.sqrt(d.weight)))
    .force("domain", domainCenterForce())
    .alphaDecay(0.03)
    .on("tick", ticked);

  // Domain centroid force pulls each node toward its domain's polar position
  function domainCenterForce() {
    const domains = KG.TAXONOMY.map(d => d.id);
    const centers = {};
    domains.forEach((id, i) => {
      const a = (i / domains.length) * Math.PI * 2 - Math.PI/2;
      centers[id] = { x: W/2 + Math.cos(a) * Math.min(W,H) * 0.28, y: H/2 + Math.sin(a) * Math.min(W,H) * 0.28 };
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

  function ticked() {
    linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    nodeSel.attr("cx", d => d.x).attr("cy", d => d.y);
    labelSel.attr("x", d => d.x).attr("y", d => d.y);
  }

  // Legend & filter
  const legend = document.getElementById("hb-legend");
  const filter = document.getElementById("hb-filter");
  const activeDomains = new Set(KG.TAXONOMY.map(d => d.id));

  KG.TAXONOMY.forEach(dom => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="dot" style="background:${colorFor(dom.hue)}"></span><span class="name">${dom.label}</span><span class="count">${KG.domains[dom.id].leafCount}</span>`;
    legend.appendChild(item);

    const chip = document.createElement("button");
    chip.className = "chip active";
    chip.dataset.id = dom.id;
    chip.innerHTML = `<span class="dot" style="background:${colorFor(dom.hue)}"></span>${dom.label}`;
    chip.onclick = () => {
      if (activeDomains.has(dom.id)) { activeDomains.delete(dom.id); chip.classList.remove("active"); }
      else { activeDomains.add(dom.id); chip.classList.add("active"); }
      applyFilter();
    };
    filter.appendChild(chip);
  });

  function applyFilter() {
    nodeSel.attr("opacity", d => activeDomains.has(d.domain) ? 1 : 0.05);
    linkSel.attr("opacity", d => activeDomains.has(d.source.domain) && activeDomains.has(d.target.domain) ? null : 0.02);
  }

  const crossBox = document.getElementById("hb-cross");
  const labelBox = document.getElementById("hb-labels");
  function applyCross() {
    const show = crossBox.checked;
    linkSel.attr("display", d => (!show && d.kind === "cross") ? "none" : null);
  }
  crossBox.checked = true; applyCross();
  crossBox.addEventListener("change", applyCross);
  labelBox.addEventListener("change", () => labelLayer.attr("opacity", labelBox.checked ? 1 : 0));

  // Info panel
  let pinned = null;
  const infoEl = document.getElementById("hb-selected");
  function showInfo(d) {
    if (!d && !pinned) { infoEl.innerHTML = `<div class="panel-empty">Hover a node to inspect.</div>`; return; }
    const target = d || pinned;
    const dom = KG.domains[target.domain];
    const cl = KG.clusters[target.cluster];
    const neighbors = data.links.filter(l =>
      (l.source.id === target.id || l.target.id === target.id)
    ).length;
    infoEl.innerHTML = `
      <div class="info-name" style="border-left-color:${colorFor(target.hue)}">${target.label}</div>
      <div class="info-meta">
        <div><span>Domain</span><b>${dom.label}</b></div>
        <div><span>Cluster</span><b>${cl.label}</b></div>
        <div><span>Edges</span><b>${neighbors}</b></div>
        <div><span>Weight</span><b>${target.weight}</b></div>
      </div>
    `;
  }
  function pinInfo(d) { pinned = d; showInfo(d); }

  const resetBtn = document.createElement("button");
  resetBtn.className = "panel-btn";
  resetBtn.textContent = "Release all pinned nodes";
  resetBtn.onclick = () => {
    data.nodes.forEach(n => { n.fx = null; n.fy = null; });
    nodeSel.classed("pinned", false);
    sim.alpha(0.6).restart();
  };
  side.appendChild(resetBtn);

  // Initial fit
  setTimeout(() => {
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(0.9));
  }, 200);
}
