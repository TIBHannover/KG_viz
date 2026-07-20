# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ATLAS** — an interactive browser-based knowledge graph visualization for the energy domain. It renders ~555 dataset nodes across 7 major domains (Renewable Generation, Fossil Fuels, Nuclear, Grid Infrastructure, Energy Storage, Demand & End Use, Policy/Climate/Markets) using D3.js force simulations. There is no backend; all data is generated in-memory from a taxonomy constant.

## Commands

```bash
npm install       # Install dependencies (first time only)
npm run dev       # Start Vite dev server with hot reload
npm run build     # Production bundle → dist/
npm run preview   # Serve the production bundle locally
```

There are no automated tests. Verification is manual via the browser.

## Architecture

### Data Layer (`src/data.js`)

All graph data is generated at import time from a static `TAXONOMY` constant — no file parsing, no fetch. The generation pipeline:

1. Expands ~40 clusters into ~555 leaf nodes by multiplying base nodes × regional/source variants
2. Creates edges in four categories: intra-cluster, sibling (cross-cluster within domain), cross-domain ("hairball glue"), and hub edges for 8 high-degree nodes
3. Edge generation is deterministic via a seeded PRNG (seed = 42)
4. Aggregates leaf-level edges up to cluster-level and domain-level for use by the adaptive view

The exported `EnergyKG` object contains `nodes`, `edges`, `taxonomy`, and `statistics`.

### Two Visualization Modes (`src/hairball.js`, `src/adaptive.js`)

**Hairball** (`src/hairball.js`, ~250 lines): Renders all 555 nodes and ~2000 edges simultaneously in a D3 force simulation. Supports domain-filter chips, cross-domain edge toggle, adjacency highlighting, and sticky drag (shift+drag to release).

**Adaptive** (`src/adaptive.js`, ~600 lines): A three-level progressive-disclosure view driven by zoom depth:
- L0: Bubble layout of 7 domains
- L1: Bubble layout of clusters within a selected domain
- L2: Force-directed leaf nodes with "ghost nodes" representing external cross-cluster connections

Zooming past 4× automatically drills into the hovered region. A breadcrumb trail tracks navigation history. A floating panel shows internal/external neighbors for any selected node.

### App Shell (`index.html`, `src/main.js`)

`index.html` is the single HTML file — it contains all inline CSS (dark theme using OKLch color space, Space Grotesk + JetBrains Mono fonts). `src/main.js` (24 lines) wires tab switching between the two views and populates header statistics from `EnergyKG`.

### RDF Data File

`LDM-KG_dump_2026-02-09.ttl` is a large (~100 MB) Turtle-format RDF dump. It is **not loaded or used** by the visualization; the graph data is fully synthetic and generated in `src/data.js`.

## Key Design Conventions

- **Color encoding**: Each domain has a fixed hue in the OKLch color space; saturation/lightness vary by hierarchy level.
- **Node IDs**: Hierarchical dot-notation (`domain.cluster.leaf`).
- **Sticky drag**: Nodes stay where dropped by default; shift+drag releases them back to the simulation.
- **Ghost nodes**: At L2 in adaptive view, external neighbors are shown as faded placeholder nodes to indicate cross-cluster connectivity without rendering the full graph.
