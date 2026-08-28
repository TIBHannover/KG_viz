/**
 * scripts/fetch-kw.js
 *
 * Pulls the KG-annotated keywords for every dataset and writes
 *   public/kg-keywords.json   →   {
 *     concepts: { "<concept-iri>": "label", … },       // the ~373 kept concepts
 *     datasets: { "<dataset-uuid>": ["<concept-iri>", …], … }
 *   }
 * Keywords are keyed by concept IRI (NOT label), so two datasets connect only
 * when they share the SAME concept — the OEO "radiation" and the MENO
 * "radiation" stay distinct even though they display identical text.
 *
 * The annotation model (Web Annotation / oa:) is concept-centric:
 *   dataset  ←oa:hasTarget─  oa:Annotation  ─oa:hasBody→  oa:TextualBody
 *                                                            ├ rdfs:label  "…"   (display text)
 *                                                            └ rdf:value   <IRI>  (grounded concept)
 *
 * We keep only concepts grounded in the two energy-domain vocabularies (OEO and
 * midlevel-energy). Everything else — OBO units/prefixes (UO_*), upper-ontology
 * generics (IAO_, BFO_), statistics (STATO_), relations (RO_) and Common Core
 * (CCO) — is annotation noise (peta, data item, watt, statistic, …) and dropped.
 *
 * Run:  SPARQL_ENDPOINT=… SPARQL_GRAPH=… npm run fetch-kw
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { keyset, GRAPH } from './sparql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/kg-keywords.json');

// ─── Keep-rule: two-namespace allowlist (see project discussion) ──────────────
const KEEP_NS = [
  'https://openenergyplatform.org/ontology/oeo/',                       // OEO (+ oeo-physical)
  'https://raw.githubusercontent.com/stap-m/midlevel-energy-ontology/', // MENO
];
const keep = iri => !!iri && KEEP_NS.some(ns => iri.startsWith(ns));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const uuidOf = u => (String(u).match(UUID) || [])[0] || null;

// Keyset-paged by ?ds (see keyset() in sparql.js): seek past the last dataset IRI
// instead of using OFFSET, which Virtuoso caps at 10 000 sorted rows.
const litEsc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const query = (cursor, limit) => `
PREFIX oa:   <http://www.w3.org/ns/oa#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?ds ?label ?concept WHERE {
  GRAPH <${GRAPH}> {
    ?anno oa:hasTarget ?ds ; oa:hasBody ?body .
    ?body rdfs:label ?label .
    OPTIONAL { ?body rdf:value ?concept }
    FILTER(STR(?ds) > "${litEsc(cursor)}")
  }
} ORDER BY STR(?ds) LIMIT ${limit}`;

const concepts = new Map();             // concept IRI → label
const byUuid   = new Map();             // uuid → Set<concept IRI>
let rows = 0, kept = 0, dropped = 0;

console.log(`Endpoint graph: <${GRAPH}>`);
for await (const r of keyset(query, 'ds')) {
  rows++;
  if (!keep(r.concept)) { dropped++; continue; }   // requires a kept concept IRI
  const id = uuidOf(r.ds);
  if (!id) continue;
  if (r.label && !concepts.has(r.concept)) concepts.set(r.concept, r.label.trim());
  let set = byUuid.get(id);
  if (!set) { set = new Set(); byUuid.set(id, set); }
  set.add(r.concept);
  kept++;
  if (rows % 5000 === 0) process.stdout.write(`\r  rows ${rows}…`);
}

// Stable output: concepts sorted by label; each dataset's IRIs sorted by label.
const labelOf = iri => concepts.get(iri) || iri;
const out = { concepts: {}, datasets: {} };
for (const [iri] of [...concepts].sort((a, b) => a[1].localeCompare(b[1]))) out.concepts[iri] = concepts.get(iri);
for (const [id, set] of byUuid) out.datasets[id] = [...set].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

console.log(
  `\nrows=${rows}  kept=${kept}  dropped=${dropped}\n` +
  `concepts kept: ${concepts.size}\n` +
  `datasets with keywords: ${byUuid.size}\n` +
  `written → ${OUT}`
);
