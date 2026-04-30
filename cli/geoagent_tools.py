"""
akb × GeoAgent integration — register akb's knowledge base as @geo_tool functions
so GeoAgent's LLM can search the corpus, retrieve geocoded NER spans, and feed
them directly into leafmap / QGIS / NASA OPERA workflows.

Usage (Jupyter):
    from akb.cli.geoagent_tools import make_agent
    import leafmap
    m = leafmap.Map()
    agent = make_agent(map=m)
    agent.run("Show me water management sites in the Lake Chad basin before 1500 CE")

Usage (standalone tools only):
    from akb.cli.geoagent_tools import AKB_TOOLS
    # pass to any Strands-compatible agent
"""

from __future__ import annotations

import json
import logging
from typing import Any

# fastembed uses loguru; suppress its noisy download messages on stderr
logging.getLogger("fastembed").setLevel(logging.ERROR)
try:
    from loguru import logger as _loguru_logger
    _loguru_logger.disable("fastembed")
except Exception:
    pass

from cli.db import get_conn
from cli.search import search

# ── helpers ───────────────────────────────────────────────────────────────────

def _loc_features_for_chunks(conn, chunk_ids: list[str], rrf_scores: dict[str, float]) -> list[dict]:
    if not chunk_ids:
        return []
    placeholders = ",".join("?" * len(chunk_ids))
    rows = conn.execute(
        f"""
        SELECT n.lat, n.lon, n.normalized_value, n.raw_text, n.chunk_id,
               c.text AS chunk_text, b.title AS block_title, b.source_url,
               c.position
        FROM ner_spans n
        JOIN chunks c ON n.chunk_id = c.id
        JOIN blocks b ON c.block_id = b.id
        WHERE n.span_type = 'LOC'
          AND n.lat IS NOT NULL
          AND n.chunk_id IN ({placeholders})
        """,
        chunk_ids,
    ).fetchall()

    # Attach nearest TIME span per chunk
    time_by_chunk: dict[str, str] = {}
    time_rows = conn.execute(
        f"""
        SELECT chunk_id, normalized_value, iso_start
        FROM ner_spans
        WHERE span_type = 'TIME' AND iso_start IS NOT NULL
          AND chunk_id IN ({placeholders})
        """,
        chunk_ids,
    ).fetchall()
    for t in time_rows:
        if t["chunk_id"] not in time_by_chunk:
            time_by_chunk[t["chunk_id"]] = t["normalized_value"] or t["iso_start"]

    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {
                "name":         r["normalized_value"] or r["raw_text"],
                "raw_text":     r["raw_text"],
                "block_title":  r["block_title"],
                "source_url":   r["source_url"] or "",
                "excerpt":      r["chunk_text"][:220].replace("\n", " "),
                "time_context": time_by_chunk.get(r["chunk_id"], ""),
                "rrf_score":    rrf_scores.get(r["chunk_id"], 0.0),
            },
        })
    return features


def _geojson(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


# ── tool implementations ───────────────────────────────────────────────────────

def akb_search_locations(query: str, top_k: int = 15) -> dict:
    """Search the Archive Knowledge Base and return geocoded locations as GeoJSON.

    Runs a hybrid BM25 + semantic search over the ingested document corpus and
    returns a GeoJSON FeatureCollection of all geocoded LOC spans found in the
    matching chunks. Each feature includes the source document title, a text
    excerpt, and a resolved time_context (ISO 8601) where available — suitable
    for time-slider animation in leafmap.

    Args:
        query:  Natural-language search query.
        top_k:  Number of top chunks to retrieve (default 15).

    Returns:
        GeoJSON FeatureCollection ready for leafmap.add_geojson() or
        GeoAgent's add_vector_data tool.
    """
    results = search(query, mode="hybrid", top_k=top_k)
    chunk_ids = [r.chunk_id for r in results]
    rrf_scores = {r.chunk_id: r.rrf_score for r in results}
    with get_conn() as conn:
        features = _loc_features_for_chunks(conn, chunk_ids, rrf_scores)
    return _geojson(features)


def akb_get_timeline_locations(iso_start: str = "", iso_end: str = "") -> dict:
    """Return all geocoded locations filtered to a time window as GeoJSON.

    Queries the NER span table for LOC spans whose co-located TIME spans fall
    within [iso_start, iso_end]. Use ISO 8601 year strings, e.g. '0900', '1500',
    '1960-01-01'. Omit either bound to leave it open.

    Args:
        iso_start:  Earliest ISO date to include (e.g. '0900').
        iso_end:    Latest ISO date to include (e.g. '1500').

    Returns:
        GeoJSON FeatureCollection. time_context property on each feature gives
        the resolved date string for leafmap time-slider use.
    """
    with get_conn() as conn:
        # Join LOC spans with their chunk's TIME spans
        q = """
            SELECT DISTINCT
                n.lat, n.lon, n.normalized_value, n.raw_text, n.chunk_id,
                c.text AS chunk_text, b.title AS block_title, b.source_url,
                t.normalized_value AS time_ctx, t.iso_start, t.iso_end
            FROM ner_spans n
            JOIN chunks c ON n.chunk_id = c.id
            JOIN blocks b ON c.block_id = b.id
            LEFT JOIN ner_spans t
                ON t.chunk_id = n.chunk_id
               AND t.span_type = 'TIME'
               AND t.iso_start IS NOT NULL
            WHERE n.span_type = 'LOC' AND n.lat IS NOT NULL
        """
        params: list[str] = []
        if iso_start:
            q += " AND (t.iso_start IS NULL OR t.iso_start >= ?)"
            params.append(iso_start)
        if iso_end:
            q += " AND (t.iso_end IS NULL OR t.iso_end <= ?)"
            params.append(iso_end)
        q += " ORDER BY t.iso_start NULLS LAST"
        rows = conn.execute(q, params).fetchall()

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {
                "name":         r["normalized_value"] or r["raw_text"],
                "block_title":  r["block_title"],
                "source_url":   r["source_url"] or "",
                "excerpt":      r["chunk_text"][:220].replace("\n", " "),
                "time_context": r["time_ctx"] or "",
                "iso_start":    r["iso_start"] or "",
                "iso_end":      r["iso_end"] or "",
            },
        }
        for r in rows
    ]
    return _geojson(features)


def akb_get_entity_network(place_name: str) -> dict:
    """Return all corpus knowledge about a named place: co-entities, time refs, excerpts.

    Finds every chunk that mentions place_name (fuzzy match on normalized and raw
    LOC span values), then returns the chunk text and all co-located NER spans
    (TIME, PERSON, ORG, KEYWORD). Use to build a relational picture of what the
    archive says about a specific location — who acted there, when, under what
    organisations.

    Args:
        place_name: Place name to look up (partial match accepted).

    Returns:
        Dict with 'location_queried', 'occurrence_count', and 'occurrences' list.
        Each occurrence has source, excerpt, and co_entities broken out by type.
    """
    with get_conn() as conn:
        loc_spans = conn.execute(
            """
            SELECT n.*, c.text AS chunk_text, b.title AS block_title, b.source_url
            FROM ner_spans n
            JOIN chunks c ON n.chunk_id = c.id
            JOIN blocks b ON c.block_id = b.id
            WHERE n.span_type = 'LOC'
              AND (LOWER(n.normalized_value) LIKE ? OR LOWER(n.raw_text) LIKE ?)
            """,
            (f"%{place_name.lower()}%", f"%{place_name.lower()}%"),
        ).fetchall()

        occurrences = []
        seen_chunks: set[str] = set()
        for span in loc_spans:
            cid = span["chunk_id"]
            if cid in seen_chunks:
                continue
            seen_chunks.add(cid)

            co_spans = conn.execute(
                "SELECT span_type, normalized_value, raw_text FROM ner_spans "
                "WHERE chunk_id = ? AND span_type != 'LOC'",
                (cid,),
            ).fetchall()

            by_type: dict[str, list[str]] = {}
            for s in co_spans:
                val = s["normalized_value"] or s["raw_text"]
                by_type.setdefault(s["span_type"], [])
                if val not in by_type[s["span_type"]]:
                    by_type[s["span_type"]].append(val)

            occurrences.append({
                "block_title":  span["block_title"],
                "source_url":   span["source_url"] or "",
                "location":     span["normalized_value"] or span["raw_text"],
                "lat":          span["lat"],
                "lon":          span["lon"],
                "excerpt":      span["chunk_text"][:300].replace("\n", " "),
                "co_entities":  by_type,
            })

    return {
        "location_queried":  place_name,
        "occurrence_count":  len(occurrences),
        "occurrences":       occurrences,
    }


def akb_export_geojson(block_title_filter: str = "") -> dict:
    """Export the full geocoded knowledge base as GeoJSON, optionally filtered by document.

    Returns all resolved LOC spans across the corpus (or a single document if
    block_title_filter is provided). Suitable for loading as a static map layer.

    Args:
        block_title_filter: Substring to match against block titles (case-insensitive).
                            Empty string returns all documents.

    Returns:
        GeoJSON FeatureCollection.
    """
    with get_conn() as conn:
        q = """
            SELECT n.lat, n.lon, n.normalized_value, n.raw_text, n.chunk_id,
                   c.text AS chunk_text, b.title AS block_title, b.source_url
            FROM ner_spans n
            JOIN chunks c ON n.chunk_id = c.id
            JOIN blocks b ON c.block_id = b.id
            WHERE n.span_type = 'LOC' AND n.lat IS NOT NULL
        """
        params: list[str] = []
        if block_title_filter:
            q += " AND LOWER(b.title) LIKE ?"
            params.append(f"%{block_title_filter.lower()}%")

        rows = conn.execute(q, params).fetchall()

        time_by_chunk: dict[str, str] = {}
        if rows:
            cids = list({r["chunk_id"] for r in rows})
            ph = ",".join("?" * len(cids))
            for t in conn.execute(
                f"SELECT chunk_id, normalized_value, iso_start FROM ner_spans "
                f"WHERE span_type='TIME' AND iso_start IS NOT NULL AND chunk_id IN ({ph})",
                cids,
            ).fetchall():
                if t["chunk_id"] not in time_by_chunk:
                    time_by_chunk[t["chunk_id"]] = t["normalized_value"] or t["iso_start"]

    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
            "properties": {
                "name":         r["normalized_value"] or r["raw_text"],
                "block_title":  r["block_title"],
                "source_url":   r["source_url"] or "",
                "excerpt":      r["chunk_text"][:220].replace("\n", " "),
                "time_context": time_by_chunk.get(r["chunk_id"], ""),
            },
        }
        for r in rows
    ]
    return _geojson(features)


# ── GeoAgent wiring ────────────────────────────────────────────────────────────

def _wrap_geo_tool(fn):
    """Apply @geo_tool if geoagent is installed; otherwise return fn unchanged."""
    try:
        from geoagent import geo_tool
        return geo_tool(fn)
    except ImportError:
        return fn


AKB_TOOLS = [
    _wrap_geo_tool(akb_search_locations),
    _wrap_geo_tool(akb_get_timeline_locations),
    _wrap_geo_tool(akb_get_entity_network),
    _wrap_geo_tool(akb_export_geojson),
]


def make_agent(map=None, model: str = "claude-sonnet-4-6", **kwargs):
    """Create a GeoAgent pre-loaded with all akb tools.

    Args:
        map:    A leafmap.Map instance to bind for live rendering (optional).
        model:  LLM model identifier (default: claude-sonnet-4-6).
        **kwargs: Passed through to GeoAgent().

    Returns:
        A GeoAgent instance with akb tools registered.

    Example:
        import leafmap
        from akb.cli.geoagent_tools import make_agent
        m = leafmap.Map()
        agent = make_agent(map=m)
        agent.run("Show all 9th-15th century water management sites on the map")
    """
    try:
        from geoagent import GeoAgent, GeoAgentContext, GeoAgentConfig
    except ImportError as e:
        raise ImportError(
            "geoagent is not installed. Run: pip install geoagent"
        ) from e

    config = GeoAgentConfig(model=model)
    ctx = GeoAgentContext(map=map) if map is not None else GeoAgentContext()
    return GeoAgent(tools=AKB_TOOLS, config=config, context=ctx, **kwargs)
