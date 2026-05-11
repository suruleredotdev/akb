# kb-viz frontend

Lightweight 2D demo viewer for kb-viz manifests. Four linked frames
(semantic / map / timeline / length-vs-position) plus a text panel that
shows the focused node with annotation spans highlighted.

## Run the demo

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The app loads `public/manifest.json` (the
synthetic akb sample shipped with this repo — 2 documents, 3 chunks, 7
expression-level annotations spanning Lake Chad / Maiduguri / Ile-Ife and
the years 1898 / 1990 / 2015).

## Use a real corpus

Once you have an akb database:

```bash
cd ..  # repo root, where kb_viz/ lives
python -m kb_viz.akb_adapter path/to/akb/data/archive.db \
    -o frontend/public/manifest.json
```

Reload the page; everything wires up automatically.

If the akb DDL has different column names than the README implies, override
them via `AkbColumnMap` (see `kb_viz/akb_adapter.py`).

## What to try in the demo

1. **Click a point in any frame.** Selection syncs across all four
   frames and the text panel shows the selected node's text with
   annotations highlighted (green = geographic, indigo = temporal,
   amber = entity).
2. **Switch the level dropdown** between `document`, `chunk`, and
   `expression`. At document level, the map shows centroids of each
   document's geographic annotations; at expression level, individual
   geo-resolved spans.
3. **Press Esc** to clear the selection.

## Architecture

- `src/types/manifest.ts` — TypeScript mirror of the Pydantic schema
- `src/state/` — vanilla zustand stores (data, selection, view)
- `src/projection/projectors/` — pure functions: `(nodes, all) → Map<id, coords>`
- `src/frames/` — one component per frame, all subscribe to the same stores

Adding a new frame is a matter of writing a projector and a frame component
that consumes its output. The state architecture is what makes that cheap.

## Known constraints (deferred for MVP)

- 3D view, animated cross-frame transitions, on-zoom drill-down, and
  filtering UI are out of scope. See `../docs/MVP_PLAN.md` for the full
  build order including these.
- UMAP runs synchronously on the main thread. Fine for hundreds of
  embeddings; move to a Web Worker before thousands.
- Plot's TypeScript types don't model accessor functions for the `r`
  and `fill` channels, so we cast them. Runtime works as documented.
