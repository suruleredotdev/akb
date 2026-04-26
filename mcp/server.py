"""akb serve — local HTTP API + MCP tool definitions for Claude Code / QMD integration."""

import json
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from cli.db import (DB_PATH, find_spans_by_entity, get_chunk,
                    get_conn, get_neighbor_chunks, get_spans_for_chunk,
                    get_spans_for_block, list_blocks)
from cli.search import search
from cli.export import export_geojson, export_timex_json


def create_app() -> FastAPI:
    api = FastAPI(
        title="akb",
        description="Archive Knowledge Base — local HTTP API and MCP server",
        version="0.1.0",
    )
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── MCP manifest ──────────────────────────────────────────────────────────
    # Claude Code reads this to discover available tools.

    @api.get("/.well-known/mcp.json")
    def mcp_manifest():
        return {
            "schema_version": "1.0",
            "name": "akb",
            "description": "Archive Knowledge Base search and entity lookup",
            "tools": [
                {
                    "name": "akb.search",
                    "description": (
                        "Search the local knowledge base using BM25 + semantic hybrid search. "
                        "Returns ranked chunks with NER entities (locations, dates, people, orgs) "
                        "attached to each result."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "top_k": {"type": "integer", "default": 10},
                            "mode": {"type": "string", "enum": ["hybrid", "bm25", "vector"],
                                     "default": "hybrid"},
                        },
                        "required": ["query"],
                    },
                },
                {
                    "name": "akb.get_entity",
                    "description": (
                        "Find all chunks mentioning a specific normalized entity. "
                        "Use to explore all references to a place, person, org, or date in the corpus."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "span_type": {"type": "string",
                                          "enum": ["LOC", "TIME", "PERSON", "ORG", "KEYWORD"]},
                            "normalized_value": {"type": "string"},
                        },
                        "required": ["span_type", "normalized_value"],
                    },
                },
                {
                    "name": "akb.get_context",
                    "description": (
                        "Get a chunk's full text, its neighboring chunks, and all NER spans. "
                        "Use after search to zoom in on a specific result."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "chunk_id": {"type": "string"},
                            "window": {"type": "integer", "default": 2},
                        },
                        "required": ["chunk_id"],
                    },
                },
            ],
        }

    # ── MCP tool endpoints ────────────────────────────────────────────────────

    @api.post("/mcp/akb.search")
    def mcp_search(body: dict):
        query = body.get("query", "")
        top_k = body.get("top_k", 10)
        mode = body.get("mode", "hybrid")
        results = search(query, mode=mode, top_k=top_k)
        return {
            "results": [
                {
                    "chunk_id": r.chunk_id,
                    "block_id": r.block_id,
                    "block_title": r.block_title,
                    "position": r.position,
                    "text": r.text,
                    "rrf_score": r.rrf_score,
                    "spans": [dict(s) for s in r.spans],
                }
                for r in results
            ]
        }

    @api.post("/mcp/akb.get_entity")
    def mcp_get_entity(body: dict):
        span_type = body.get("span_type")
        normalized_value = body.get("normalized_value")
        with get_conn() as conn:
            spans = find_spans_by_entity(conn, span_type, normalized_value)
            out = []
            for span in spans:
                chunk = get_chunk(conn, span["chunk_id"])
                if chunk:
                    out.append({
                        "span": dict(span),
                        "chunk_text": chunk["text"],
                        "block_id": chunk["block_id"],
                    })
        return {"entity": {"span_type": span_type, "normalized_value": normalized_value},
                "occurrences": out}

    @api.post("/mcp/akb.get_context")
    def mcp_get_context(body: dict):
        chunk_id = body.get("chunk_id")
        window = body.get("window", 2)
        with get_conn() as conn:
            chunk = get_chunk(conn, chunk_id)
            if not chunk:
                return JSONResponse({"error": "chunk not found"}, status_code=404)
            neighbors = get_neighbor_chunks(conn, chunk_id, window)
            spans = get_spans_for_chunk(conn, chunk_id)
        return {
            "chunk": dict(chunk),
            "neighbors": [dict(n) for n in neighbors],
            "spans": [dict(s) for s in spans],
        }

    # ── REST API for UI components ────────────────────────────────────────────

    @api.get("/api/blocks")
    def api_blocks():
        with get_conn() as conn:
            return [dict(b) for b in list_blocks(conn)]

    @api.get("/api/search")
    def api_search(q: str = Query(...), mode: str = "hybrid", top_k: int = 10):
        results = search(q, mode=mode, top_k=top_k)
        return [
            {
                "chunk_id": r.chunk_id,
                "block_id": r.block_id,
                "block_title": r.block_title,
                "position": r.position,
                "text": r.text[:400],
                "rrf_score": r.rrf_score,
                "spans": [dict(s) for s in r.spans],
            }
            for r in results
        ]

    @api.get("/api/geo")
    def api_geo(block_id: str = None):
        with get_conn() as conn:
            if block_id:
                blocks = [conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()]
            else:
                blocks = list_blocks(conn)
            return export_geojson(conn, [b for b in blocks if b])

    @api.get("/api/chrono")
    def api_chrono(block_id: str = None):
        with get_conn() as conn:
            if block_id:
                blocks = [conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()]
            else:
                blocks = list_blocks(conn)
            return export_timex_json(conn, [b for b in blocks if b])

    @api.get("/api/entities")
    def api_entities(block_id: str = None, span_type: str = None):
        with get_conn() as conn:
            if block_id:
                blocks = [conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()]
            else:
                blocks = list_blocks(conn)
            spans = []
            for block in blocks:
                if not block:
                    continue
                block_spans = get_spans_for_block(conn, block["id"], span_type)
                for s in block_spans:
                    chunk = get_chunk(conn, s["chunk_id"])
                    spans.append({
                        **dict(s),
                        "block_title": block["title"],
                        "chunk_excerpt": (chunk["text"][:200] if chunk else ""),
                    })
        return spans

    @api.get("/api/chunk/{chunk_id}/context")
    def api_chunk_context(chunk_id: str, window: int = 2):
        with get_conn() as conn:
            chunk = get_chunk(conn, chunk_id)
            if not chunk:
                return JSONResponse({"error": "not found"}, status_code=404)
            neighbors = get_neighbor_chunks(conn, chunk_id, window)
            spans = get_spans_for_chunk(conn, chunk_id)
        return {"chunk": dict(chunk), "neighbors": [dict(n) for n in neighbors],
                "spans": [dict(s) for s in spans]}

    # ── Serve UI ──────────────────────────────────────────────────────────────
    ui_dir = Path(__file__).parent.parent / "ui"
    if ui_dir.exists():
        api.mount("/", StaticFiles(directory=str(ui_dir), html=True), name="ui")

    return api
