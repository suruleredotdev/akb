# kb-viz

Knowledge-base visualizer. Reads an akb manifest, renders the corpus across
four linked reference frames (semantic embedding space, geography, time,
intrinsic numeric properties), with a text panel showing selected nodes and
their annotations.

## Repo layout

```
kb_viz/                       # Python — adapter from akb to manifest
  schema.py                   # Pydantic manifest model
  akb_adapter.py              # akb SQLite -> Manifest, with CLI
  test_adapter.py             # synthetic-db smoke test
frontend/                     # TypeScript — visualizer
  src/types/manifest.ts       # mirror of schema.py
  src/state/                  # zustand stores
  src/projection/projectors/  # pure (nodes, all) -> coords functions
  src/frames/                 # one component per reference frame
  public/manifest.json        # sample manifest used by the demo
docs/
  MVP_PLAN.md                 # full architecture & build order
  sample_manifest.json        # canonical synthetic manifest
```

## Quickstart (demo, no real akb db needed)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## With a real akb corpus

```bash
# Install the Python side
pip install pydantic

# Generate the manifest
python -m kb_viz.akb_adapter path/to/akb/data/archive.db \
    -o frontend/public/manifest.json

# Reload the browser
```

## Verify the adapter

```bash
python kb_viz/test_adapter.py
```

Builds a synthetic akb-shaped SQLite, runs the adapter, asserts the
manifest validates and contains the expected structure.
