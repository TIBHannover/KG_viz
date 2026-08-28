/**
 * scripts/sparql.js
 *
 * Minimal SPARQL client for the Virtuoso endpoint (build-time / Node only).
 *
 * Config via env vars (set them before running fetch-kw):
 *   SPARQL_ENDPOINT   e.g. https://your-host/sparql
 *   SPARQL_GRAPH      the named graph IRI for THIS project (from SELECT DISTINCT ?g)
 *
 * Virtuoso notes baked in here:
 *   · POST form-encoded `query=…` — the most widely compatible Virtuoso form.
 *   · Default result cap is 10 000 rows and it truncates SILENTLY, so every
 *     large projection must page with ORDER BY + LIMIT/OFFSET (see `paged`).
 *
 * Requires Node 18+ (uses global fetch).
 */

const ENDPOINT = process.env.SPARQL_ENDPOINT ?? 'http://localhost:8890/sparql';
export const GRAPH = process.env.SPARQL_GRAPH ?? 'urn:your-graph';

// Run one SELECT, return rows as plain objects: { var: "value", … }.
export async function select(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query, format: 'application/sparql-results+json' }),
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = await res.json();
  return json.results.bindings.map(b =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
}

// Keyset ("seek") pagination — the ONLY paging that works past 10 000 rows on
// Virtuoso. Plain OFFSET paging fails: Virtuoso runs `LIMIT n OFFSET m` as a
// sorted TOP (m+n) and refuses to sort >10 000 rows (error SR353), so page 2
// already dies. Keyset never uses OFFSET — each page seeks past the last key.
//
// The query template `q(cursor, limit)` MUST filter on the key and order by it:
//   FILTER(STR(?key) > "${cursor}")  …  ORDER BY STR(?key)
// `keyField` is the result column holding that key. Rows sharing the page's last
// key value are dropped and re-fetched on the next page, so a multi-row group
// (e.g. all of one dataset's keywords) is never split across a boundary.
// Keep `page` ≤ 10 000 (Virtuoso's sort cap; the value that just worked as page 1).
export async function* keyset(q, keyField, page = 10000) {
  let cursor = '';
  for (;;) {
    const rows = await select(q(cursor, page));
    if (!rows.length) return;
    if (rows.length < page) { yield* rows; return; }   // final page — nothing truncated
    const lastKey = rows[rows.length - 1][keyField];
    const batch = rows.some(r => r[keyField] !== lastKey)
      ? rows.filter(r => r[keyField] !== lastKey)       // drop the possibly-cut last group
      : rows;                                           // page filled by ONE key — take it whole
    yield* batch;
    cursor = batch[batch.length - 1][keyField];         // resume just past the last COMPLETE group
  }
}

// Simple OFFSET paging — only safe when the FULL result set is < 10 000 rows on
// Virtuoso (see keyset above for anything larger).
export async function* paged(q, page = 10000) {
  for (let offset = 0; ; offset += page) {
    const rows = await select(q(page, offset));
    yield* rows;
    if (rows.length < page) return;
  }
}
