import { EnergyKG } from './data.js';
import { renderHairball } from './hairball.js';
import { renderAdaptive } from './adaptive.js';
import { renderSensemaking } from './sensemaking.js';
import { renderStorytelling } from './storytelling.js';
import { renderLanding } from './landing.js';

const s = EnergyKG.stats;
document.getElementById("head-stats").innerHTML = `
  <div><span>Datasets</span><b>${s.leaves}</b></div>
  <div><span>Clusters</span><b>${s.clusters}</b></div>
  <div><span>Domains</span><b>${s.domains}</b></div>
  <div><span>Edges</span><b>${s.edges.toLocaleString()}</b></div>
`;

const view = document.getElementById("view");
const select = document.getElementById("view-select");
const homeBtn = document.getElementById("view-home");

// One module per view, selected from the dropdown / landing cards.
const RENDERERS = {
  hairball: renderHairball,
  adaptive: renderAdaptive,
  sensemaking: renderSensemaking,
  storytelling: renderStorytelling,
};

function showLanding() {
  select.value = '';
  renderLanding(view, setView);
}

function setView(name) {
  const renderer = RENDERERS[name];
  if (!renderer) { showLanding(); return; }
  select.value = name;
  renderer(view);
}

select.addEventListener("change", () => setView(select.value));
homeBtn.addEventListener("click", showLanding);

showLanding();
