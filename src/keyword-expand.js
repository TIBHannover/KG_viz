// Live "click a keyword → the other datasets that share it" lookup, straight
// from the KG. Because annotations are concept-centric (one oa:Annotation per
// concept, fanned out to every dataset via oa:hasTarget), this is a single
// indexed query — no precomputed inverted index needed.
//
// Matched by rdfs:label, so homonym IRIs (e.g. the OEO and MENO "radiation")
// return as one set, consistent with how keywords are stored on nodes.
import { SPARQL_ENDPOINT, SPARQL_GRAPH } from './config.js';

const cache = new Map();   // label → Promise<Array<{ uuid, uri, title }>>

export function datasetsForKeyword(label) {
  if (cache.has(label)) return cache.get(label);

  // JSON.stringify yields a safe double-quoted SPARQL string literal.
  const q = `
PREFIX oa:   <http://www.w3.org/ns/oa#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dct:  <http://purl.org/dc/terms/>
SELECT ?ds ?title WHERE {
  GRAPH <${SPARQL_GRAPH}> {
    ?body rdfs:label ${JSON.stringify(label)} .
    ?anno oa:hasBody ?body ; oa:hasTarget ?ds .
    OPTIONAL { ?ds dct:title ?title }
  }
} ORDER BY ?title LIMIT 10000`;

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
  const p = fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: { Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query: q, format: 'application/sparql-results+json' }),
  })
    .then(r => { if (!r.ok) throw new Error(`SPARQL ${r.status}`); return r.json(); })
    .then(j => j.results.bindings.map(b => ({
      uuid: (b.ds.value.match(UUID) || [])[0] ?? null,
      uri: b.ds.value,
      title: b.title?.value ?? '',
    })));

  cache.set(label, p);   // cache the promise so rapid re-clicks share one request
  return p;
}
