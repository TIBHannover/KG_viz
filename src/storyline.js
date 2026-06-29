// Storyline Trail — block-cascade view (launched from the Sensemaking egonet).
//
// Each BLOCK is rooted at a focal dataset and reads top-down:
//     TOPIC (head) → a vertical list of CONNECTORS (shared vias) → each connector
//     links across to a SCROLLABLE DATASET TABLE (the linked datasets).
// Clicking a dataset row spawns a new block to the RIGHT, rooted at that dataset,
// with an edge back to the row it came from. Counts are real — every shared via
// is shown, and every linked dataset sits in its (scrolling) table.
//
// No "inference" framing — every connector/edge is a stated catalog relationship.

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : (s || ''));
const attrEsc = s => String(s).replace(/["\\]/g, '\\$&');
function colorFor(hue, l = 0.58, c = 0.15) { return `oklch(${l} ${c} ${hue})`; }

const PROP_META = {
  author:  { label: 'Author',    glyph: '✎' },
  keyword: { label: 'Keyword',   glyph: '#' },
  contact: { label: 'Contact',   glyph: '✉' },
  doi:     { label: 'Cited DOI', glyph: '◈' },
};
const metaOf = p => PROP_META[p] || { label: p || 'link', glyph: '·' };
const vkStr = v => (v.prop || '') + '' + (v.value || '');

export function openStoryline(host, seed, ctx) {
  const { KG, nodeById, degree, adjacency } = ctx;

  host.querySelector('.st-trail')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'st-trail';
  overlay.innerHTML = `
    <div class="st-trail-head">
      <span class="st-trail-title">STORYLINE TRAIL</span>
      <span class="st-trail-seed"></span>
      <span class="st-trail-hint">click a dataset row to branch right →</span>
      <button class="st-trail-close" title="Close storyline">✕ close</button>
    </div>
    <div class="st-trail-canvas"><div class="st-canvas-inner">
      <svg class="st-edges"></svg>
    </div></div>`;
  host.appendChild(overlay);
  const canvas = overlay.querySelector('.st-trail-canvas');
  const inner = overlay.querySelector('.st-canvas-inner');
  const svg = overlay.querySelector('.st-edges');
  overlay.querySelector('.st-trail-close').onclick = () => overlay.remove();

  // trail of blocks; each: { focal, from: {bi, eid} | null }
  let trail = [{ focal: seed, from: null }];

  // distinct shared vias of a dataset, each carrying the datasets that share it
  function viaGroups(D) {
    const groups = new Map();
    for (const e of (adjacency.get(D.id) || [])) {
      const v = e.via || { prop: 'keyword', value: '—' };
      const k = vkStr(v);
      if (!groups.has(k)) groups.set(k, { via: v, members: [] });
      const n = nodeById[e.id];
      if (n && n.id !== D.id) groups.get(k).members.push(n);
    }
    return [...groups.values()].filter(g => g.members.length)
      .sort((a, b) => b.members.length - a.members.length);
  }

  function blockHTML(focal, bi) {
    const cl = KG.clusters[focal.cluster];
    const groups = viaGroups(focal);
    const rows = groups.length ? groups.map(g => {
      const m = metaOf(g.via.prop);
      const table = g.members.slice().sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0)).map(n => `
        <div class="st-trow" data-bi="${bi}" data-eid="${esc(n.id)}">
          <span class="st-dot" style="background:${colorFor(n.hue)}"></span>
          <span class="st-trow-t" title="${esc(n.title || n.label)}">${esc(n.title || n.label)}</span>
          <span class="st-trow-d">${degree[n.id] || 0}</span>
        </div>`).join('');
      return `<div class="st-conn-row">
        <div class="st-conn" title="${esc(g.via.value)}">
          <span class="st-conn-g">${m.glyph}</span>
          <span class="st-conn-v">${esc(g.via.value)}</span>
          <span class="st-conn-meta">${esc(m.label)} · ${g.members.length}</span>
        </div>
        <div class="st-conn-table">${table}</div>
      </div>`;
    }).join('') : `<div class="st-block-empty">no connections</div>`;

    return `<div class="st-block" data-bi="${bi}">
      <div class="st-block-head" style="border-top-color:${colorFor(focal.hue, 0.55, 0.14)}">
        <div class="st-block-k">TOPIC · ${esc(KG.domains[focal.domain]?.label || '')} › ${esc(cl?.label || '')}</div>
        <div class="st-block-t" title="${esc(focal.title || focal.label)}">${esc(focal.title || focal.label)}</div>
      </div>
      <div class="st-block-rows">${rows}</div>
    </div>`;
  }

  function render() {
    overlay.querySelector('.st-trail-seed').textContent = `· seed: ${trail[0].focal.label}`;
    inner.querySelectorAll('.st-block').forEach(b => b.remove());

    trail.forEach((t, bi) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = blockHTML(t.focal, bi);
      inner.appendChild(tmp.firstElementChild);
    });

    inner.querySelectorAll('.st-trow').forEach(r => r.onclick = () => {
      const node = nodeById[r.dataset.eid];
      if (!node) return;
      const bi = +r.dataset.bi;
      trail = trail.slice(0, bi + 1);
      trail.push({ focal: node, from: { bi, eid: r.dataset.eid } });
      render();
      requestAnimationFrame(() => { canvas.scrollLeft = canvas.scrollWidth; });
    });

    requestAnimationFrame(layout);
  }

  // position blocks left→right, align each child to the row that spawned it, draw edges
  function layout() {
    const blocks = [...inner.querySelectorAll('.st-block')];
    if (!blocks.length) return;
    const HGAP = 78, PAD = 22;
    let x = PAD;
    blocks.forEach((bEl, bi) => {
      let y = PAD;
      if (bi > 0) {
        const from = trail[bi].from;
        const parent = blocks[from.bi];
        const row = parent.querySelector(`.st-trow[data-bi="${from.bi}"][data-eid="${attrEsc(from.eid)}"]`);
        if (row && parent) y = Math.max(PAD, parent.offsetTop + row.offsetTop - 14);
      }
      bEl.style.left = x + 'px';
      bEl.style.top = y + 'px';
      x += bEl.offsetWidth + HGAP;
    });

    const maxR = Math.max(...blocks.map(b => b.offsetLeft + b.offsetWidth)) + PAD;
    const maxB = Math.max(...blocks.map(b => b.offsetTop + b.offsetHeight)) + PAD;
    inner.style.width = maxR + 'px';
    inner.style.height = maxB + 'px';
    svg.setAttribute('width', maxR); svg.setAttribute('height', maxB); svg.setAttribute('viewBox', `0 0 ${maxR} ${maxB}`);

    svg.innerHTML = '';
    for (let bi = 1; bi < trail.length; bi++) {
      const from = trail[bi].from;
      const parent = blocks[from.bi], child = blocks[bi];
      const row = parent.querySelector(`.st-trow[data-bi="${from.bi}"][data-eid="${attrEsc(from.eid)}"]`);
      if (!row) continue;
      const ax = parent.offsetLeft + parent.offsetWidth;
      const ay = parent.offsetTop + Math.min(row.offsetTop + row.offsetHeight / 2, parent.offsetHeight - 8);
      const bx = child.offsetLeft, by = child.offsetTop + 22, mx = (ax + bx) / 2;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', `M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx},${by}`);
      p.setAttribute('class', 'st-edge');
      svg.appendChild(p);
    }
  }

  render();
}
