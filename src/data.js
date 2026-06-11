// Loads the pre-processed knowledge graph from public/kg-data.json.
// Generate that file first with:  npm run parse-kg
const res = await fetch('/kg-data.json');
if (!res.ok) throw new Error(
  `kg-data.json not found (${res.status}). Run "npm run parse-kg" first.`
);
export const EnergyKG = await res.json();
console.log('[EnergyKG]', EnergyKG.stats);
