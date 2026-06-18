// Adaptive abstraction: zoom-driven level switching with breadcrumb history.
// Levels: 0 = domains (continents) | 1 = clusters (cities) | 2 = leaves (streets)

import * as d3 from 'd3';
import { EnergyKG } from './data.js';

function colorFor(hue, l = 0.58, c = 0.15) { return `oklch(${l} ${c} ${hue})`; }

export function renderAdaptive(container) {
  container.innerHTML = "";
  const KG = EnergyKG;

  // O(1) edge lookups so renderLeaves doesn't do O(nodes × edges) scans
  const leafNodeById = Object.fromEntries(KG.leafNodes.map(n => [n.id, n]));
  const edgeIndex = new Map();
  KG.edges.forEach(e => {
    if (!edgeIndex.has(e.source)) edgeIndex.set(e.source, []);
    if (!edgeIndex.has(e.target)) edgeIndex.set(e.target, []);
    edgeIndex.get(e.source).push(e);
    edgeIndex.get(e.target).push(e);
  });

  const wrap = document.createElement("div");
  wrap.className = "view-wrap adaptive-wrap";
  container.appendChild(wrap);

  // ----- Side panel
  const side = document.createElement("aside");
  side.className = "side-panel";
  side.innerHTML = `
    <div class="panel-title">ADAPTIVE MAP</div>
    <div class="panel-sub">Granularity follows your focus.</div>
    <div class="panel-section">
      <div class="panel-h">Current Layer</div>
      <div id="ad-layer" class="layer-pill">DOMAINS · 0/3</div>
      <div class="layer-explain" id="ad-explain"></div>
    </div>
    <div class="panel-section">
      <div class="panel-h">Selection</div>
      <div id="ad-selected" class="panel-empty">Click any region to drill in.</div>
    </div>
    <div class="panel-section">
      <div class="panel-h">Navigation</div>
      <div class="hint-row"><span class="kbd">click</span> drill into a region</div>
      <div class="hint-row"><span class="kbd">scroll</span> zoom · auto-promotes layer</div>
      <div class="hint-row"><span class="kbd">esc</span> step up one layer</div>
    </div>
    <div class="panel-foot">Each layer recomputes on focus, like map tiles.</div>
  `;
  wrap.appendChild(side);

  // ----- Main canvas column
  const main = document.createElement("div");
  main.className = "adaptive-main";
  main.innerHTML = `
    <div class="breadcrumb-bar" id="ad-crumbs"></div>
    <div class="canvas-wrap" id="ad-canvas-wrap"></div>
    <div class="zoom-controls">
      <button id="ad-up" title="Step up">▲</button>
      <button id="ad-zoom-out" title="Zoom out">−</button>
      <button id="ad-zoom-in" title="Zoom in">+</button>
      <button id="ad-fit" title="Fit">◇</button>
    </div>
  `;
  wrap.appendChild(main);

  const canvasWrap = main.querySelector("#ad-canvas-wrap");
  const W = canvasWrap.clientWidth || 1100;
  const H = canvasWrap.clientHeight || 800;

  const svg = d3.select(canvasWrap).append("svg")
    .attr("class", "graph-svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${W} ${H}`);

  // Hairline grid
  const grid = svg.append("g").attr("class", "grid-bg map-grid");
  const gs = 50;
  for (let x = 0; x < W; x += gs) grid.append("line").attr("x1", x).attr("y1", 0).attr("x2", x).attr("y2", H);
  for (let y = 0; y < H; y += gs) grid.append("line").attr("x1", 0).attr("y1", y).attr("x2", W).attr("y2", y);
  // Compass rose
  const rose = svg.append("g").attr("class", "compass").attr("transform", `translate(${W - 56}, 56)`);
  rose.append("circle").attr("r", 22).attr("class", "rose-ring");
  rose.append("circle").attr("r", 1.5).attr("class", "rose-dot");
  rose.append("text").attr("y", -28).attr("text-anchor", "middle").attr("class", "rose-tick").text("N");

  const root = svg.append("g").attr("class", "zoom-root");
  const linkLayer = root.append("g").attr("class", "links");
  const nodeLayer = root.append("g").attr("class", "nodes");

  // ----- State
  let path = [];
  const history = [[]];
  let l2DrawFn = null;

  const zoom = d3.zoom().scaleExtent([0.5, 8]).on("zoom", (e) => {
    root.attr("transform", e.transform);
    maybeAutoDrill(e.transform.k);
    if (l2DrawFn) l2DrawFn(e.transform);
  });
  svg.call(zoom);

  function setPath(newPath, source) {
    path = newPath.slice();
    if (source !== "history") history.push(path.slice());
    svg.call(zoom.transform, d3.zoomIdentity);
    render();
  }

  function up() {
    if (path.length === 0) return;
    path = path.slice(0, -1);
    history.push(path.slice());
    render();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") up();
  });

  main.querySelector("#ad-up").onclick = up;
  main.querySelector("#ad-zoom-in").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.4);
  main.querySelector("#ad-zoom-out").onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1/1.4);
  main.querySelector("#ad-fit").onclick = () => svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);

  let lastHoveredRegion = null;
  let lastDrillAt = 0;
  function maybeAutoDrill(k) {
    if (k > 4 && lastHoveredRegion && Date.now() - lastDrillAt > 800 && path.length < 2) {
      lastDrillAt = Date.now();
      drillInto(lastHoveredRegion);
    }
  }

  function drillInto(regionId) {
    svg.transition().duration(180).call(zoom.transform, d3.zoomIdentity);
    if (path.length === 0) {
      setPath([regionId]);
    } else if (path.length === 1) {
      setPath([path[0], regionId]);
    }
  }

  // ----- Render dispatcher
  function render() {
    l2DrawFn = null;
    canvasWrap.querySelector('.l2-canvas')?.remove();
    canvasWrap.querySelector('.conn-panel')?.remove();
    svg.on("click.l2", null).on("mousedown.l2drag", null).on("mousemove.l2drag", null).on("mouseup.l2drag", null);
    linkLayer.selectAll("*").remove();
    nodeLayer.selectAll("*").remove();

    const level = path.length;
    updateChrome(level);

    if (level === 0) renderDomains();
    else if (level === 1) renderClusters(path[0]);
    else renderLeaves(path[0], path[1]);
  }

  function updateChrome(level) {
    const labels = ["DOMAINS · L0", "CLUSTERS · L1", "LEAVES · L2"];
    const explain = [
      "Continent layer · 7 domains",
      "City layer · clusters within " + (KG.domains[path[0]]?.label || "domain"),
      "Street layer · datasets within " + (KG.clusters[path[1]]?.label || "cluster")
    ];
    document.getElementById("ad-layer").textContent = labels[level];
    document.getElementById("ad-explain").textContent = explain[level];

    const crumbs = document.getElementById("ad-crumbs");
    crumbs.innerHTML = "";
    const items = [{ label: "All domains", target: [] }];
    if (path.length >= 1) items.push({ label: KG.domains[path[0]].label, target: [path[0]] });
    if (path.length >= 2) items.push({ label: KG.clusters[path[1]].label, target: path.slice() });

    items.forEach((it, i) => {
      const c = document.createElement("button");
      c.className = "crumb" + (i === items.length - 1 ? " current" : "");
      c.textContent = it.label;
      c.onclick = () => setPath(it.target);
      crumbs.appendChild(c);
      if (i < items.length - 1) {
        const sep = document.createElement("span");
        sep.className = "crumb-sep";
        sep.textContent = "›";
        crumbs.appendChild(sep);
      }
    });

    if (history.length > 1) {
      const trail = document.createElement("div");
      trail.className = "history-trail";
      trail.innerHTML = `<span class="trail-label">visited</span>`;
      // Show last 4 unique locations (excluding current state)
      const unique = [];
      const seenKeys = new Set([path.join(',')]);
      for (let i = history.length - 2; i >= 0 && unique.length < 4; i--) {
        const p = history[i];
        const key = p.join(',');
        if (!seenKeys.has(key)) { seenKeys.add(key); unique.push(p); }
      }
      unique.forEach(p => {
        const name = p.length === 0 ? 'All Domains'
          : p.length === 1 ? KG.domains[p[0]]?.label
          : KG.clusters[p[1]]?.label;
        if (!name) return;
        const btn = document.createElement("button");
        btn.className = "crumb";
        btn.textContent = name.length > 22 ? name.slice(0, 21) + '…' : name;
        btn.title = p.length <= 1 ? (KG.domains[p[0]]?.label || 'All Domains')
          : KG.domains[p[0]]?.label + ' › ' + KG.clusters[p[1]]?.label;
        btn.onclick = () => setPath(p, "history");
        trail.appendChild(btn);
      });
      if (unique.length) crumbs.appendChild(trail);
    }
  }

  // ===== Shared bubble layout =====
  function layoutBubbles(items, opts) {
    const padding = (opts && opts.padding) || 50;
    const minR = (opts && opts.minR) || 40;
    const maxR = (opts && opts.maxR) || 130;
    const sizes = items.map(i => i.weight || 1);
    const sMin = Math.min(...sizes), sMax = Math.max(...sizes);
    const scale = sMax === sMin
      ? () => (minR + maxR) / 2
      : d3.scaleSqrt().domain([sMin, sMax]).range([minR, maxR]);
    const N = items.length;
    const ringR = Math.min(W, H) * 0.22;
    const nodes = items.map((it, i) => {
      const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
      return {
        ...it,
        r: scale(it.weight || 1),
        x: W/2 + Math.cos(angle) * ringR + (Math.random()-0.5)*4,
        y: H/2 + Math.sin(angle) * ringR + (Math.random()-0.5)*4
      };
    });
    const sim = d3.forceSimulation(nodes)
      .force("collide", d3.forceCollide(d => d.r + 14).iterations(8))
      .force("x", d3.forceX(W/2).strength(0.05))
      .force("y", d3.forceY(H/2).strength(0.07))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    nodes.forEach(n => {
      n.x = Math.max(n.r + padding/2, Math.min(W - n.r - padding/2, n.x));
      n.y = Math.max(n.r + padding/2, Math.min(H - n.r - padding/2, n.y));
    });
    return nodes;
  }

  function fitLabel(text, radius) {
    const maxFont = Math.max(11, Math.min(20, radius * 0.22));
    const maxChars = Math.floor((radius * 1.7) / (maxFont * 0.55));
    if (text.length <= maxChars) return { text, font: maxFont };
    const words = text.split(" ");
    if (words.length > 1) {
      const half = Math.ceil(words.length / 2);
      const l1 = words.slice(0, half).join(" ");
      const l2 = words.slice(half).join(" ");
      const longer = Math.max(l1.length, l2.length);
      if (longer <= maxChars) return { lines: [l1, l2], font: maxFont };
    }
    return { text: text.slice(0, maxChars - 1) + "…", font: maxFont };
  }

  // ===== Layer renderers =====
  function renderDomains() {
    const items = KG.TAXONOMY.map(d => ({
      id: d.id, label: d.label, hue: d.hue,
      weight: KG.domains[d.id].leafCount,
      clusterCount: KG.domains[d.id].clusterIds.length
    }));

    const placed = layoutBubbles(items, { minR: 70, maxR: 150, padding: 40 });
    const byId = {}; placed.forEach(p => byId[p.id] = p);

    const linkData = KG.domainLinks.map(l => {
      const a = byId[l.source.replace("dom:", "")];
      const b = byId[l.target.replace("dom:", "")];
      return a && b ? { a, b, w: l.weight } : null;
    }).filter(Boolean);

    linkLayer.selectAll("path").data(linkData).enter().append("path")
      .attr("class", "agg-link")
      .attr("stroke-width", d => Math.min(6, 0.6 + Math.log2(d.w)))
      .attr("d", d => {
        const mx = (d.a.x + d.b.x) / 2, my = (d.a.y + d.b.y) / 2 - Math.abs(d.b.x - d.a.x) * 0.1;
        return `M${d.a.x},${d.a.y} Q${mx},${my} ${d.b.x},${d.b.y}`;
      });

    const g = nodeLayer.selectAll("g.region").data(placed).enter().append("g")
      .attr("class", "region region-domain")
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => { lastHoveredRegion = d.id; highlight(d); selectInfo(d, "domain"); })
      .on("mouseleave", () => { lastHoveredRegion = null; clearHighlight(); })
      .on("click", (e, d) => drillInto(d.id));

    g.append("circle").attr("r", d => d.r).attr("class", "region-bg")
      .attr("fill", d => `oklch(0.96 0.035 ${d.hue})`)
      .attr("stroke", d => colorFor(d.hue, 0.55, 0.14));

    g.each(function (d) {
      const grp = d3.select(this);
      const clusters = KG.domains[d.id].clusterIds;
      clusters.forEach((cid, i) => {
        const a = (i / clusters.length) * Math.PI * 2 - Math.PI / 2;
        const rr = d.r * 0.6;
        grp.append("circle")
          .attr("cx", Math.cos(a) * rr).attr("cy", Math.sin(a) * rr)
          .attr("r", Math.max(2.5, d.r * 0.045))
          .attr("class", "tex-dot")
          .attr("fill", colorFor(d.hue));
      });
    });

    g.each(function (d) {
      const grp = d3.select(this);
      const fit = fitLabel(d.label, d.r);
      const label = grp.append("text").attr("class", "region-label").attr("text-anchor", "middle")
        .attr("font-size", fit.font);
      if (fit.lines) {
        label.attr("dy", -fit.font * 0.6);
        fit.lines.forEach((ln, i) => {
          label.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : fit.font * 1.05).text(ln);
        });
      } else {
        label.attr("dy", "-0.2em").text(fit.text);
      }
      const metaY = fit.lines ? fit.font * 1.2 : fit.font * 0.9;
      grp.append("text").attr("class", "region-meta").attr("text-anchor", "middle")
        .attr("y", metaY)
        .text(`${d.clusterCount} clusters · ${d.weight} datasets`);
    });
  }

  function renderClusters(domainId) {
    const dom = KG.domains[domainId];
    const items = dom.clusterIds.map(cid => {
      const c = KG.clusters[cid];
      return { id: cid, label: c.label, hue: c.hue, weight: c.leafCount };
    });

    const placed = layoutBubbles(items, { minR: 55, maxR: 130, padding: 40 });
    const byId = {}; placed.forEach(p => byId[p.id] = p);

    const linkData = KG.clusterLinks.map(l => {
      const sa = l.source.replace("cl:", "");
      const sb = l.target.replace("cl:", "");
      if (KG.clusters[sa].domain !== domainId || KG.clusters[sb].domain !== domainId) return null;
      const a = byId[sa], b = byId[sb];
      return a && b ? { a, b, w: l.weight } : null;
    }).filter(Boolean);

    linkLayer.selectAll("path").data(linkData).enter().append("path")
      .attr("class", "agg-link")
      .attr("stroke-width", d => Math.min(5, 0.4 + Math.log2(d.w + 1)))
      .attr("d", d => {
        const mx = (d.a.x + d.b.x) / 2, my = (d.a.y + d.b.y) / 2 - 30;
        return `M${d.a.x},${d.a.y} Q${mx},${my} ${d.b.x},${d.b.y}`;
      });

    const g = nodeLayer.selectAll("g.region").data(placed).enter().append("g")
      .attr("class", "region region-cluster")
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer")
      .on("mouseenter", (e, d) => { lastHoveredRegion = d.id; highlight(d); selectInfo(d, "cluster"); })
      .on("mouseleave", () => { lastHoveredRegion = null; clearHighlight(); })
      .on("click", (e, d) => drillInto(d.id));

    g.append("circle").attr("r", d => d.r).attr("class", "region-bg")
      .attr("fill", d => `oklch(0.96 0.04 ${d.hue})`)
      .attr("stroke", d => colorFor(d.hue, 0.55, 0.14));

    g.each(function (d) {
      const grp = d3.select(this);
      const n = Math.min(d.weight, 18);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = d.r * (0.45 + (i % 3) * 0.12);
        grp.append("circle").attr("cx", Math.cos(a) * rr).attr("cy", Math.sin(a) * rr)
          .attr("r", 1.6).attr("fill", colorFor(d.hue, 0.78, 0.1)).attr("opacity", 0.7);
      }
    });

    g.each(function (d) {
      const grp = d3.select(this);
      const fit = fitLabel(d.label, d.r);
      const label = grp.append("text").attr("class", "region-label").attr("text-anchor", "middle")
        .attr("font-size", fit.font);
      if (fit.lines) {
        label.attr("dy", -fit.font * 0.6);
        fit.lines.forEach((ln, i) => label.append("tspan").attr("x", 0).attr("dy", i === 0 ? 0 : fit.font * 1.05).text(ln));
      } else {
        label.attr("dy", "-0.1em").text(fit.text);
      }
      grp.append("text").attr("class", "region-meta").attr("text-anchor", "middle")
        .attr("y", (fit.lines ? fit.font * 1.2 : fit.font * 0.9))
        .text(`${d.weight} datasets`);
    });
  }

  function renderLeaves(domainId, clusterId) {
    const leaves = KG.leafNodes.filter(n => n.cluster === clusterId).map(n => ({ ...n, _ghost: false }));
    const leafIds = new Set(leaves.map(n => n.id));

    const links = KG.edges
      .filter(e => leafIds.has(e.source) && leafIds.has(e.target))
      .map(e => ({ ...e, _external: false }));

    // Build ghost entries using O(1) leafNodeById lookup instead of Array.find per edge
    const externalByCluster = {};
    KG.edges.forEach(e => {
      const inS = leafIds.has(e.source), inT = leafIds.has(e.target);
      if (inS === inT) return;
      const localId = inS ? e.source : e.target;
      const remoteId = inS ? e.target : e.source;
      const remoteNode = leafNodeById[remoteId];
      if (!remoteNode) return;
      const rc = remoteNode.cluster;
      if (!externalByCluster[rc]) externalByCluster[rc] = { count: 0, locals: new Set(), hue: remoteNode.hue, domain: remoteNode.domain };
      externalByCluster[rc].count++;
      externalByCluster[rc].locals.add(localId);
    });

    const ghostEntries = Object.entries(externalByCluster);
    ghostEntries.forEach(([rc, info], i) => {
      const a = (i / Math.max(ghostEntries.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = Math.min(W, H) * 0.42;
      const gx = W / 2 + Math.cos(a) * radius;
      const gy = H / 2 + Math.sin(a) * radius;
      const ghost = {
        id: "ghost:" + rc,
        label: KG.clusters[rc].label,
        domain: info.domain,
        cluster: rc,
        hue: info.hue,
        weight: Math.max(2, Math.log2(info.count + 1) * 2),
        _ghost: true,
        _count: info.count,
        fx: gx, fy: gy,
        x: gx, y: gy
      };
      leaves.push(ghost);
      info.locals.forEach(lid => {
        links.push({ source: lid, target: ghost.id, _external: true, weight: 0.4 });
      });
    });

    // Build adj while source/target are still string IDs (before forceLink resolves them)
    const adj = new Map();
    links.forEach(l => {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source).add(l.target);
      adj.get(l.target).add(l.source);
    });

    // Use edgeIndex (built at module init) to avoid O(leaves × total_edges) scan
    let selectedLeaf = null;
    const externalNeighborsOf = {};
    const externalDegree = {};
    leaves.forEach(n => {
      if (n._ghost) return;
      const ext = [];
      (edgeIndex.get(n.id) || []).forEach(e => {
        const other = e.source === n.id ? e.target : e.source;
        if (!leafIds.has(other)) {
          const node = leafNodeById[other];
          if (node) ext.push(node);
        }
      });
      externalNeighborsOf[n.id] = ext;
      externalDegree[n.id] = ext.length;
    });

    const sim = d3.forceSimulation(leaves)
      .force("link", d3.forceLink(links).id(d => d.id).distance(50).strength(0.5))
      .force("charge", d3.forceManyBody().strength(-160))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide().radius(22))
      .alphaDecay(0.06);

    // ----- Canvas setup (overlaid on SVG, pointer-events:none so SVG zoom still works)
    const l2Canvas = document.createElement("canvas");
    l2Canvas.className = "l2-canvas";
    l2Canvas.width = W;
    l2Canvas.height = H;
    l2Canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:4;";
    canvasWrap.appendChild(l2Canvas);
    const ctx = l2Canvas.getContext("2d");

    // Precompute node radius for hit-testing
    const nodeR = n => n._ghost ? 9 + Math.sqrt(n.weight) * 1.6 : 6 + Math.sqrt(n.weight);

    function draw(xform) {
      const t = xform || d3.zoomTransform(svg.node());
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);
      const inv_k = 1 / t.k;
      const hasSel = selectedLeaf !== null;
      const nb = hasSel ? (adj.get(selectedLeaf) || new Set()) : null;

      // --- Links ---
      const lw = inv_k;

      // Internal links: dim pass (when selection active)
      if (hasSel) {
        ctx.globalAlpha = 0.06;
        ctx.strokeStyle = "#8b9199";
        ctx.lineWidth = lw;
        ctx.setLineDash([]);
        ctx.beginPath();
        for (const l of links) {
          if (l._external) continue;
          if (l.source.id === selectedLeaf || l.target.id === selectedLeaf) continue;
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
        }
        ctx.stroke();
      }

      // Internal links: active or normal
      ctx.globalAlpha = hasSel ? 0.7 : 0.32;
      ctx.strokeStyle = "#8b9199";
      ctx.lineWidth = lw;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (const l of links) {
        if (l._external) continue;
        if (hasSel && l.source.id !== selectedLeaf && l.target.id !== selectedLeaf) continue;
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
      }
      ctx.stroke();

      // External links (to ghosts)
      ctx.globalAlpha = 0.40;
      ctx.strokeStyle = "#8b9199";
      ctx.lineWidth = lw;
      ctx.setLineDash([3 * inv_k, 3 * inv_k]);
      ctx.beginPath();
      for (const l of links) {
        if (!l._external) continue;
        if (l.source.x == null || l.target.x == null) continue;
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // --- Nodes ---
      for (const n of leaves) {
        const r = nodeR(n);
        let alpha = 1;
        if (!n._ghost && hasSel) {
          alpha = n.id === selectedLeaf ? 1 : (nb.has(n.id) ? 0.75 : 0.1);
        }
        ctx.globalAlpha = alpha;

        if (n._ghost) {
          // Dashed circle
          ctx.strokeStyle = colorFor(n.hue, 0.65, 0.12);
          ctx.lineWidth = 1.5 * inv_k;
          ctx.setLineDash([3 * inv_k, 3 * inv_k]);
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // Ghost label
          const labelY = n.y + r + 5 * inv_k;
          ctx.fillStyle = colorFor(n.hue, 0.55, 0.12);
          ctx.font = `${11 * inv_k}px "Space Grotesk",system-ui`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(`→ ${n.label}`, n.x, labelY);
          ctx.fillStyle = "#8b9199";
          ctx.font = `${10 * inv_k}px "Space Grotesk",system-ui`;
          ctx.fillText(`${n._count} link${n._count === 1 ? "" : "s"}`, n.x, labelY + 14 * inv_k);
        } else {
          const isSel = n.id === selectedLeaf;
          const rr = r + (isSel ? 2 * inv_k : 0);
          ctx.fillStyle = colorFor(n.hue, 0.62, 0.15);
          ctx.strokeStyle = colorFor(n.hue, 0.88, 0.04);
          ctx.lineWidth = inv_k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // Ext-degree badge
          const extD = externalDegree[n.id];
          if (extD > 0) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = "#ffffff";
            ctx.font = `bold ${9 * inv_k}px "JetBrains Mono",monospace`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeStyle = "rgba(20,30,45,0.4)";
            ctx.lineWidth = 0.6 * inv_k;
            ctx.strokeText(extD > 99 ? "99+" : String(extD), n.x, n.y);
            ctx.fillText(extD > 99 ? "99+" : String(extD), n.x, n.y);
          }
          // Leaf label (only when zoomed in enough)
          if (t.k > 0.4) {
            const labelAlpha = alpha * Math.min(1, (t.k - 0.3) / 0.5);
            ctx.globalAlpha = labelAlpha;
            ctx.fillStyle = "#1b1e23";
            ctx.font = `${10 * inv_k}px "Space Grotesk",system-ui`;
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(n.label.length > 24 ? n.label.slice(0, 22) + "…" : n.label,
              n.x, n.y - rr - 2 * inv_k);
          }
        }
      }

      ctx.restore();
      ctx.globalAlpha = 1;
    }

    l2DrawFn = draw;
    sim.on("tick", () => draw());

    // ----- connPanel (HTML, unchanged)
    let connPanel = canvasWrap.querySelector(".conn-panel");
    if (!connPanel) {
      connPanel = document.createElement("div");
      connPanel.className = "conn-panel";
      canvasWrap.appendChild(connPanel);
    }
    connPanel.style.display = "none";

    function highlightLeaf(d) {
      selectedLeaf = d.id;
      const nb = adj.get(d.id) || new Set();
      draw();

      const internal = leaves.filter(n => !n._ghost && nb.has(n.id));
      const external = externalNeighborsOf[d.id] || [];
      const byCluster = {};
      external.forEach(n => {
        if (!byCluster[n.cluster]) byCluster[n.cluster] = { hue: n.hue, domain: n.domain, items: [] };
        byCluster[n.cluster].items.push(n);
      });

      const intHtml = internal.map(n =>
        `<li class="conn-item" data-jump-internal="${n.id}">
           <span class="conn-dot" style="background:${colorFor(n.hue)}"></span>
           <span class="conn-name" title="${n.title || n.label}">${n.label}</span>
         </li>`).join("") || `<li class="conn-empty">No intra-cluster links.</li>`;

      const extGroupsHtml = Object.entries(byCluster).map(([cid, info]) => {
        const cl = KG.clusters[cid];
        const dom = KG.domains[info.domain];
        const items = info.items.map(n =>
          `<li class="conn-item" data-jump-cluster="${cid}">
             <span class="conn-dot" style="background:${colorFor(info.hue)}"></span>
             <span class="conn-name" title="${n.title || n.label}">${n.label}</span>
           </li>`).join("");
        return `<div class="conn-group">
          <div class="conn-group-h">
            <span class="conn-dot lg" style="background:${colorFor(info.hue)}"></span>
            <div>
              <div class="conn-group-cl">${cl.label}</div>
              <div class="conn-group-dom">${dom.label} · ${info.items.length} link${info.items.length === 1 ? "" : "s"}</div>
            </div>
            <button class="conn-jump" data-jump-cluster="${cid}">↗</button>
          </div>
          <ul class="conn-list">${items}</ul>
        </div>`;
      }).join("") || `<div class="conn-empty pad">No cross-cluster links.</div>`;

      connPanel.style.display = "flex";
      connPanel.innerHTML = `
        <div class="conn-head">
          <div class="conn-title" style="border-left-color:${colorFor(d.hue)}">
            <div class="conn-name-lg" title="${d.title || d.label}">${d.title || d.label}</div>
            <div class="conn-meta-row">
              <span>${KG.clusters[d.cluster].label}</span>
              <span class="sep">·</span>
              <span>${nb.size} internal</span>
              <span class="sep">·</span>
              <span class="ext">${external.length} external</span>
            </div>
          </div>
          <button class="conn-close" title="Close">×</button>
        </div>
        <div class="conn-body">
          <div class="conn-section">
            <div class="conn-section-h">Cross-cluster connections</div>
            ${extGroupsHtml}
          </div>
          <div class="conn-section">
            <div class="conn-section-h">Within this cluster</div>
            <ul class="conn-list">${intHtml}</ul>
          </div>
        </div>
      `;
      connPanel.querySelector(".conn-close").onclick = () => {
        selectedLeaf = null; draw(); connPanel.style.display = "none";
      };
      connPanel.querySelectorAll("[data-jump-cluster]").forEach(el => {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const cid = el.getAttribute("data-jump-cluster");
          const dom = KG.clusters[cid].domain;
          setPath([dom, cid]);
        });
      });
      connPanel.querySelectorAll("[data-jump-internal]").forEach(el => {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const targetId = el.getAttribute("data-jump-internal");
          const targetNode = leaves.find(n => n.id === targetId);
          if (targetNode) highlightLeaf(targetNode);
        });
      });
    }

    // ----- Mouse interaction on the SVG (canvas has pointer-events:none)
    // Pointer is taken relative to svg.node() so it matches the zoom transform's
    // coordinate space (viewBox-aware via getScreenCTM).
    function worldPt(event) {
      const t = d3.zoomTransform(svg.node());
      const [px, py] = d3.pointer(event, svg.node());
      return [t.invertX(px), t.invertY(py)];
    }
    // Hit-test against each node's true radius plus a constant ~4px screen
    // tolerance. The tolerance is divided by k so it stays 4px at any zoom,
    // while the radius term keeps the clickable area matched to the drawn node.
    function findLeafAt(event) {
      const [wx, wy] = worldPt(event);
      const t = d3.zoomTransform(svg.node());
      const slop = 4 / t.k;
      let best = null, bestD = Infinity;
      for (const n of leaves) {
        if (n.x == null) continue;
        const r = nodeR(n) + slop;
        const dx = n.x - wx, dy = n.y - wy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r * r && d2 < bestD) { bestD = d2; best = n; }
      }
      return best;
    }

    let dragging = null, downPt = null, dragMoved = false, suppressClick = false;

    svg.on("click.l2", (event) => {
      if (suppressClick) { suppressClick = false; return; } // ignore click that ends a drag
      const n = findLeafAt(event);
      if (!n) { selectedLeaf = null; draw(); if (connPanel) connPanel.style.display = "none"; return; }
      if (n._ghost) { setPath([n.domain, n.cluster]); return; }
      if (selectedLeaf === n.id) { selectedLeaf = null; draw(); connPanel.style.display = "none"; }
      else { highlightLeaf(n); selectInfo(n, "leaf"); }
    });

    // Drag support via SVG mouse events
    svg.on("mousedown.l2drag", (event) => {
      const n = findLeafAt(event);
      if (!n || n._ghost) return;
      event.preventDefault();
      dragging = n; dragMoved = false; downPt = worldPt(event);
      if (!event.active) sim.alphaTarget(0.3).restart();
      n.fx = n.x; n.fy = n.y;
    });
    svg.on("mousemove.l2drag", (event) => {
      if (!dragging) return;
      const [wx, wy] = worldPt(event);
      if (!dragMoved) {
        const t = d3.zoomTransform(svg.node());
        const dx = wx - downPt[0], dy = wy - downPt[1];
        if ((dx * dx + dy * dy) * t.k * t.k > 9) dragMoved = true; // >3px on screen
      }
      if (dragMoved) { dragging.fx = wx; dragging.fy = wy; }
    });
    svg.on("mouseup.l2drag", (event) => {
      if (!dragging) return;
      sim.alphaTarget(0);
      if (event.shiftKey) { dragging.fx = null; dragging.fy = null; }
      if (dragMoved) suppressClick = true; // a real drag — don't let the click select
      dragging = null;
    });

    // Clean up SVG event namespaces when navigating away
    l2DrawFn = (xform) => { draw(xform); };
  }

  // ----- Interactions
  function highlight(d) {
    nodeLayer.selectAll("g.region").classed("dim", x => x !== d).classed("focus", x => x === d);
    linkLayer.selectAll("path.agg-link").attr("opacity", l => (l.a === d || l.b === d) ? 0.9 : 0.15);
  }
  function clearHighlight() {
    nodeLayer.selectAll("g.region").classed("dim", false).classed("focus", false);
    linkLayer.selectAll("path.agg-link").attr("opacity", null);
  }

  function selectInfo(item, kind) {
    const el = document.getElementById("ad-selected");
    const dom = kind === "domain" ? KG.domains[item.id] : (kind === "cluster" ? KG.domains[KG.clusters[item.id].domain] : KG.domains[item.domain]);
    const cl = kind === "cluster" ? KG.clusters[item.id] : (kind === "leaf" ? KG.clusters[item.cluster] : null);
    const swatch = colorFor(item.hue);
    el.innerHTML = `
      <div class="info-name" style="border-left-color:${swatch}">${kind === "leaf" ? (item.title || item.label) : (item.label || cl?.label)}</div>
      <div class="info-meta">
        <div><span>Layer</span><b>${kind.toUpperCase()}</b></div>
        ${dom ? `<div><span>Domain</span><b>${dom.label}</b></div>` : ""}
        ${cl ? `<div><span>Cluster</span><b>${cl.label}</b></div>` : ""}
        ${item.weight ? `<div><span>Size</span><b>${item.weight}</b></div>` : ""}
      </div>
      ${kind !== "leaf" ? `<button class="drill-btn" id="drill-now">Drill into ${item.label}</button>` : ""}
    `;
    const btn = el.querySelector("#drill-now");
    if (btn) btn.onclick = () => drillInto(item.id);
  }

  render();
}
