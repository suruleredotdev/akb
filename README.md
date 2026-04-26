# akb — Archive Knowledge Base

Local-first CLI for multi-dimensional document analysis: semantic search, geographic
extraction, temporal annotation, and NER — all stored in SQLite, exportable to GeoJSON,
KML, and TIMEX formats.

## Install

```bash
cd akb
pip install -e ".[llm]"
python -m spacy download en_core_web_sm
```

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

## External tool integration

| Tool | How |
|---|---|
| **Google Earth** | `akb export geo --format kml` → drag KML into Google Earth |
| **QGIS / any GIS** | `akb export geo --format geojson` → import as vector layer |
| **TIMEX viewers (brat)** | `akb export chrono --format timex3-xml` |
| **QMD** | Point QMD collection at `akb/data/blocks/` |
| **Claude Code** | `akb serve` → add MCP endpoint `http://localhost:8765/.well-known/mcp.json` |
| **Observable / Jupyter** | Query `akb/data/archive.db` directly with SQL |

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
