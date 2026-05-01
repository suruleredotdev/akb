# akb — Archive Knowledge Base

Local-first CLI for multi-dimensional document analysis: semantic search, geographic
extraction, temporal annotation, and NER — all stored in SQLite, exportable to GeoJSON,
KML, and TIMEX formats.

<img width="600" height="353" alt="Screenshot 2026-04-15 at 10 39 40 PM" src="https://github.com/user-attachments/assets/6e14ed9d-beda-4d68-ac6b-f33c4fa6366c" />

## Install

```bash
cd akb
pip install -e ".[llm]"
python -m spacy download en_core_web_sm
```

> **macOS 26 (Tahoe) + Intel Mac**: uv doesn't yet map `macosx_26_0_x86_64` to
> `macosx_11_0_x86_64` wheels. Use `pip` instead of `uv pip`, or prefix uv
> commands with `MACOSX_DEPLOYMENT_TARGET=11.0`. This is a uv bug; `pip` works
> without any workaround.

## Quickstart

```bash
# Ingest documents
akb ingest https://example.com/paper.pdf
akb ingest path/to/document.md

# Process pipeline
akb chunk --all --strategy markdown
akb embed --all
akb ner --all
akb resolve geo --all
akb resolve chrono --all

# Search
akb search "water harvesting agricultural yield"
akb search "Lake Chad climate displacement" --llm

# Export
akb export geo --all --format geojson --out map.geojson
akb export chrono --all --format timex-json --out timeline.json
akb export entities --all --type LOC --format csv --out locations.csv

# UI + MCP server (http://localhost:8765)
akb serve
```

## GeoAgent integration

akb exposes its corpus as [GeoAgent](https://github.com/opengeos/GeoAgent) tools,
letting you query the knowledge base in natural language and render results on a live
Leaflet map — with optional overlay of STAC / NASA OPERA satellite data.

### Install

```bash
pip install -e ".[llm,geoagent]"
```

### Interactive demo (Jupyter)

Open `notebooks/geoagent_demo.ipynb`. Run the quickstart pipeline first if you haven't
already (see notebook header), then work through three sections:

**Section 1 — Direct tool calls** (no GeoAgent install required)  
Call the four akb tools directly and load results into leafmap:

```python
from cli.geoagent_tools import akb_search_locations, akb_get_timeline_locations

geojson = akb_search_locations("water harvesting flood mitigation", top_k=12)
m = leafmap.Map(center=[12, 10], zoom=5)
m.add_geojson(geojson, layer_name="Search results")
m
```

**Section 2 — Full GeoAgent session**  
Create an agent bound to a live map. It autonomously decides which akb tools to
call, adds GeoJSON layers to the map, and answers in prose:

```python
from cli.geoagent_tools import make_agent
import leafmap

m = leafmap.Map(center=[12, 10], zoom=5)
agent = make_agent(map=m, model="claude-sonnet-4-6")

resp = agent.chat("Find climate displacement sites in northeast Nigeria and add them to the map.")
show(resp)   # pretty-prints the answer as Markdown with tools-used footer
```

The agent has the full built-in leafmap tool suite (add/remove/list layers, zoom,
basemap switching, STAC search) alongside the akb corpus tools.

**Section 3 — Export for external GIS**  
Dump the full geocoded corpus or a filtered subset to GeoJSON for QGIS / Google Earth:

```python
full = akb_export_geojson()
pathlib.Path("corpus.geojson").write_text(json.dumps(full, indent=2))
```

### Four akb tools available to the agent

| Tool | Description |
|---|---|
| `akb_search_locations` | Hybrid BM25 + semantic search → GeoJSON of matching LOC spans |
| `akb_get_timeline_locations` | Filter all geocoded locations by ISO date window |
| `akb_get_entity_network` | All corpus knowledge about a named place: co-entities, time refs, excerpts |
| `akb_export_geojson` | Full corpus export, optionally filtered by document title |

### CLI (no Jupyter required)

```bash
# Call a tool directly — output is GeoJSON on stdout
akb geoagent --tool search-locations --query "Lake Chad climate"
akb geoagent --tool timeline-locations --start 0900 --end 1500 --out medieval.geojson
akb geoagent --tool entity-network --query "Maiduguri"
akb geoagent --tool export-geojson --out corpus.geojson

# Full agent prompt (requires geoagent install)
akb geoagent "Show water management sites from 900–1500 CE"
```

## External tool integration

| Tool | How |
|---|---|
| **Google Earth** | `akb export geo --format kml` → drag KML into Google Earth |
| **QGIS / any GIS** | `akb export geo --format geojson` → import as vector layer |
| **TIMEX viewers (brat)** | `akb export chrono --format timex3-xml` |
| **QMD** | Point QMD collection at `akb/data/blocks/` |
| **Claude Code** | `akb serve` → add MCP endpoint `http://localhost:8765/.well-known/mcp.json` |
| **Observable / Jupyter** | Query `akb/data/archive.db` directly with SQL |
| **GeoAgent / leafmap** | `pip install -e ".[geoagent]"` — see section above |

## Data model

```
blocks        — one per source document (+ .md file in data/blocks/)
chunks        — text segments with embeddings, linked prev/next
ner_spans     — LOC, TIME, PERSON, ORG, KEYWORD with geo/chrono resolution
processing_runs — provenance: model + config used for each processing step
```

## Submodule setup

```bash
# From parent repo
git submodule add https://github.com/suruleredotdev/akb akb
git submodule update --init
```
