# kb-viz

Interactive multi-frame visualizer for an akb knowledge base. Reads a manifest
(JSON) produced by the Python adapter and renders the corpus across linked
reference frames — semantic embedding space, geography, time, intrinsic numeric
properties, and a force-directed graph — all backed by deck.gl with a flexible
tiling layout.

## Repo layout

```
kb_viz/                         # Python — adapter from akb to manifest
  schema.py                     # Pydantic manifest model (v1)
  akb_adapter.py                # akb SQLite → Manifest, with CLI
  test_adapter.py               # synthetic-db smoke test

frontend/                       # TypeScript — visualizer
  src/
    types/manifest.ts           # TypeScript mirror of schema.py
    state/
      data-store.ts             # nodes, edges, byType, byParent (Zustand)
      selection-store.ts        # selected Set, hovered, anchor, boxSelect
      view-store.ts             # level, colorBy, scope, per-frame configs
      filter-store.ts           # typeFilter, dateRange, spatialPolygon, activeIds
      layout-store.ts           # mosaic tree, built-in presets, savePreset
    frames/
      registry.tsx              # registerFrame / getFrame
      index.ts                  # registers all 8 frame types
      SemanticFrame.tsx         # UMAP 2D/3D via Web Worker → OrthographicView / OrbitView
      MapFrame.tsx              # geo scatter + HeatmapLayer + ArcLayer + convex hull
      TimelineFrame.tsx         # temporal scatter (deck.gl) + drag-to-brush filter
      ChartFrame.tsx            # position × length scatter (deck.gl)
      TextFrame.tsx             # selected node text + annotation highlights
      GraphFrame.tsx            # force-directed graph via Web Worker
      SearchFrame.tsx           # (placeholder)
      EntityFrame.tsx           # (placeholder)
    workers/
      umap.worker.ts            # UMAP-js 2D/3D off main thread
      graph-layout.worker.ts    # Fruchterman-Reingold force simulation
    projection/projectors/
      semantic.ts               # embedding matrix → UMAP (main-thread fallback)
      map.ts                    # annotation/summary → [lng, lat]
      timeline.ts               # temporal annotation → ms epoch
    components/
      AppShell.tsx              # react-mosaic-component tiling container
      NodeTooltip.tsx           # portal tooltip on hover
      LevelSelector.tsx         # document / chunk / expression picker
      ColorBySelector.tsx       # color-by dimension picker
    lib/
      color-encoder.ts          # makeColorEncoder, rgbaToHex
      derive-label.ts           # title / source / text excerpt fallback
      use-store.ts              # React hook for Zustand vanilla stores
      use-scoped-ids.ts         # scope-aware node ID list
  public/
    manifest.json               # sample manifest (shipped with the demo)

docs/
  MVP_PLAN.md                   # full architecture & build order
  sample_manifest.json          # canonical synthetic manifest
```

## Quickstart (no real akb db needed)

```bash
cd kb-viz/frontend
npm install
npm run dev
```

Open http://localhost:5173.

## With a real akb corpus

```bash
# Generate the manifest from an akb SQLite database
pip install pydantic
python -m kb_viz.akb_adapter path/to/akb/data/archive.db \
    -o frontend/public/manifest.json

# Start the dev server
cd frontend && npm run dev
```

## Frame types

| Frame | Description |
|---|---|
| **Semantic** | UMAP projection of embeddings. Toggle 2D (OrthographicView) / 3D (OrbitView, drag to rotate). Computation runs in a Web Worker — a "computing UMAP…" indicator shows while in flight. |
| **Map** | Geographic scatter on a dark-matter tile base. Layer toggles: **heat** (HeatmapLayer density), **arcs** (ArcLayer connecting consecutive selected nodes), **hull** (convex hull of selected geo points). |
| **Timeline** | Temporal scatter with stable jitter on Y. Dynamic year tick labels. Drag to brush a date range → applies `filterStore.dateRange` and box-selects matching nodes. |
| **Chart** | Position × length scatter. Both axes have computed tick labels. Selection dimming and hover highlight. |
| **Text** | Selected node's raw text with inline annotation highlights (geo, temporal, entity). |
| **Graph** | Force-directed graph (Fruchterman-Reingold in a Web Worker) of nodes + edges at the current level. Toggle edge types: next / similarity / citation / co_occurrence. |
| **Search** | Placeholder — full-text + semantic search UI (planned M4). |
| **Entity** | Placeholder — entity explorer (planned M4). |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Esc` | Clear selection; drill out of current scope |

## Layout management

- Use the **layout…** dropdown in the header to switch built-in presets: `4-panel`, `map focus`, `text focus`, `single`.
- Click **💾** to save the current tiling as a named preset (persisted in localStorage).
- Use **+ frame** to split the root pane and add a new frame.
- Each window has a **⤢** maximize button.

## Manual test checklist

### Semantic frame — 3D orbit mode (#18)
1. Open the app; click the **Semantic** frame.
2. The **2d** button is active by default.
3. Click **3d** — the frame switches to `OrbitView`. A "computing UMAP…" badge appears while the worker runs.
4. Once points appear, drag to rotate the cloud in 3D.
5. Click **2d** to switch back — points recompute in 2D.

### Map frame — heatmap, arcs, hull (#19)
1. Open the **Map** frame. Three toggle buttons appear: **heat**, **arcs**, **hull**.
2. Click **heat** to enable the density heatmap behind the scatter points.
3. Click several geo-positioned nodes (Cmd/Ctrl-click or box-select on Timeline).
4. **arcs**: great-circle arcs appear between consecutive selected nodes.
5. **hull**: when ≥ 3 selected nodes have geo data, a convex hull polygon is drawn around them.

### Graph frame (#20)
1. From the **+ frame** dropdown, choose **graph**.
2. The frame shows nodes as dots connected by edges. A "computing layout…" indicator appears briefly.
3. If the corpus has typed edges (similarity, citation, co_occurrence, next), toggle buttons appear to filter by edge type.
4. Click a node to select it; hover to highlight.

## Running tests

```bash
cd frontend
npm test               # vitest run (45 unit tests)
npm run typecheck      # tsc --noEmit
npm run build          # vite build (production bundle)
```

## Verify the adapter

```bash
python kb_viz/test_adapter.py
```

---

## Changelog

### M3 (2026-05)
- **SemanticFrame**: UMAP moved to a Web Worker (`workers/umap.worker.ts`); supports 2D/3D toggle via `OrthographicView` / `OrbitView`.
- **TimelineFrame**: rewritten from Observable Plot to deck.gl (`ScatterplotLayer` + `LineLayer` + `TextLayer`); drag-to-brush date filter.
- **ChartFrame**: rewritten from Observable Plot to deck.gl; axis lines + tick labels.
- **MapFrame**: added `HeatmapLayer`, `ArcLayer`, convex hull overlay; layer toggles.
- **GraphFrame**: new frame with Fruchterman-Reingold force layout (`workers/graph-layout.worker.ts`), edge type filtering.
- Installed `@deck.gl/extensions` and `@deck.gl/aggregation-layers`.

### M2 (2026-04)
- **Layout**: replaced fixed 2×2 CSS grid with `react-mosaic-component` tiling.
- **layout-store**: mosaic tree, 4 built-in presets (`4-panel`, `map-focus`, `text-focus`, `single`), `savePreset` / `loadPreset`, persist to localStorage.
- **Frame registry**: `registerFrame` / `getFrame` pattern; `FrameProps = { paneId, width, height }`.
- **AppShell**: `Mosaic<FrameType>` container with per-pane maximize control.
- **NodeTooltip**: rAF-throttled portal tooltip with label, text preview, annotation badge counts.
- Added **+ frame** button and **💾** preset save to the header.

### M1 (2026-04)
- **State**: 5 Zustand stores (`data`, `selection`, `view`, `filter`, `layout`).
- **filter-store**: `typeFilter`, `dateRange`, `spatialPolygon`, `textQuery`; derived `activeIds`.
- **selection-store**: `boxSelect`, `addToSelection`, `anchor`.
- **view-store**: `paneViewStates`, `frameConfigs`; persisted to localStorage.
- **CSS**: full design-token rewrite (`--bg`, `--surface`, `--accent`, `--selected`, entity-type tokens).
- CI: GitHub Actions (`typecheck → test → build`); Netlify preview deploys.
- 45 unit tests across stores, projectors.

### M0 (2026-04)
- Initial scaffold: Vite + React 18 + TypeScript + deck.gl + Zustand.
- Python schema (`kb_viz/schema.py`) + SQLite adapter (`kb_viz/akb_adapter.py`).
- 4 initial frames: Semantic (UMAP), Map (geo scatter), Timeline (Observable Plot), Chart (Observable Plot).
- TextFrame with annotation highlights.
