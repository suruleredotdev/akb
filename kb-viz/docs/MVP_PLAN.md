# kb-viz MVP plan

## Scope

**In:** load a manifest, render four linked frames in 2D, click-to-select syncs across them, level toggle (document / chunk / expression) for multi-resolution exploration, basic filtering.

**Out (deferred):** 3D scatter, animated cross-frame transitions, full LOD with on-zoom drill-down, schema editor UI, embedding-on-the-fly, server-side aggregation.

The four MVP frames:

| Frame | Source | Library |
| --- | --- | --- |
| `semantic_2d` | UMAP of node embeddings | deck.gl `ScatterplotLayer` |
| `map` | `geographic` annotations | deck.gl `ScatterplotLayer` over MapLibre |
| `timeline` | `temporal` annotations | Observable Plot |
| `length_position` | `length` × `position` properties | Observable Plot |

Plus a fifth pane that's not a frame: a **details/text view** showing the selected node's text with annotations highlighted. This is what makes multi-resolution navigation feel grounded.

## Tech stack

```
Vite + React 18 + TypeScript
deck.gl 9.x          // ScatterplotLayer, MapView (no GeoJsonLayer needed for MVP)
maplibre-gl          // basemap under deck.gl
@observablehq/plot   // timeline + chart frames (declarative, <100 LOC per frame)
zustand              // state stores; vanilla so it's framework-portable
umap-js              // client-side 2D reduction
@apache-arrow/esnext // optional: side-loaded embeddings
```

Why Observable Plot for timeline/chart and deck.gl for the spatial frames: Plot is concise for declarative grammar-of-graphics (a timeline is `Plot.dot(data, {x: "iso_start", y: "doc_id"})` and you're done), while deck.gl earns its keep on the GPU-accelerated point clouds and map overlay. Mixing two libraries here is the right call — a single library forced to do both ends up worse at each.

Why vanilla Zustand: stores live outside React, so an Observable notebook embedding or a Tauri shell can bind to the same store later without rewrites. The React bindings are a thin shim.

## Directory layout

```
frontend/
  src/
    types/
      manifest.ts              # schema mirror (already written)
    state/
      data-store.ts            # immutable nodes + indices, populated from manifest
      selection-store.ts       # selected / hovered / focused
      filter-store.ts          # composable predicates -> active id set
      view-store.ts            # active level, active frames, layout
    projection/
      cache.ts                 # keyed by (frame_id, scope, level)
      registry.ts              # map of projectors
      projectors/
        semantic.ts            # umap-js wrapper
        map.ts                 # identity on lat/lng
        timeline.ts            # ISO -> epoch
        property.ts            # generic numeric property -> 1d coord
    frames/
      SemanticFrame.tsx        # deck.gl scatter
      MapFrame.tsx             # deck.gl + maplibre
      TimelineFrame.tsx        # Plot
      ChartFrame.tsx           # Plot
      TextFrame.tsx            # selected node text + annotation spans
    components/
      LevelSelector.tsx        # document | chunk | expression toggle
      FilterBar.tsx
      AppShell.tsx             # the 4-pane grid
    lib/
      load-manifest.ts         # fetch + validate (zod or manual)
    main.tsx
```

## State stores (skeletons)

Each store is a single Zustand `create` call. None imports React; React bindings come from `zustand`'s vanilla API plus `useSyncExternalStore` in components.

```ts
// state/data-store.ts
import { createStore } from 'zustand/vanilla';
import type { Manifest, Node, NodeId, Edge } from '../types/manifest';

export interface DataState {
  schemaId: string;
  nodes: Map<NodeId, Node>;
  edges: Map<string, Edge>;
  byType: Map<string, NodeId[]>;
  byParent: Map<NodeId, NodeId[]>;
  load(manifest: Manifest): void;
}

export const dataStore = createStore<DataState>((set) => ({
  schemaId: '',
  nodes: new Map(),
  edges: new Map(),
  byType: new Map(),
  byParent: new Map(),
  load(manifest) {
    const nodes = new Map<NodeId, Node>();
    const byType = new Map<string, NodeId[]>();
    const byParent = new Map<NodeId, NodeId[]>();
    for (const n of manifest.nodes) {
      nodes.set(n.id, n);
      const t = byType.get(n.type) ?? [];
      t.push(n.id);
      byType.set(n.type, t);
      if (n.parent_id) {
        const p = byParent.get(n.parent_id) ?? [];
        p.push(n.id);
        byParent.set(n.parent_id, p);
      }
    }
    const edges = new Map(manifest.edges.map((e) => [e.id, e]));
    set({ schemaId: manifest.schema_id, nodes, edges, byType, byParent });
  },
}));
```

```ts
// state/selection-store.ts
import { createStore } from 'zustand/vanilla';
import type { NodeId } from '../types/manifest';

export interface SelectionState {
  selected: Set<NodeId>;
  hovered: NodeId | null;
  focused: NodeId | null;
  toggle(id: NodeId): void;
  hover(id: NodeId | null): void;
  focus(id: NodeId | null): void;
  clear(): void;
}

export const selectionStore = createStore<SelectionState>((set) => ({
  selected: new Set(),
  hovered: null,
  focused: null,
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      next.has(id) ? next.delete(id) : next.add(id);
      return { selected: next };
    }),
  hover: (id) => set({ hovered: id }),
  focus: (id) => set({ focused: id }),
  clear: () => set({ selected: new Set(), hovered: null, focused: null }),
}));
```

```ts
// state/view-store.ts
import { createStore } from 'zustand/vanilla';

export type Level = 'document' | 'chunk' | 'expression';

export interface ViewState {
  level: Level;
  activeFrames: string[];
  setLevel(l: Level): void;
}

export const viewStore = createStore<ViewState>((set) => ({
  level: 'chunk',                // chunks are the natural default — they have embeddings
  activeFrames: ['semantic_2d', 'map', 'timeline', 'length_position'],
  setLevel: (level) => set({ level }),
}));
```

## Projection cache and registry

```ts
// projection/cache.ts
import type { NodeId } from '../types/manifest';

export type Coords = number[];                       // 2 or 3 entries
export type ProjectionResult = Map<NodeId, Coords>;

export interface ProjectionKey {
  frameId: string;
  scope: 'global' | NodeId;
  level?: string;
}

const keyStr = (k: ProjectionKey) =>
  `${k.frameId}|${k.scope}|${k.level ?? '-'}`;

export class ProjectionCache {
  private cache = new Map<string, ProjectionResult | 'computing'>();
  private inflight = new Map<string, Promise<ProjectionResult>>();

  get(k: ProjectionKey): ProjectionResult | 'computing' | undefined {
    return this.cache.get(keyStr(k));
  }

  async compute(
    k: ProjectionKey,
    fn: () => Promise<ProjectionResult>,
  ): Promise<ProjectionResult> {
    const s = keyStr(k);
    const cached = this.cache.get(s);
    if (cached && cached !== 'computing') return cached;
    const inflight = this.inflight.get(s);
    if (inflight) return inflight;
    this.cache.set(s, 'computing');
    const p = fn().then((r) => {
      this.cache.set(s, r);
      this.inflight.delete(s);
      return r;
    });
    this.inflight.set(s, p);
    return p;
  }

  invalidate(pred: (k: string) => boolean) {
    for (const key of this.cache.keys()) if (pred(key)) this.cache.delete(key);
  }
}

export const projectionCache = new ProjectionCache();
```

```ts
// projection/projectors/semantic.ts
import { UMAP } from 'umap-js';
import type { Node, NodeId } from '../../types/manifest';
import type { Coords, ProjectionResult } from '../cache';

export async function projectSemantic(nodes: Node[]): Promise<ProjectionResult> {
  const withEmbedding = nodes.filter((n) => n.embedding && n.embedding.length > 0);
  if (withEmbedding.length === 0) return new Map();

  const matrix = withEmbedding.map((n) => n.embedding!);
  const umap = new UMAP({ nComponents: 2, nNeighbors: Math.min(15, matrix.length - 1) });
  const embedding = umap.fit(matrix);

  const result = new Map<NodeId, Coords>();
  withEmbedding.forEach((n, i) => result.set(n.id, embedding[i]));
  return result;
}
```

```ts
// projection/projectors/map.ts
import { isGeographic, type Node, type NodeId } from '../../types/manifest';
import type { Coords, ProjectionResult } from '../cache';

export function projectMap(nodes: Node[]): ProjectionResult {
  const result = new Map<NodeId, Coords>();
  for (const n of nodes) {
    // Take the first geographic annotation; if none, node is filtered out of this frame.
    for (const a of n.annotations) {
      if (isGeographic(a.value)) {
        result.set(n.id, [a.value.lng, a.value.lat]);   // deck.gl uses [lng, lat]
        break;
      }
    }
  }
  return result;
}
```

```ts
// projection/projectors/timeline.ts
import { isTemporal, type Node, type NodeId } from '../../types/manifest';
import type { Coords, ProjectionResult } from '../cache';

export function projectTimeline(nodes: Node[]): ProjectionResult {
  const result = new Map<NodeId, Coords>();
  for (const n of nodes) {
    for (const a of n.annotations) {
      if (isTemporal(a.value)) {
        const t = Date.parse(a.value.iso_start);
        if (!Number.isNaN(t)) result.set(n.id, [t]);
        break;
      }
    }
  }
  return result;
}
```

The pattern: each projector returns a `Map<NodeId, Coords>`. Nodes that don't project into the frame are simply absent from the map. Frames render only nodes present in their projection. Selection state is global, so a node selected in the map but not present in the timeline still shows as selected in the text view.

## Frame component shape

```tsx
// frames/MapFrame.tsx (sketch)
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapLibre } from 'react-map-gl/maplibre';
import { useSyncExternalStore } from 'react';
import { selectionStore } from '../state/selection-store';
import { dataStore } from '../state/data-store';
import { viewStore } from '../state/view-store';
import { projectMap } from '../projection/projectors/map';

export function MapFrame() {
  const data = useSyncExternalStore(dataStore.subscribe, dataStore.getState);
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getState);
  const sel = useSyncExternalStore(selectionStore.subscribe, selectionStore.getState);

  const nodes = (data.byType.get(view.level) ?? [])
    .map((id) => data.nodes.get(id)!)
    .filter(Boolean);
  const positions = projectMap(nodes);
  const points = nodes
    .filter((n) => positions.has(n.id))
    .map((n) => ({ id: n.id, position: positions.get(n.id)! }));

  return (
    <DeckGL
      initialViewState={{ longitude: 8, latitude: 12, zoom: 3 }}
      controller
      layers={[
        new ScatterplotLayer({
          id: 'nodes',
          data: points,
          getPosition: (d) => d.position,
          getRadius: (d) => (sel.selected.has(d.id) ? 8 : 4),
          getFillColor: (d) => (sel.selected.has(d.id) ? [240, 80, 40] : [40, 120, 200]),
          radiusUnits: 'pixels',
          pickable: true,
          onClick: (info) => info.object && selectionStore.getState().toggle(info.object.id),
          onHover: (info) => selectionStore.getState().hover(info.object?.id ?? null),
          updateTriggers: { getRadius: sel.selected, getFillColor: sel.selected },
        }),
      ]}
    >
      <MapLibre mapStyle="https://demotiles.maplibre.org/style.json" />
    </DeckGL>
  );
}
```

The same shape applies to the other frames — pull state, project, render layer, wire click/hover to selection. Each frame is roughly 80–120 LOC.

## UI layout

A simple 2×2 CSS grid for the four frames plus a sidebar for level selector, filter, and the text/details view. No tabs, no draggable panels for MVP — those are nice-to-haves once the core works.

```
┌─────────────────────────────────────────────────────────┐
│ Title    [level: chunk ▾]   [filter: …]                 │
├──────────────┬──────────────┬───────────────────────────┤
│              │              │                           │
│   Semantic   │     Map      │         Details           │
│              │              │  (selected node text +    │
│              │              │   annotations highlighted)│
├──────────────┼──────────────┤                           │
│              │              │                           │
│   Timeline   │  Length×Pos  │                           │
│              │              │                           │
└──────────────┴──────────────┴───────────────────────────┘
```

## Build order

The right small steps (1–2 days each), each ending in something runnable:

1. **Vite scaffold + manifest loader.** `npm create vite`, install deps, write `lib/load-manifest.ts`. End state: `pnpm dev` loads `sample_manifest.json`, prints node counts. Verifies the schema round-trips.
2. **Stores wired.** Drop in `data-store`, `selection-store`, `view-store`. Render a placeholder div per frame that shows live node counts from the store. Verifies state flow.
3. **Map frame.** First real frame, simplest projection (identity on lat/lng). End state: clickable points on a basemap.
4. **Timeline frame** with Plot. Clicks sync to map selection. End state: linked-views demo.
5. **Length × position chart frame.** Trivial once Plot is in. Free win.
6. **Semantic frame.** UMAP via worker (umap-js fits inside web workers fine — keep main thread responsive). End state: four linked frames.
7. **Text frame.** Renders selected node's text with annotation spans highlighted by type color. The grounding pane.
8. **Level selector.** Switching from `chunk` to `document` re-derives frames using the document-level summaries (centroids on the map, histogram bands on the timeline) instead of individual points.
9. **Filter bar.** A single text input that filters by node type, ner_type, or annotation date range. Composable predicates, all derived state.

That's the MVP. Roughly two weeks of focused work; more like three when you account for visual polish and the inevitable schema iteration once the first real corpus loads.

## Honest gotchas to plan for

- **UMAP is non-deterministic by default.** Set a `random` seed in the umap-js options or you'll get different layouts on every reload, which is disorienting for users.
- **deck.gl + MapLibre version pinning.** `@deck.gl/react` 9.x expects `react-map-gl` 7.x with MapLibre adapter. Mismatched versions render nothing silently.
- **Plot in React.** Render Plot output into a ref'd div via `useEffect`; don't return Plot's SVG directly from a component or React's reconciliation will fight it. Standard pattern, search "observable plot react".
- **Worker-side UMAP.** umap-js fitting on a few thousand chunks is fast, but blocks the main thread for ~500ms. Move it to a worker before this becomes a perceptible jank. The projection cache already supports `'computing'` state for this.
- **Selection on cross-level navigation.** When the user toggles level from `chunk` to `document`, do you keep the selection? My intuition: keep `selected` but also auto-focus the parents of currently selected nodes. Worth deciding explicitly rather than discovering ad-hoc.
