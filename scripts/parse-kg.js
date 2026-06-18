/**
 * scripts/parse-kg.js
 *
 * Reads LDM-KG_dump_2026-02-09.ttl (never modified) → writes public/kg-data.json
 *
 * Hierarchy derived from RDF classes and properties:
 *   Domain  → rdfs:label source prefix  (dcat:Dataset property)
 *   Cluster → human-readable topic category (mapped from dcat:keyword values)
 *   Leaf    → individual dcat:Dataset instance (every dataset — no sampling)
 *
 * Edges — real semantic relationships only (no pseudo-random connections):
 *   Shared dcat:keyword            → topic co-occurrence
 *   Shared vcard:fn                → same contact researcher
 *   Shared datacite:isDescribedBy  → same cited publication / DOI
 *
 * NOTE: dct:publisher is NOT used as a link. It only ever resolves to the
 * source portal (INSPIRE / OpenAIRE), i.e. it duplicates the domain split and
 * produces a degenerate ~10k-member "shared publisher" group. It is kept as
 * display-only metadata (orgName), never as an edge.
 *
 * Run with: npm run parse-kg
 */

import { createReadStream, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StreamParser } from 'n3';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const TTL_PATH = resolve(__dirname, '../LDM-KG_dump_2026-02-09.ttl');
const OUT_DIR  = resolve(__dirname, '../public');
const OUT_PATH = resolve(__dirname, '../public/kg-data.json');

// ─── RDF term constants ───────────────────────────────────────────────────────
const RDF_TYPE     = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const DCAT_DS      = 'http://www.w3.org/ns/dcat#Dataset';
const DCAT_KW      = 'http://www.w3.org/ns/dcat#keyword';
const DCT_TITLE    = 'http://purl.org/dc/terms/title';
const DCT_PUB      = 'http://purl.org/dc/terms/publisher';
const DCT_CREATOR  = 'http://purl.org/dc/terms/creator';
const DCT_DESC     = 'http://purl.org/dc/terms/description';
const DCT_ISSUED   = 'http://purl.org/dc/terms/issued';
const RDFS_LABEL   = 'http://www.w3.org/2000/01/rdf-schema#label';
const VCARD_FN     = 'http://www.w3.org/2006/vcard/ns#fn';
const VCARD_ORG    = 'http://www.w3.org/2006/vcard/ns#Organization';
const PRO_AUTHOR   = 'http://purl.org/spar/pro/Author';
const DATACITE_IDB = 'http://purl.org/spar/datacite/isDescribedBy';

// Extract the dataset/org UUID shared across the two subject forms
//   .../ldm/dataset/<uuid>  ·  .../ldm<uuid>  ·  .../organization/<uuid>
const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const uuidOf  = u => (u.match(UUID_RE) || [])[1] || null;

// ─── Domain definitions (from rdfs:label source prefix) ──────────────────────
const SOURCES = {
  openaire:   { id: 'openaire',   label: 'OpenAIRE Research Data',        hue: 200 },
  inspirehep: { id: 'inspirehep', label: 'INSPIRE-HEP Physics Datasets',  hue: 145 },
  doi:        { id: 'doi',        label: 'DOI-Referenced Datasets',        hue: 290 },
  import:     { id: 'import',     label: 'DE Import/Export Market Values', hue: 60  },
};

// ─── Topic categories (human-readable, matched against dcat:keyword & title) ─
// First matching category wins per dataset. Match is case-insensitive substring.
const TOPIC_CATEGORIES = {
  openaire: [
    { label: 'Clean & Renewable Energy',
      patterns: ['clean energy', '7. clean energy', 'renewable', 'solar energy', 'wind energy',
                 'photovoltaic', 'biomass', 'geothermal', 'bioenergy', 'clean power', 'hydropower'] },
    { label: 'Climate & Emissions',
      patterns: ['climate', '13. climate action', 'emission', 'carbon dioxide', 'co2',
                 'greenhouse', 'global warming', 'decarboni', 'net zero', 'ghg'] },
    { label: 'Sustainable Development',
      patterns: ['11. sustainability', '12. responsible', 'sustainability', 'sustainable development',
                 'circular economy', 'sdg', 'sustainable cities'] },
    { label: 'Energy Demand & Efficiency',
      patterns: ['energy consumption', 'energy demand', 'energy efficiency', 'energy balance',
                 'energy saving', 'energy use', 'building energy', 'energy audit'] },
    { label: 'Energy Policy & Markets',
      patterns: ['energy policy', 'energy market', 'energy price', 'energy cost',
                 'policy', 'regulation', 'market', 'tariff', 'investment', 'lcoe', 'finance'] },
    { label: 'Industry & Innovation',
      patterns: ['9. industry', 'industry', 'innovation', 'manufacturing', 'industrial process',
                 'smart grid', 'digitali'] },
    { label: 'Nuclear & Plasma Science',
      patterns: ['plasma', 'nuclear energy', 'nuclear power', 'fusion energy',
                 'reactor', 'burning plasma', 'tokamak', 'iter'] },
  ],
  inspirehep: [
    { label: 'Deep Inelastic Scattering',
      patterns: ['e p -->', 'e- p', 'e+ p', 'deep inelastic', 'structure function',
                 'bjorken', 'f2 proton', 'parton distribution', 'dis '] },
    { label: 'Proton–Proton & Hadron Collisions',
      patterns: ['p p -->', '$p$ $p$', 'pbar p', 'p anti-p', 'p + p', 'pp --',
                 'inclusive production', 'charged particle production', 'tevatron', 'lhc'] },
    { label: 'Heavy Ion & Nuclear Collisions',
      patterns: ['heavy ion', 'nuclear modification', 'au+au', 'pb+pb', 'quark-gluon',
                 'quark gluon', 'qgp', 'coalescence', 'rhic', 'centrality', 'nuclear collision',
                 '$au$', '$pb$', 'd + au', 'd au'] },
    { label: 'Exclusive Reactions & Resonances',
      patterns: ['exclusive', 'baryon resonance', 'meson production',
                 'angular dependence', 'angular distribution', 'diffractive'] },
    { label: 'B Physics & Quarkonia',
      patterns: ['b meson', '$b^', 'j/psi', 'upsilon', 'quarkonium', 'cp violation',
                 'psi(', 'b+', 'b0 ->', 'b_s', 'charmonium', 'bottomonium'] },
    { label: 'Electroweak & Higgs Physics',
      patterns: ['higgs', 'w boson', 'z boson', 'electroweak', 'top quark',
                 'w -->', 'z -->', '$w^', '$z^', 'standard model violation', 'susy', 'supersymm'] },
    { label: 'Neutrino & Lepton Physics',
      patterns: ['neutrino', 'lepton', 'muon scattering', '$\\mu$', 'tau lepton',
                 'electron production', 'semi-leptonic', 'leptonic'] },
    { label: 'Differential Cross Sections',
      patterns: ['cross section', 'differential cross', 'dsig/', 'single differential',
                 'double differential', 'transverse momentum', 'rapidity distribution'] },
  ],
  doi: [
    { label: 'Energy & Power Systems',
      patterns: ['energy', 'power', 'electricity', 'fuel', 'heat', 'thermal', 'grid'] },
    { label: 'Environment & Climate',
      patterns: ['environment', 'climate', 'ecology', 'emission', 'atmosphere', 'pollution'] },
  ],
  import: [
    { label: 'Import Trade Statistics',  patterns: ['import', 'einfuhr'] },
    { label: 'Export Trade Statistics',  patterns: ['export', 'ausfuhr'] },
  ],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSourceId(label) {
  if (label.startsWith('openaire_'))         return 'openaire';
  if (label.startsWith('inspirehep_'))       return 'inspirehep';
  if (label.startsWith('doi_'))              return 'doi';
  if (label.startsWith('import-und-export')) return 'import';
  return null;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/, '').slice(0, 36);
}

// Short display label: first 5 words, max 40 chars
function shortLabel(title) {
  const words = title.trim().split(/\s+/);
  let label = words.slice(0, 5).join(' ');
  if (label.length > 40) label = label.slice(0, 39) + '…';
  else if (words.length > 5) label += ' …';
  return label;
}

function assignCategory(srcId, keywords, title) {
  const cats = TOPIC_CATEGORIES[srcId] || [];
  const kwStr   = keywords.join(' ').toLowerCase();
  const titleLo = title.toLowerCase();
  for (const cat of cats) {
    for (const pat of cat.patterns) {
      if (kwStr.includes(pat) || titleLo.includes(pat)) return cat.label;
    }
  }
  return null;
}

// ─── Phase 1: stream-parse TTL (read-only) ───────────────────────────────────
// Datasets appear under two subject forms that share a UUID:
//   .../ldm/dataset/<uuid>  carries title, keywords, publisher, contact, DOIs
//   .../ldm<uuid>           carries dct:creator → pro:Author
// Authors (pro:Author) and organisations (vcard:Organization) are separate
// subjects resolved by URI / UUID after the stream completes.
async function parseTTL() {
  const byUuid      = new Map();   // uuid    → dataset record (merged)
  const datasetUris = new Set();   // every dcat:Dataset subject (both forms)
  const isAuthor    = new Set();
  const isOrg       = new Set();
  const authorName  = new Map();   // authorURI → rdfs:label
  const orgByUuid   = new Map();   // org uuid  → dct:title

  const recOf = uuid => {
    let r = byUuid.get(uuid);
    if (!r) { r = { title: '', label: '', description: '', issued: '', keywords: [], publisher: null, vcardFn: null, dois: [], creators: [] }; byUuid.set(uuid, r); }
    return r;
  };

  await new Promise((res, rej) => {
    const parser = new StreamParser({ format: 'Turtle' });
    createReadStream(TTL_PATH).pipe(parser);

    let count = 0;
    parser.on('data', quad => {
      const s = quad.subject.value;
      const p = quad.predicate.value;
      const o = quad.object.value;

      if (p === RDF_TYPE) {
        if (o === DCAT_DS)    { datasetUris.add(s); const u = uuidOf(s); if (u) { const r = recOf(u); if (s.includes('/ldm/dataset/')) r.uri = s; } if (++count % 5000 === 0) process.stdout.write(`\r  parsed ${count} datasets...`); }
        else if (o === PRO_AUTHOR) isAuthor.add(s);
        else if (o === VCARD_ORG)  isOrg.add(s);
        return;
      }

      // Author name (rdfs:label on a pro:Author subject)
      if (p === RDFS_LABEL && isAuthor.has(s)) { authorName.set(s, o); return; }
      // Organisation title (dct:title on a vcard:Organization subject)
      if (p === DCT_TITLE && isOrg.has(s)) { const u = uuidOf(s); if (u) orgByUuid.set(u, o); return; }

      if (!datasetUris.has(s)) return;
      const u = uuidOf(s); if (!u) return;
      const d = recOf(u);

      if      (p === DCT_TITLE)    d.title = d.title || o;
      else if (p === RDFS_LABEL)   d.label = d.label || o;
      else if (p === DCT_DESC && !d.description) d.description = o;
      else if (p === DCT_ISSUED && !d.issued)     d.issued = o;
      else if (p === DCT_PUB)      d.publisher = o;
      else if (p === DCT_CREATOR)  d.creators.push(o);
      else if (p === VCARD_FN && !d.vcardFn) d.vcardFn = o;
      else if (p === DATACITE_IDB) d.dois.push(o);
      else if (p === DCAT_KW && o.length >= 3 && o.length <= 80)
        d.keywords.push(o.toLowerCase().trim());
    });

    parser.on('end',   res);
    parser.on('error', rej);
  });

  // Resolve creator URIs → author names, and publisher URI → organisation name
  for (const d of byUuid.values()) {
    d.authors = [...new Set(d.creators.map(c => authorName.get(c)).filter(Boolean))];
    d.orgName = d.publisher ? (orgByUuid.get(uuidOf(d.publisher)) || null) : null;
  }

  console.log(`\n  datasets: ${byUuid.size} · named authors: ${authorName.size} · organisations: ${orgByUuid.size}`);
  return byUuid;
}

// ─── Phase 2: build EnergyKG-compatible graph ─────────────────────────────────
function buildGraph(datasets) {
  const bySource = { openaire: [], inspirehep: [], doi: [], import: [] };
  for (const d of datasets.values()) {
    const src = getSourceId(d.label);
    if (!src || !d.title) continue;
    bySource[src].push({ uri: d.uri, ...d });
  }

  const TAXONOMY = [], nodes = [], leafNodes = [];
  const domainById = {}, clusterById = {};

  for (const [srcId, srcDef] of Object.entries(SOURCES)) {
    const list = bySource[srcId];
    if (!list.length) continue;

    const catLabels  = (TOPIC_CATEGORIES[srcId] || []).map(c => c.label);
    const otherLabel = `General ${srcDef.label}`;
    const buckets    = {};
    [...catLabels, otherLabel].forEach(l => (buckets[l] = []));

    for (const d of list) {
      const cat = assignCategory(srcId, d.keywords, d.title) ?? otherLabel;
      buckets[cat].push(d);
    }

    nodes.push({
      id: `dom:${srcId}`, level: 0, label: srcDef.label,
      domain: srcId, cluster: null, hue: srcDef.hue, weight: 0,
    });

    const taxClusters = [];
    let domLeafCount  = 0;

    for (const [catLabel, members] of Object.entries(buckets)) {
      if (!members.length) continue;

      const clId = `${srcId}_${slugify(catLabel)}`;

      nodes.push({
        id: `cl:${clId}`, level: 1, label: catLabel,
        domain: srcId, cluster: clId, hue: srcDef.hue, weight: members.length,
      });
      clusterById[clId] = {
        id: clId, label: catLabel, domain: srcId,
        hue: srcDef.hue, leafCount: members.length,
      };

      members.forEach((d, li) => {
        const n = {
          id:          `lf:${clId}:${li}`,
          level:       2,
          label:       shortLabel(d.title),   // short display name (5 words)
          title:       d.title,               // full title for tooltips / panels
          description: d.description || null,
          issued:      d.issued || null,
          domain:      srcId,
          cluster:     clId,
          hue:         srcDef.hue,
          weight:      1 + (li * 7) % 8,
          uri:         d.uri,
          keywords:    d.keywords.slice(0, 6),
          publisher:   d.publisher,
          orgName:     d.orgName,
          vcardFn:     d.vcardFn,
          authors:     (d.authors || []).slice(0, 8),
          dois:        d.dois.slice(0, 3),
        };
        nodes.push(n);
        leafNodes.push(n);
      });

      taxClusters.push({ id: clId, label: catLabel });
      domLeafCount += members.length;
    }

    domainById[srcId] = {
      id: srcId, label: srcDef.label, hue: srcDef.hue,
      leafCount: domLeafCount, clusterIds: taxClusters.map(c => c.id),
    };
    TAXONOMY.push({ id: srcId, label: srcDef.label, hue: srcDef.hue, clusters: taxClusters });
  }

  // ─── Phase 3: semantic edges — every edge records WHY it exists ──────────────
  // A pair may be linked by several shared properties; we keep them all as
  // `vias: [{ prop, value }]` and surface the highest-priority one as `via`.
  // prop ∈ author | doi | contact | keyword   (priority high → low)
  const PROP_PRIORITY = { author: 5, doi: 4, contact: 3, keyword: 1 };

  const pairs = new Map();   // "a|b" → { a, b, vias: [{prop,value}] }

  function addReason(na, nb, prop, value) {
    if (na.id === nb.id) return;
    const k = na.id < nb.id ? `${na.id}|${nb.id}` : `${nb.id}|${na.id}`;
    let p = pairs.get(k);
    if (!p) { p = { a: na, b: nb, vias: [] }; pairs.set(k, p); }
    if (p.vias.length < 6 && !p.vias.some(v => v.prop === prop && v.value === value))
      p.vias.push({ prop, value });
  }

  function edgeKind(na, nb) {
    if (na.cluster === nb.cluster) return ['intra',   1.0];
    if (na.domain  === nb.domain)  return ['sibling', 0.6];
    return                                ['cross',   0.3];
  }

  // Build property indexes: shared value → [leafNode, ...]
  // (orgName is intentionally not indexed — publisher is not a link; see header note)
  const kwIndex     = {};
  const fnIndex     = {};
  const doiIndex    = {};
  const authorIndex = {};

  for (const n of leafNodes) {
    for (const kw of (n.keywords ?? []))    (kwIndex[kw]          ??= []).push(n);
    if (n.vcardFn)                           (fnIndex[n.vcardFn]   ??= []).push(n);
    for (const doi of (n.dois ?? []))       (doiIndex[doi]         ??= []).push(n);
    for (const au of (n.authors ?? []))     (authorIndex[au]       ??= []).push(n);
  }

  // Connect every pair within a shared-value group (capped), tagging the reason.
  function connectIndex(index, cap, prop, labelValue) {
    for (const [value, group] of Object.entries(index)) {
      const c = Math.min(group.length, cap);
      for (let i = 0; i < c; i++)
        for (let j = i + 1; j < c; j++)
          addReason(group[i], group[j], prop, labelValue ? labelValue(value) : value);
    }
  }

  connectIndex(authorIndex, 12, 'author');                      // dct:creator → pro:Author
  connectIndex(doiIndex,      8, 'doi', v => v.replace(/^https?:\/\/(dx\.)?doi\.org\//, ''));  // datacite:isDescribedBy
  connectIndex(fnIndex,      10, 'contact');                    // vcard:fn
  connectIndex(kwIndex,      12, 'keyword');                    // dcat:keyword

  // Emit one edge per linked pair, carrying its reasons.
  const edges = [];
  for (const { a, b, vias } of pairs.values()) {
    vias.sort((x, y) => PROP_PRIORITY[y.prop] - PROP_PRIORITY[x.prop]);
    const [kind, w] = edgeKind(a, b);
    edges.push({
      source: a.id, target: b.id, kind, weight: w,
      via: vias[0], vias,
    });
  }

  // ─── Aggregate edges to cluster / domain level ────────────────────────────
  const nodeById = {};
  for (const n of nodes) nodeById[n.id] = n;

  const clEdgeMap = {}, domEdgeMap = {};
  for (const e of edges) {
    const sa = nodeById[e.source], sb = nodeById[e.target];
    if (!sa?.cluster || !sb?.cluster || sa.cluster === sb.cluster) continue;
    const ck = sa.cluster < sb.cluster
      ? `${sa.cluster}|${sb.cluster}` : `${sb.cluster}|${sa.cluster}`;
    clEdgeMap[ck] = (clEdgeMap[ck] || 0) + 1;
    if (sa.domain !== sb.domain) {
      const dk = sa.domain < sb.domain
        ? `${sa.domain}|${sb.domain}` : `${sb.domain}|${sa.domain}`;
      domEdgeMap[dk] = (domEdgeMap[dk] || 0) + 1;
    }
  }

  const clusterLinks = Object.entries(clEdgeMap).map(([k, w]) => {
    const [a, b] = k.split('|');
    return { source: `cl:${a}`, target: `cl:${b}`, weight: w, kind: 'agg' };
  });
  const domainLinks = Object.entries(domEdgeMap).map(([k, w]) => {
    const [a, b] = k.split('|');
    return { source: `dom:${a}`, target: `dom:${b}`, weight: w, kind: 'agg' };
  });

  return {
    TAXONOMY, nodes, edges, leafNodes,
    domains: domainById, clusters: clusterById,
    domainLinks, clusterLinks,
    stats: {
      nodes:    nodes.length,
      leaves:   leafNodes.length,
      edges:    edges.length,
      domains:  TAXONOMY.length,
      clusters: Object.keys(clusterById).length,
    },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`Reading: ${TTL_PATH}`);
const datasets = await parseTTL();
const graph    = buildGraph(datasets);

console.log(
  `Graph: ${graph.stats.domains} domains · ` +
  `${graph.stats.clusters} clusters · ` +
  `${graph.stats.leaves} leaf nodes · ` +
  `${graph.stats.edges} edges`
);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(graph));
console.log(`Written → ${OUT_PATH}`);
