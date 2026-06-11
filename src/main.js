import { EnergyKG } from './data.js';
import { renderHairball } from './hairball.js';
import { renderAdaptive } from './adaptive.js';
import { renderSensemaking } from './sensemaking.js';

const s = EnergyKG.stats;
document.getElementById("head-stats").innerHTML = `
  <div><span>Datasets</span><b>${s.leaves}</b></div>
  <div><span>Clusters</span><b>${s.clusters}</b></div>
  <div><span>Domains</span><b>${s.domains}</b></div>
  <div><span>Edges</span><b>${s.edges.toLocaleString()}</b></div>
`;

const view = document.getElementById("view");
const tabs = document.querySelectorAll(".tab-btn");

function setTab(name) {
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  if (name === "hairball") renderHairball(view);
  else if (name === "adaptive") renderAdaptive(view);
  else renderSensemaking(view);
}

tabs.forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
setTab("hairball");
