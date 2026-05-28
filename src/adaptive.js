// Adaptive abstraction: zoom-driven level switching with breadcrumb history.
// Levels: 0 = domains (continents) | 1 = clusters (cities) | 2 = leaves (streets)

import * as d3 from 'd3';
import { EnergyKG } from './data.js';

function colorFor(hue, l = 0.72, c = 0.13) { return `oklch(${l} ${c} ${hue})`; }

export function renderAdaptive(container) {
  container.innerHTML = "";
  const KG = EnergyKG;

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

  const zoom = d3.zoom().scaleExtent([0.5, 8]).on("zoom", (e) => {
    root.attr("transform", e.transform);
    maybeAutoDrill(e.transform.k);
  });
  svg.call(zoom);

  function setPath(newPath, source) {
    path = newPath.slice();
    if (source !== "history") history.push(path.slice());
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
      trail.innerHTML = `<span class="trail-label">history</span>`;
      history.slice(-6).forEach((p) => {
        const dot = document.createElement("span");
        dot.className = "trail-dot d" + p.length;
        dot.title = p.length === 0 ? "All" : (p.length === 1 ? KG.domains[p[0]].label : KG.domains[p[0]].label + " › " + KG.clusters[p[1]].label);
        trail.appendChild(dot);
      });
      crumbs.appendChild(trail);
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
      .attr("fill", d => `oklch(0.22 0.04 ${d.hue})`)
      .attr("stroke", d => colorFor(d.hue, 0.7, 0.13));

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
      .attr("fill", d => `oklch(0.24 0.045 ${d.hue})`)
      .attr("stroke", d => colorFor(d.hue, 0.7, 0.13));

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
    const cl = KG.clusters[clusterId];
    const leaves = KG.leafNodes.filter(n => n.cluster === clusterId).map(n => ({ ...n, _ghost: false }));
    const leafIds = new Set(leaves.map(n => n.id));

    const links = KG.edges
      .filter(e => leafIds.has(e.source) && leafIds.has(e.target))
      .map(e => ({ ...e, _external: false }));

    const externalByCluster = {};
    KG.edges.forEach(e => {
      const inS = leafIds.has(e.source), inT = leafIds.has(e.target);
      if (inS === inT) return;
      const localId = inS ? e.source : e.target;
      const remoteId = inS ? e.target : e.source;
      const remoteNode = KG.leafNodes.find(n => n.id === remoteId);
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

    const adj = new Map();
    links.forEach(l => {
      if (!adj.has(l.source)) adj.set(l.source, new Set());
      if (!adj.has(l.target)) adj.set(l.target, new Set());
      adj.get(l.source).add(l.target);
      adj.get(l.target).add(l.source);
    });

    let selectedLeaf = null;
    const externalNeighborsOf = {};
    const externalDegree = {};
    leaves.forEach(n => {
      if (n._ghost) return;
      const ext = [];
      KG.edges.forEach(e => {
        let other = null;
        if (e.source === n.id && !leafIds.has(e.target)) other = e.target;
        else if (e.target === n.id && !leafIds.has(e.source)) other = e.source;
        if (other) {
          const node = KG.leafNodes.find(x => x.id === other);
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

    const linkSel = linkLayer.selectAll("line").data(links).enter().append("line")
      .attr("class", d => "leaf-link" + (d._external ? " external" : ""));

    const g = nodeLayer.selectAll("g.leaf").data(leaves).enter().append("g")
      .attr("class", d => "leaf" + (d._ghost ? " ghost" : ""))
      .style("cursor", d => d._ghost ? "pointer" : "grab")
      .on("mouseenter", (e, d) => selectInfo(d, "leaf"))
      .on("click", (e, d) => {
        e.stopPropagation();
        if (d._ghost) {
          setPath([d.domain, d.cluster]);
          return;
        }
        if (selectedLeaf === d.id) { selectedLeaf = null; clearLeafHL(); }
        else { selectedLeaf = d.id; highlightLeaf(d); selectInfo(d, "leaf"); }
      })
      .call(d3.drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          if (event.sourceEvent.shiftKey) { d.fx = null; d.fy = null; }
        })
      );

    svg.on("click.leaf", () => { selectedLeaf = null; clearLeafHL(); });

    g.append("circle").attr("r", d => d._ghost ? 9 + Math.sqrt(d.weight) * 1.6 : 6 + Math.sqrt(d.weight))
      .attr("fill", d => d._ghost ? "transparent" : colorFor(d.hue))
      .attr("stroke", d => colorFor(d.hue, d._ghost ? 0.75 : 0.9, d._ghost ? 0.12 : 0.04))
      .attr("stroke-width", d => d._ghost ? 1.5 : 1)
      .attr("stroke-dasharray", d => d._ghost ? "3 3" : null);

    g.filter(d => !d._ghost && externalDegree[d.id] > 0)
      .append("text")
      .attr("class", "ext-badge")
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .text(d => externalDegree[d.id]);

    g.append("text").attr("class", d => "leaf-label" + (d._ghost ? " ghost-label" : ""))
      .attr("dy", d => d._ghost ? 4 : -12)
      .attr("text-anchor", "middle")
      .text(d => d._ghost ? `→ ${d.label}` : d.label);
    g.filter(d => d._ghost).append("text")
      .attr("class", "ghost-count")
      .attr("dy", d => 18)
      .attr("text-anchor", "middle")
      .text(d => `${d._count} link${d._count === 1 ? "" : "s"}`);

    let connPanel = canvasWrap.querySelector(".conn-panel");
    if (!connPanel) {
      connPanel = document.createElement("div");
      connPanel.className = "conn-panel";
      canvasWrap.appendChild(connPanel);
    }
    connPanel.style.display = "none";

    function highlightLeaf(d) {
      const nb = adj.get(d.id) || new Set();
      g.classed("dim", n => n.id !== d.id && !nb.has(n.id))
       .classed("focus", n => n.id === d.id);
      linkSel.classed("active", l => l.source.id === d.id || l.target.id === d.id)
             .classed("dim", l => !(l.source.id === d.id || l.target.id === d.id));

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
           <span class="conn-name">${n.label}</span>
         </li>`).join("") || `<li class="conn-empty">No intra-cluster links.</li>`;

      const extGroupsHtml = Object.entries(byCluster).map(([cid, info]) => {
        const cl = KG.clusters[cid];
        const dom = KG.domains[info.domain];
        const items = info.items.map(n =>
          `<li class="conn-item" data-jump-cluster="${cid}">
             <span class="conn-dot" style="background:${colorFor(info.hue)}"></span>
             <span class="conn-name">${n.label}</span>
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
            <div class="conn-name-lg">${d.label}</div>
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
        selectedLeaf = null; clearLeafHL();
      };
      connPanel.querySelectorAll("[data-jump-cluster]").forEach(el => {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const cid = el.getAttribute("data-jump-cluster");
          const dom = KG.clusters[cid].domain;
          setPath([dom, cid]);
        });
      });
    }
    function clearLeafHL() {
      g.classed("dim", false).classed("focus", false);
      linkSel.classed("active", false).classed("dim", false);
      if (connPanel) connPanel.style.display = "none";
    }

    sim.on("tick", () => {
      linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      g.attr("transform", d => `translate(${d.x},${d.y})`);
    });
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
      <div class="info-name" style="border-left-color:${swatch}">${item.label || cl?.label}</div>
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
