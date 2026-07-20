// Landing page — shown in #view before a visualization is chosen, and reachable
// again via the "⌂ Home" button. Mirrors the header's view dropdown as a set of
// clickable cards so the four views are discoverable on first load.

import { EnergyKG } from './data.js';
import { esc } from './helpers.js';

export const VIEWS = [
  { id: 'hairball', label: 'Network · Hairball',
    desc: 'All datasets and their raw connections in one dense force-directed canvas.' },
  { id: 'adaptive', label: 'Adaptive Map',
    desc: 'Zoom-driven drill-down — domains → clusters → datasets — with ghost nodes for context.' },
  { id: 'sensemaking', label: 'Sensemaking',
    desc: 'Cluster connectivity matrix, dataset tiles, and an expandable egonet for any dataset.' },
  { id: 'storytelling', label: 'Storytelling',
    desc: 'The same matrix and tiles — but selecting a dataset opens a guided storyline trail instead.' },
];

// container: the #view element. onSelect(viewId): called when a card is clicked.
export function renderLanding(container, onSelect) {
  container.innerHTML = '';
  const s = EnergyKG.stats;
  const wrap = document.createElement('div');
  wrap.className = 'landing-wrap';
  wrap.innerHTML = `
    <div class="landing-hero">
      <div class="landing-kicker">NFDI4ENERGY · LINKED DATA MODEL</div>
      <h1 class="landing-title">Explore the Energy Knowledge Graph</h1>
      <p class="landing-sub">${s.leaves.toLocaleString()} datasets · ${s.clusters} clusters · ${s.domains} domains · ${s.edges.toLocaleString()} edges</p>
    </div>
    <div class="landing-grid">
      ${VIEWS.map((v, i) => `
        <button class="landing-card" data-view="${esc(v.id)}">
          <span class="landing-card-num">0${i + 1}</span>
          <div class="landing-card-label">${esc(v.label)}</div>
          <div class="landing-card-desc">${esc(v.desc)}</div>
        </button>`).join('')}
    </div>`;
  container.appendChild(wrap);
  wrap.querySelectorAll('.landing-card').forEach(b =>
    b.addEventListener('click', () => onSelect(b.dataset.view)));
}
