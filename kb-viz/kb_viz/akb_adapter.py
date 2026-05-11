"""akb -> kb-viz manifest adapter.

Reads from an akb SQLite database (default path: `akb/data/archive.db`) and emits
a Manifest. Column names are configurable via `AkbColumnMap` so this can adapt
to akb schema changes without touching the conversion logic.

The adapter does NOT compute embedding-based summaries (UMAP centroids of
descendants in semantic space) -- those are deferred to the consumer because
UMAP fitting is corpus-wide work. It DOES compute:

  - Geographic summaries (centroid, bbox, hull) from annotation lat/lng
  - Temporal summaries (min/max, histogram) from annotation ISO dates
  - Length/position properties on chunks
  - link_count properties wherever cross-references exist

Usage:
    from kb_viz.akb_adapter import export_manifest
    manifest = export_manifest("akb/data/archive.db")
    Path("manifest.json").write_text(manifest.model_dump_json(indent=2))
"""

from __future__ import annotations

import json
import sqlite3
import struct
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .schema import (
    Annotation,
    Edge,
    FrameSummary,
    GeographicValue,
    Manifest,
    Node,
    NodeSummary,
    Provenance,
    ProcessingRun,
    TemporalValue,
    EntityRefValue,
    default_akb_schema,
)


# ---------------------------------------------------------------------------
# Configurable column mapping
# ---------------------------------------------------------------------------


@dataclass
class AkbColumnMap:
    """Maps logical fields to actual SQLite column names.

    Defaults follow the README's described data model. Override any field if the
    actual akb DDL differs.
    """

    # blocks (one row per ingested document)
    blocks_table: str = "blocks"
    block_id: str = "id"
    block_title: str = "title"
    block_source: str = "source"  # URL or file path
    block_ingested_at: str = "ingested_at"
    block_text: str = "text"  # full document text, optional

    # chunks (text segments with embeddings)
    chunks_table: str = "chunks"
    chunk_id: str = "id"
    chunk_block_id: str = "block_id"
    chunk_text: str = "text"
    chunk_index: str = "chunk_index"  # ordinal within block
    chunk_embedding: str = "embedding"  # BLOB or sqlite-vec vector
    chunk_prev_id: str = "prev_chunk_id"
    chunk_next_id: str = "next_chunk_id"
    chunk_start: str = "start_offset"  # char offset within block.text
    chunk_end: str = "end_offset"

    # ner_spans (typed annotations within chunks)
    spans_table: str = "ner_spans"
    span_id: str = "id"
    span_chunk_id: str = "chunk_id"
    span_type: str = "type"  # LOC | TIME | PERSON | ORG | KEYWORD
    span_text: str = "text"
    span_start: str = "start_offset"
    span_end: str = "end_offset"
    span_confidence: str = "confidence"
    # geo resolution (LOC)
    span_lat: str = "lat"
    span_lng: str = "lng"
    span_geo_name: str = "resolved_name"
    span_geo_accuracy_m: str = "geo_accuracy_m"
    # chrono resolution (TIME)
    span_iso_start: str = "iso_start"
    span_iso_end: str = "iso_end"
    span_granularity: str = "granularity"
    # entity resolution (PERSON / ORG / KEYWORD)
    span_entity_id: str = "entity_id"
    span_entity_name: str = "resolved_name"

    # processing_runs (provenance)
    runs_table: str = "processing_runs"
    run_id: str = "id"
    run_step: str = "step"
    run_model: str = "model"
    run_config: str = "config"  # JSON-serialized
    run_timestamp: str = "timestamp"


# ---------------------------------------------------------------------------
# Embedding decoding
# ---------------------------------------------------------------------------


def decode_embedding(blob: bytes | None) -> list[float] | None:
    """Decode an embedding blob.

    `sqlite-vec` stores vectors as little-endian f32 packed bytes. We try that
    first; fall back to JSON if the blob doesn't decode as f32.
    """
    if blob is None:
        return None
    if isinstance(blob, str):
        try:
            return json.loads(blob)
        except json.JSONDecodeError:
            return None
    if not isinstance(blob, (bytes, bytearray, memoryview)):
        return None
    raw = bytes(blob)
    if len(raw) % 4 == 0:
        try:
            count = len(raw) // 4
            return list(struct.unpack(f"<{count}f", raw))
        except struct.error:
            pass
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


# ---------------------------------------------------------------------------
# Annotation construction from ner_spans
# ---------------------------------------------------------------------------


_GEO_TYPES = {"LOC", "GPE", "FAC"}
_TIME_TYPES = {"TIME", "DATE"}


def _row(row: sqlite3.Row, key: str, default: Any = None) -> Any:
    """Safely read a column from a sqlite3.Row, returning default if missing."""
    try:
        value = row[key]
    except (IndexError, KeyError):
        return default
    return value if value is not None else default


def span_to_annotation(row: sqlite3.Row, cols: AkbColumnMap) -> Annotation | None:
    """Convert one ner_spans row into a typed Annotation.

    Returns None if the span has no resolvable typed value (e.g. an unresolved
    KEYWORD with no entity_id).
    """
    span_type = _row(row, cols.span_type, "")
    start = _row(row, cols.span_start)
    end = _row(row, cols.span_end)
    span = (int(start), int(end)) if start is not None and end is not None else None
    confidence = _row(row, cols.span_confidence)
    span_id = str(_row(row, cols.span_id))

    if span_type in _GEO_TYPES:
        lat = _row(row, cols.span_lat)
        lng = _row(row, cols.span_lng)
        if lat is None or lng is None:
            return None
        value = GeographicValue(
            lat=float(lat),
            lng=float(lng),
            accuracy_m=_row(row, cols.span_geo_accuracy_m),
            name=_row(row, cols.span_geo_name) or _row(row, cols.span_text),
        )
        return Annotation(
            id=span_id,
            type="geographic",
            span=span,
            value=value.model_dump(),
            confidence=confidence,
            source="akb:resolve_geo",
        )

    if span_type in _TIME_TYPES:
        iso_start = _row(row, cols.span_iso_start)
        if iso_start is None:
            return None
        value = TemporalValue(
            iso_start=str(iso_start),
            iso_end=_row(row, cols.span_iso_end),
            granularity=_row(row, cols.span_granularity, "day"),
            raw=_row(row, cols.span_text),
        )
        return Annotation(
            id=span_id,
            type="temporal",
            span=span,
            value=value.model_dump(),
            confidence=confidence,
            source="akb:resolve_chrono",
        )

    # PERSON / ORG / KEYWORD -> entity_ref
    entity_id = _row(row, cols.span_entity_id) or _row(row, cols.span_text)
    if entity_id is None:
        return None
    value = EntityRefValue(
        entity_id=str(entity_id),
        entity_type=str(span_type) if span_type else None,
        name=_row(row, cols.span_entity_name) or _row(row, cols.span_text),
    )
    return Annotation(
        id=span_id,
        type="entity_ref",
        span=span,
        value=value.model_dump(),
        confidence=confidence,
        source="akb:ner",
    )


# ---------------------------------------------------------------------------
# Summary computation (geographic + temporal only; semantic is deferred)
# ---------------------------------------------------------------------------


def _geo_summary(coords: list[tuple[float, float]]) -> FrameSummary | None:
    if not coords:
        return None
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]
    centroid = [sum(lngs) / len(lngs), sum(lats) / len(lats)]
    bbox = [min(lngs), min(lats), max(lngs), max(lats)]
    # Hull deferred -- consumer can compute or use bbox as approximation.
    return FrameSummary(count=len(coords), centroid=centroid, bbox=bbox)


def _temporal_summary(iso_starts: list[str]) -> FrameSummary | None:
    if not iso_starts:
        return None
    times: list[float] = []
    for s in iso_starts:
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            times.append(dt.timestamp())
        except (ValueError, TypeError):
            continue
    if not times:
        return None
    centroid = [sum(times) / len(times)]
    bbox = [min(times), max(times)]
    # Coarse 20-bin histogram.
    bins = 20
    span = bbox[1] - bbox[0] or 1.0
    edges = [bbox[0] + i * span / bins for i in range(bins + 1)]
    counts = [0] * bins
    for t in times:
        idx = min(int((t - bbox[0]) / span * bins), bins - 1)
        counts[idx] += 1
    return FrameSummary(
        count=len(times),
        centroid=centroid,
        bbox=bbox,
        histogram=[float(c) for c in counts],
        histogram_bins=edges,
    )


# ---------------------------------------------------------------------------
# Main exporter
# ---------------------------------------------------------------------------


@dataclass
class ExportOptions:
    """Controls what gets included in the manifest."""

    include_text: bool = True
    include_embeddings: bool = True
    include_summaries: bool = True
    chunk_text_max_chars: int | None = None  # truncate chunk.text if set


def _open_db(db_path: str | Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    # Try to load sqlite-vec for embedding decoding compatibility -- if it's
    # not available we still handle BLOB f32 packing manually.
    try:
        conn.enable_load_extension(True)
        conn.load_extension("vec0")
    except (sqlite3.OperationalError, AttributeError):
        pass
    return conn


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
    ).fetchone()
    return row is not None


def export_manifest(
    db_path: str | Path,
    *,
    schema_id: str = "akb_default",
    label: str | None = None,
    cols: AkbColumnMap | None = None,
    options: ExportOptions | None = None,
) -> Manifest:
    """Read akb SQLite db at `db_path` and return a populated Manifest."""
    cols = cols or AkbColumnMap()
    options = options or ExportOptions()

    conn = _open_db(db_path)

    # ---- documents ------------------------------------------------------
    doc_nodes: dict[str, Node] = {}
    block_rows = conn.execute(
        f"SELECT * FROM {cols.blocks_table}"
    ).fetchall()
    for r in block_rows:
        bid = f"doc:{_row(r, cols.block_id)}"
        title = _row(r, cols.block_title) or bid
        source = _row(r, cols.block_source)
        ingested_at = _row(r, cols.block_ingested_at)
        props: dict[str, dict[str, Any]] = {}
        if source is not None:
            props["source"] = {"kind": "categorical", "value": str(source)}
        if ingested_at is not None:
            try:
                ts = datetime.fromisoformat(
                    str(ingested_at).replace("Z", "+00:00")
                ).timestamp()
                props["ingested_at"] = {"kind": "scalar", "value": ts}
            except (ValueError, TypeError):
                pass
        doc_nodes[bid] = Node(
            id=bid,
            type="document",
            properties=props,
            text=(_row(r, cols.block_text) if options.include_text else None),
        )
        # Title is rendered from properties; keep it ergonomic on the consumer
        # side by also putting it under a well-known "label" property.
        doc_nodes[bid].properties["label"] = {
            "kind": "categorical",
            "value": str(title),
        }

    # ---- chunks ---------------------------------------------------------
    chunk_nodes: dict[str, Node] = {}
    chunks_by_doc: dict[str, list[str]] = defaultdict(list)
    chunk_rows = conn.execute(
        f"SELECT * FROM {cols.chunks_table}"
    ).fetchall()
    # Pre-compute total chunk count per block for normalized position.
    chunks_per_doc: dict[str, int] = defaultdict(int)
    for r in chunk_rows:
        chunks_per_doc[f"doc:{_row(r, cols.chunk_block_id)}"] += 1

    for r in chunk_rows:
        cid = f"chunk:{_row(r, cols.chunk_id)}"
        bid = f"doc:{_row(r, cols.chunk_block_id)}"
        text = _row(r, cols.chunk_text, "")
        if options.chunk_text_max_chars is not None and text:
            text = text[: options.chunk_text_max_chars]
        idx = _row(r, cols.chunk_index, 0)
        total = chunks_per_doc.get(bid, 1) or 1
        position = float(idx) / float(total - 1) if total > 1 else 0.0
        length = len(text) if text else 0

        props: dict[str, dict[str, Any]] = {
            "length": {"kind": "scalar", "value": float(length), "unit": "chars"},
            "chunk_index": {"kind": "scalar", "value": float(idx)},
            "position": {"kind": "scalar", "value": position},
        }

        embedding = None
        if options.include_embeddings:
            embedding = decode_embedding(_row(r, cols.chunk_embedding))

        chunk_nodes[cid] = Node(
            id=cid,
            type="chunk",
            parent_id=bid,
            text=(text if options.include_text else None),
            embedding=embedding,
            properties=props,
        )
        chunks_by_doc[bid].append(cid)

    # ---- ner_spans -> expression nodes + annotations --------------------
    expr_nodes: dict[str, Node] = {}
    spans_by_chunk: dict[str, list[str]] = defaultdict(list)
    if _table_exists(conn, cols.spans_table):
        span_rows = conn.execute(
            f"SELECT * FROM {cols.spans_table}"
        ).fetchall()
        for r in span_rows:
            ann = span_to_annotation(r, cols)
            if ann is None:
                continue
            sid = f"expr:{_row(r, cols.span_id)}"
            cid = f"chunk:{_row(r, cols.span_chunk_id)}"
            text = _row(r, cols.span_text, "")
            span_type = _row(r, cols.span_type, "")
            props: dict[str, dict[str, Any]] = {
                "ner_type": {"kind": "categorical", "value": str(span_type)},
                "length": {
                    "kind": "scalar",
                    "value": float(len(text or "")),
                    "unit": "chars",
                },
            }
            expr_nodes[sid] = Node(
                id=sid,
                type="expression",
                parent_id=cid,
                text=(text if options.include_text else None),
                properties=props,
                annotations=[ann],
            )
            spans_by_chunk[cid].append(sid)

    # ---- wire up child_ids ---------------------------------------------
    for did, kids in chunks_by_doc.items():
        if did in doc_nodes:
            doc_nodes[did].child_ids = kids
    for cid, kids in spans_by_chunk.items():
        if cid in chunk_nodes:
            chunk_nodes[cid].child_ids = kids

    # ---- compute link_count for chunks ---------------------------------
    for cid, node in chunk_nodes.items():
        node.properties["link_count"] = {
            "kind": "scalar",
            "value": float(len(spans_by_chunk.get(cid, []))),
        }
    for did, node in doc_nodes.items():
        node.properties["chunk_count"] = {
            "kind": "scalar",
            "value": float(len(chunks_by_doc.get(did, []))),
        }

    # ---- edges: chunk next-links + doc-level similarity (if exposed) ---
    edges: list[Edge] = []
    for r in chunk_rows:
        nxt = _row(r, cols.chunk_next_id)
        if nxt is not None:
            cid = f"chunk:{_row(r, cols.chunk_id)}"
            tgt = f"chunk:{nxt}"
            edges.append(
                Edge(
                    id=f"next:{cid}->{tgt}",
                    source=cid,
                    target=tgt,
                    type="next",
                )
            )

    # ---- summaries on parents ------------------------------------------
    if options.include_summaries:
        for did, node in doc_nodes.items():
            geo_coords: list[tuple[float, float]] = []
            iso_starts: list[str] = []
            descendant_count = 0
            type_counts: dict[str, int] = defaultdict(int)

            for cid in chunks_by_doc.get(did, []):
                descendant_count += 1
                type_counts["chunk"] += 1
                for sid in spans_by_chunk.get(cid, []):
                    descendant_count += 1
                    type_counts["expression"] += 1
                    expr = expr_nodes[sid]
                    for ann in expr.annotations:
                        if ann.type == "geographic":
                            geo_coords.append(
                                (ann.value["lat"], ann.value["lng"])
                            )
                        elif ann.type == "temporal":
                            iso_starts.append(ann.value["iso_start"])

            frame_summaries: dict[str, FrameSummary] = {}
            geo = _geo_summary(geo_coords)
            if geo is not None:
                frame_summaries["map"] = geo
            tem = _temporal_summary(iso_starts)
            if tem is not None:
                frame_summaries["timeline"] = tem

            node.summary = NodeSummary(
                descendant_count=descendant_count,
                child_type_counts=dict(type_counts),
                frame_summaries=frame_summaries,
            )

    # ---- provenance ----------------------------------------------------
    provenance = None
    if _table_exists(conn, cols.runs_table):
        runs: list[ProcessingRun] = []
        for r in conn.execute(f"SELECT * FROM {cols.runs_table}").fetchall():
            cfg_raw = _row(r, cols.run_config, "{}")
            try:
                cfg = (
                    json.loads(cfg_raw) if isinstance(cfg_raw, str) else dict(cfg_raw)
                )
            except (json.JSONDecodeError, TypeError):
                cfg = {}
            runs.append(
                ProcessingRun(
                    id=str(_row(r, cols.run_id)),
                    step=str(_row(r, cols.run_step, "")),
                    model=str(_row(r, cols.run_model, "")),
                    config=cfg,
                    timestamp=str(_row(r, cols.run_timestamp, "")),
                )
            )
        provenance = Provenance(
            runs=runs,
            source_db=str(db_path),
            exported_at=datetime.now(timezone.utc).isoformat(),
        )

    conn.close()

    nodes: list[Node] = (
        list(doc_nodes.values())
        + list(chunk_nodes.values())
        + list(expr_nodes.values())
    )

    schema_defaults = default_akb_schema()
    return Manifest(
        schema_id=schema_id,
        label=label,
        node_types=schema_defaults["node_types"],
        annotation_types=schema_defaults["annotation_types"],
        frames=schema_defaults["frames"],
        nodes=nodes,
        edges=edges,
        provenance=provenance,
    )


# ---------------------------------------------------------------------------
# Optional: Arrow side-loading for large embeddings
# ---------------------------------------------------------------------------


def split_embeddings_to_arrow(
    manifest: Manifest, arrow_path: str | Path
) -> Manifest:
    """Move embeddings out of inline JSON into a side-loaded Arrow file.

    Returns a new manifest with embeddings stripped from nodes and `nodes_url`
    set to the arrow file. Only call this if pyarrow is installed.
    """
    try:
        import pyarrow as pa
        import pyarrow.feather as feather
    except ImportError as e:
        raise RuntimeError(
            "pyarrow required for split_embeddings_to_arrow"
        ) from e

    ids: list[str] = []
    embeddings: list[list[float]] = []
    for n in manifest.nodes:
        if n.embedding is not None:
            ids.append(n.id)
            embeddings.append(n.embedding)
            n.embedding = None

    table = pa.table({"id": ids, "embedding": embeddings})
    feather.write_feather(table, str(arrow_path))
    manifest.nodes_url = str(arrow_path)
    return manifest


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="kb_viz.akb_adapter",
        description="Export an akb SQLite database to a kb-viz manifest JSON.",
    )
    parser.add_argument("db", help="Path to akb SQLite database")
    parser.add_argument("-o", "--out", default="manifest.json", help="Output path")
    parser.add_argument(
        "--no-text",
        action="store_true",
        help="Strip text from output (smaller manifest)",
    )
    parser.add_argument(
        "--no-embeddings",
        action="store_true",
        help="Strip embeddings from output",
    )
    parser.add_argument(
        "--arrow",
        metavar="PATH",
        help="Side-load embeddings to this Arrow file instead of inline",
    )
    parser.add_argument("--schema-id", default="akb_default")
    parser.add_argument("--label", default=None)
    args = parser.parse_args(argv)

    options = ExportOptions(
        include_text=not args.no_text,
        include_embeddings=not args.no_embeddings,
    )
    manifest = export_manifest(
        args.db,
        schema_id=args.schema_id,
        label=args.label,
        options=options,
    )
    if args.arrow:
        manifest = split_embeddings_to_arrow(manifest, args.arrow)

    Path(args.out).write_text(manifest.model_dump_json(indent=2))
    print(
        f"wrote {args.out}: {len(manifest.nodes)} nodes, "
        f"{len(manifest.edges)} edges"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
