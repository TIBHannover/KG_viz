// SPARQL endpoint config for LIVE (in-browser) queries — used by keyword-expand.js.
// Override at dev/build time with a .env file or shell vars:
//   VITE_SPARQL_ENDPOINT=https://your-host/sparql
//   VITE_SPARQL_GRAPH=urn:your-graph
// The endpoint must send Access-Control-Allow-Origin (CORS) and be read-only.
const env = import.meta.env ?? {};

export const SPARQL_ENDPOINT = env.VITE_SPARQL_ENDPOINT ?? 'https://YOUR-VIRTUOSO-HOST/sparql';
export const SPARQL_GRAPH    = env.VITE_SPARQL_GRAPH    ?? 'urn:your-graph';
