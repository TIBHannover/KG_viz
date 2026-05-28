// Energy Knowledge Graph — synthesized dataset
// Three-level hierarchy: domain → cluster → leaf (dataset / entity)
// Plus a dense edge set including cross-domain links for hairball topology.

const TAXONOMY = [
  {
    id: "renewable",
    label: "Renewable Generation",
    hue: 38, // amber
    clusters: [
      { id: "solar", label: "Solar", leaves: ["Photovoltaic Cells","Concentrated Solar Power","Solar Thermal Collectors","Rooftop PV Arrays","Utility-Scale Solar Farms","Floating Solar","Solar Tracking Systems","Bifacial Modules","Perovskite Tandem Cells","Agrivoltaics","Solar Inverter Telemetry","BIPV Glass Façades","Off-Grid Solar Kits","Solar Irradiance Atlas","DNI Forecast Models","Module Degradation Logs","Soiling Loss Reports","CSP Tower Receivers","Linear Fresnel Plants","Parabolic Trough Fields","PV Hail Damage Records","Solar O&M Tickets"] },
      { id: "wind", label: "Wind", leaves: ["Onshore Wind Farms","Offshore Wind Farms","Floating Wind Platforms","Distributed Small Wind","Wind Resource Maps","Wake Loss Models","Turbine SCADA Streams","Blade Inspection Imagery","Gearbox Vibration Logs","Yaw Misalignment Data","LIDAR Wind Profiles","Met Mast Records","Curtailment Events","Avian Strike Reports","Foundation Monitoring","Cable Layout Surveys","O&M Vessel Logs","Power Curve Catalogs","Annual Energy Yield","Substation Feed-in Data"] },
      { id: "hydro", label: "Hydro", leaves: ["Reservoir Hydropower","Run-of-River Plants","Pumped Storage Hydro","Micro-Hydro Sites","Dam Sediment Records","Spillway Telemetry","Reservoir Levels","Inflow Forecasts","Fish Passage Counts","Turbine Efficiency Curves","Sluice Gate Logs","Penstock Pressure Data","Hydropeaking Schedules","Tailrace Flow Sensors","Glacier Melt Indices","Watershed Runoff Models"] },
      { id: "geothermal", label: "Geothermal", leaves: ["Enhanced Geothermal Systems","Hydrothermal Reservoirs","Binary Cycle Plants","Flash Steam Plants","Ground Source Heat Pumps","Reservoir Pressure Logs","Reinjection Wells","Heat Flow Maps","Volcanic Activity Indices","Geothermal Gradient Surveys"] },
      { id: "biomass", label: "Biomass & Bio", leaves: ["Wood Pellet Plants","Anaerobic Digesters","Biogas Upgrading","Landfill Gas Capture","Crop Residue Inventory","Forest Yield Models","Biojet Fuel Refineries","Algal Biomass","Black Liquor Recovery","Sustainable Aviation Fuel"] },
      { id: "marine", label: "Marine", leaves: ["Tidal Stream Devices","Tidal Barrage","Wave Energy Converters","Ocean Thermal (OTEC)","Salinity Gradient (PRO)","Buoy Telemetry","Bathymetric Atlas"] }
    ]
  },
  {
    id: "fossil",
    label: "Fossil Fuels",
    hue: 18, // hot orange-red
    clusters: [
      { id: "coal", label: "Coal", leaves: ["Anthracite Mines","Bituminous Mines","Lignite Pits","Coking Coal Exports","Mine Methane Emissions","Coal Beneficiation Plants","Coal-Fired Boilers","Ash Pond Monitoring","FGD Scrubber Logs","Mine Subsidence Data","Coal Stockpile Imagery","Train Loadout Records","Pithead Power Plants","Mercury Emission Inventory"] },
      { id: "gas", label: "Natural Gas", leaves: ["Conventional Gas Fields","Shale Gas Plays","Tight Gas Reservoirs","LNG Liquefaction Trains","LNG Receiving Terminals","Pipeline Network Atlas","Compressor Stations","Underground Gas Storage","City Gate Stations","Methane Leak Surveys","Gas Quality Telemetry","Wellhead Pressure Logs","Flaring Inventory","Henry Hub Spot Prices","Trans-Continental Gas Hubs","Floating LNG Vessels"] },
      { id: "oil", label: "Oil & Refining", leaves: ["Crude Oil Fields","Tight Oil (Shale Oil)","Heavy Oil Sands","Offshore Platforms","FPSO Telemetry","Refinery Cat-Cracking Units","Refinery Hydrocrackers","Pipeline Throughput","Tanker AIS Tracks","Storage Tank Inventory","Refined Product Margins","Bunker Fuel Markets","Brent Spot Prices","Asphalt Production","Petrochemical Naphtha"] }
    ]
  },
  {
    id: "nuclear",
    label: "Nuclear",
    hue: 145, // green
    clusters: [
      { id: "fission", label: "Fission Reactors", leaves: ["Pressurized Water Reactors","Boiling Water Reactors","CANDU Heavy Water","VVER Reactors","Small Modular Reactors","Advanced Gas-Cooled","Fast Breeder Reactors","Reactor Outage Schedules","Capacity Factor Records","Coolant Chemistry Logs"] },
      { id: "fusion", label: "Fusion R&D", leaves: ["ITER Tokamak","Stellarator Wendelstein","Spherical Tokamaks","Inertial Confinement (NIF)","Magnetic Coil Telemetry","Plasma Diagnostics","Tritium Inventory","Divertor Materials Tests"] },
      { id: "fuelcycle", label: "Fuel Cycle", leaves: ["Uranium Mines","Conversion Facilities","Enrichment Centrifuges","Fuel Assembly Plants","Spent Fuel Pools","Dry Cask Storage","Geological Repositories","Reprocessing (PUREX)","Thorium Cycle Studies","MOX Fabrication","Decommissioning Sites","Radwaste Inventory"] }
    ]
  },
  {
    id: "grid",
    label: "Grid Infrastructure",
    hue: 200, // teal
    clusters: [
      { id: "transmission", label: "Transmission", leaves: ["HVDC Interconnectors","HVAC 765 kV Lines","Subsea Cables","Substation Catalog","Reactive Compensation","Phasor Measurement Units","Transformer Health Index","Line Sag Sensors","Right-of-Way GIS","Wildfire Risk Layers","Outage Cause Codes","Interregional Flowgates","Topology Snapshots","N-1 Contingency Sets"] },
      { id: "distribution", label: "Distribution", leaves: ["Feeder Topology","Distribution Transformers","Reclosers & Switches","Voltage Regulator Logs","Smart Meter AMI","Outage Management Tickets","Service Drop Inventory","DER Interconnect Queue","Pole Asset Imagery","Vegetation Encroachment"] },
      { id: "smartgrid", label: "Smart Grid & Markets", leaves: ["SCADA Historians","EMS State Estimator","Day-Ahead Market","Real-Time Imbalance","Ancillary Services","Capacity Auctions","Locational Marginal Prices","Renewable Curtailment","Demand Response Programs","Virtual Power Plants","Grid Forming Inverters","FERC Order 2222 Roster"] },
      { id: "microgrid", label: "Microgrids", leaves: ["Island Microgrids","Campus Microgrids","Military Microgrids","Black-Start Resources","Islanding Detection Logs","Microgrid Controller Telemetry"] }
    ]
  },
  {
    id: "storage",
    label: "Energy Storage",
    hue: 290, // violet
    clusters: [
      { id: "battery", label: "Batteries", leaves: ["Lithium-Ion Utility Storage","LFP Stationary Packs","Solid-State Prototypes","Sodium-Ion Cells","Vanadium Redox Flow","Zinc-Bromine Flow","Lead-Acid UPS","Battery State-of-Health","Cycle Aging Datasets","Thermal Runaway Reports","BMS Telemetry","Second-Life EV Packs"] },
      { id: "thermal", label: "Thermal Storage", leaves: ["Molten Salt Tanks","Phase Change Materials","Hot Water Tanks","Underground Thermal","Ice Storage Cooling","Concrete Block Storage","Sand Battery Pilots"] },
      { id: "mechanical", label: "Mechanical", leaves: ["Pumped Hydro Inventory","Compressed Air (CAES)","Liquid Air Storage","Flywheel Arrays","Gravity Storage Pilots"] },
      { id: "hydrogen", label: "Hydrogen", leaves: ["PEM Electrolyzers","Alkaline Electrolyzers","SOEC Electrolyzers","Salt Cavern H2 Storage","H2 Pipelines","Ammonia Carriers","Methanol Synthesis","Fuel Cell Stacks","H2 Refueling Stations","Green H2 Certificates"] }
    ]
  },
  {
    id: "demand",
    label: "Demand & End Use",
    hue: 330, // pink-magenta
    clusters: [
      { id: "industrial", label: "Industrial", leaves: ["Steel Mill Loads","Aluminum Smelters","Cement Kilns","Chemical Process Heat","Data Center Power","Pulp & Paper","Glass Furnaces","Industrial CHP","Process Cooling","Compressed Air Systems"] },
      { id: "residential", label: "Residential", leaves: ["Smart Thermostat Telemetry","Heat Pump Adoption","Rooftop PV Households","Home Battery Adoption","EV Home Charging","Appliance Energy Star","Building Envelope Audits","Whole-Home Disaggregation"] },
      { id: "transport", label: "Transportation", leaves: ["EV Public Charging","DC Fast Charger Logs","EV Battery Telemetry","Rail Traction Power","Aviation Jet Fuel","Maritime Bunkering","Hydrogen Buses","Freight Truck Telematics","Bike-Share Energy"] },
      { id: "commercial", label: "Commercial & Ag", leaves: ["Office HVAC Systems","Retail Refrigeration","Restaurant Loads","Hospital Backup Gen","School District Audits","Greenhouse Lighting","Irrigation Pumping","Cold Chain Logistics"] }
    ]
  },
  {
    id: "policy",
    label: "Policy, Climate & Markets",
    hue: 60, // chartreuse
    clusters: [
      { id: "policy", label: "Policy & Regulation", leaves: ["RPS Compliance Filings","FERC Orders","EU ETS Allowances","CBAM Filings","Permitting Records","Tax Credit (IRA) Tracker","Net Metering Rules"] },
      { id: "carbon", label: "Carbon & Emissions", leaves: ["Scope 1 Inventory","Scope 2 Inventory","Scope 3 Inventory","CO2 Atmospheric Records","Methane Satellite Plumes","SF6 Leakage Logs","Carbon Offset Registries","CCUS Project Pipeline","Direct Air Capture","Mineralization Sites"] },
      { id: "climate", label: "Climate & Weather", leaves: ["Reanalysis Datasets","Hourly Temperature Grids","Heat Wave Indices","Hurricane Tracks","Drought Monitor","Solar Radiation Reanalysis","Wind Reanalysis (ERA5)","Sea Level Rise","Wildfire Perimeters"] },
      { id: "finance", label: "Finance & Trade", leaves: ["LCOE Benchmarks","PPA Contract Tape","Green Bond Registry","Project Finance Pipeline","Insurance Loss Records","Commodity Forward Curves"] }
    ]
  }
];

// ---------- Pad to >= 540 leaves with realistic regional/source variants ----------
const REGIONS = ["EU","US","APAC","MENA","LATAM","Africa","Nordic","UK","India","China","Brazil","Australia","Canada","Japan","ERCOT","CAISO","PJM","ISO-NE","NYISO","MISO","SE Asia","Gulf","Iberia","Baltic","Andean"];
const SOURCES = ["IEA","IRENA","BNEF","EIA","Eurostat","OECD","S&P","Wood Mac","Rystad","Platts","Argus","WRI","NOAA","ECMWF","Copernicus","NREL","DOE","ONS","NEA"];
let totalLeaves = TAXONOMY.reduce((s, d) => s + d.clusters.reduce((s2, c) => s2 + c.leaves.length, 0), 0);
let pi = 0;
while (totalLeaves < 555) {
  for (const dom of TAXONOMY) {
    for (const cl of dom.clusters) {
      if (totalLeaves >= 555) break;
      const base = cl.leaves[pi % cl.leaves.length];
      const useRegion = (pi % 2) === 0;
      const tag = useRegion ? REGIONS[pi % REGIONS.length] : SOURCES[pi % SOURCES.length];
      cl.leaves.push(`${base} · ${tag}`);
      pi++;
      totalLeaves++;
    }
    if (totalLeaves >= 555) break;
  }
}

// ---------- Flatten into nodes ----------
const nodes = [];
const clusterById = {};
const domainById = {};

TAXONOMY.forEach((dom) => {
  domainById[dom.id] = { ...dom, leafCount: 0, clusterIds: [] };
  nodes.push({
    id: `dom:${dom.id}`, level: 0, label: dom.label, domain: dom.id,
    cluster: null, hue: dom.hue, weight: 0
  });
  dom.clusters.forEach(cl => {
    clusterById[cl.id] = { ...cl, domain: dom.id, hue: dom.hue, leafCount: cl.leaves.length };
    domainById[dom.id].clusterIds.push(cl.id);
    domainById[dom.id].leafCount += cl.leaves.length;
    nodes.push({
      id: `cl:${cl.id}`, level: 1, label: cl.label,
      domain: dom.id, cluster: cl.id, hue: dom.hue, weight: cl.leaves.length
    });
    cl.leaves.forEach((leaf, li) => {
      nodes.push({
        id: `lf:${cl.id}:${li}`, level: 2, label: leaf,
        domain: dom.id, cluster: cl.id, hue: dom.hue,
        weight: 1 + (li * 13 + cl.id.length * 7) % 9
      });
    });
  });
});

const leafNodes = nodes.filter(n => n.level === 2);

// ---------- Build edges (hairball) ----------
// Deterministic pseudo-random
let _seed = 42;
function rand() { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; }

const edges = [];
const edgeKey = new Set();
function addEdge(a, b, kind, weight) {
  if (a === b) return;
  const k = a < b ? a + "|" + b : b + "|" + a;
  if (edgeKey.has(k)) return;
  edgeKey.add(k);
  edges.push({ source: a, target: b, kind, weight: weight || 1 });
}

// Within-cluster dense connections
TAXONOMY.forEach(dom => {
  dom.clusters.forEach(cl => {
    const ids = leafNodes.filter(n => n.cluster === cl.id).map(n => n.id);
    ids.forEach(a => {
      const k = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < k; i++) {
        const b = ids[Math.floor(rand() * ids.length)];
        addEdge(a, b, "intra", 1);
      }
    });
  });
});

// Cross-cluster within domain
TAXONOMY.forEach(dom => {
  const clusters = dom.clusters;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const A = leafNodes.filter(n => n.cluster === clusters[i].id).map(n => n.id);
      const B = leafNodes.filter(n => n.cluster === clusters[j].id).map(n => n.id);
      const links = 4 + Math.floor(rand() * 6);
      for (let l = 0; l < links; l++) {
        addEdge(A[Math.floor(rand()*A.length)], B[Math.floor(rand()*B.length)], "sibling", 0.6);
      }
    }
  }
});

// Cross-domain (hairball glue)
const allLeafIds = leafNodes.map(n => n.id);
const crossEdgeCount = 320;
for (let i = 0; i < crossEdgeCount; i++) {
  const a = allLeafIds[Math.floor(rand() * allLeafIds.length)];
  const b = allLeafIds[Math.floor(rand() * allLeafIds.length)];
  addEdge(a, b, "cross", 0.3);
}

// Hub-like nodes
const hubLabels = ["LCOE Benchmarks","Reanalysis Datasets","SCADA Historians","Smart Meter AMI","Day-Ahead Market","Carbon Offset Registries","Methane Satellite Plumes","Wind Reanalysis (ERA5)"];
const hubs = leafNodes.filter(n => hubLabels.includes(n.label));
hubs.forEach(h => {
  h.weight = 9;
  for (let i = 0; i < 24; i++) {
    const t = allLeafIds[Math.floor(rand() * allLeafIds.length)];
    addEdge(h.id, t, "hub", 0.5);
  }
});

// ---------- Aggregate edges for higher levels ----------
const clusterEdges = {};
edges.forEach(e => {
  const sa = nodes.find(n => n.id === e.source);
  const sb = nodes.find(n => n.id === e.target);
  if (!sa || !sb || !sa.cluster || !sb.cluster || sa.cluster === sb.cluster) return;
  const k = sa.cluster < sb.cluster ? sa.cluster + "|" + sb.cluster : sb.cluster + "|" + sa.cluster;
  clusterEdges[k] = (clusterEdges[k] || 0) + 1;
});
const clusterLinkList = Object.entries(clusterEdges).map(([k, w]) => {
  const [a, b] = k.split("|");
  return { source: "cl:" + a, target: "cl:" + b, weight: w, kind: "agg" };
});

const domainEdges = {};
edges.forEach(e => {
  const sa = nodes.find(n => n.id === e.source);
  const sb = nodes.find(n => n.id === e.target);
  if (!sa || !sb || sa.domain === sb.domain) return;
  const k = sa.domain < sb.domain ? sa.domain + "|" + sb.domain : sb.domain + "|" + sa.domain;
  domainEdges[k] = (domainEdges[k] || 0) + 1;
});
const domainLinkList = Object.entries(domainEdges).map(([k, w]) => {
  const [a, b] = k.split("|");
  return { source: "dom:" + a, target: "dom:" + b, weight: w, kind: "agg" };
});

export const EnergyKG = {
  TAXONOMY,
  nodes,
  edges,
  leafNodes,
  domains: domainById,
  clusters: clusterById,
  domainLinks: domainLinkList,
  clusterLinks: clusterLinkList,
  stats: {
    nodes: nodes.length,
    leaves: leafNodes.length,
    edges: edges.length,
    domains: TAXONOMY.length,
    clusters: Object.keys(clusterById).length
  }
};

console.log("[EnergyKG]", EnergyKG.stats);
