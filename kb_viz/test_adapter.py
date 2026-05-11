"""Synthetic end-to-end test: build an akb-shaped SQLite, run export_manifest,
verify the resulting manifest validates and contains the expected structure."""

from __future__ import annotations

import json
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from kb_viz.akb_adapter import export_manifest, ExportOptions
from kb_viz.schema import Manifest


def build_synthetic_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    conn.executescript(
        """
        CREATE TABLE blocks (
            id INTEGER PRIMARY KEY,
            title TEXT,
            source TEXT,
            ingested_at TEXT,
            text TEXT
        );
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY,
            block_id INTEGER,
            text TEXT,
            chunk_index INTEGER,
            embedding BLOB,
            prev_chunk_id INTEGER,
            next_chunk_id INTEGER,
            start_offset INTEGER,
            end_offset INTEGER
        );
        CREATE TABLE ner_spans (
            id INTEGER PRIMARY KEY,
            chunk_id INTEGER,
            type TEXT,
            text TEXT,
            start_offset INTEGER,
            end_offset INTEGER,
            confidence REAL,
            lat REAL,
            lng REAL,
            resolved_name TEXT,
            geo_accuracy_m REAL,
            iso_start TEXT,
            iso_end TEXT,
            granularity TEXT,
            entity_id TEXT
        );
        CREATE TABLE processing_runs (
            id INTEGER PRIMARY KEY,
            step TEXT,
            model TEXT,
            config TEXT,
            timestamp TEXT
        );
        """
    )

    def emb(values: list[float]) -> bytes:
        return struct.pack(f"<{len(values)}f", *values)

    conn.executemany(
        "INSERT INTO blocks VALUES (?,?,?,?,?)",
        [
            (1, "Lake Chad climate report", "https://example.org/lake-chad.pdf",
             "2026-04-01T12:00:00Z", "Full text of report ..."),
            (2, "Yoruba ritual objects", "data/yoruba.md",
             "2026-04-15T09:00:00Z", "Ethnographic survey ..."),
        ],
    )
    conn.executemany(
        "INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?,?)",
        [
            (1, 1, "Climate displacement around Lake Chad has accelerated since 1990.",
             0, emb([0.1, 0.2, 0.3, 0.4]), None, 2, 0, 64),
            (2, 1, "Maiduguri saw an influx of 200,000 IDPs by 2015.",
             1, emb([0.15, 0.25, 0.35, 0.45]), 1, None, 64, 112),
            (3, 2, "Carved ivory objects were collected near Ile-Ife in 1898.",
             0, emb([0.5, 0.6, 0.7, 0.8]), None, None, 0, 60),
        ],
    )
    conn.executemany(
        "INSERT INTO ner_spans VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            # chunk 1: Lake Chad (LOC) + 1990 (TIME)
            (1, 1, "LOC", "Lake Chad", 32, 41, 0.95,
             13.0, 14.5, "Lake Chad", 5000.0, None, None, None, None),
            (2, 1, "TIME", "1990", 60, 64, 0.99,
             None, None, None, None, "1990-01-01", "1990-12-31", "year", None),
            # chunk 2: Maiduguri (LOC) + 2015 (TIME) + 200000 (KEYWORD)
            (3, 2, "LOC", "Maiduguri", 0, 9, 0.92,
             11.85, 13.16, "Maiduguri", 2000.0, None, None, None, None),
            (4, 2, "TIME", "2015", 44, 48, 0.99,
             None, None, None, None, "2015-01-01", "2015-12-31", "year", None),
            (5, 2, "KEYWORD", "IDPs", 30, 34, 0.80,
             None, None, None, None, None, None, None, "kw:idp"),
            # chunk 3: Ile-Ife (LOC) + 1898 (TIME)
            (6, 3, "LOC", "Ile-Ife", 31, 38, 0.93,
             7.49, 4.55, "Ile-Ife", 1500.0, None, None, None, None),
            (7, 3, "TIME", "1898", 42, 46, 0.99,
             None, None, None, None, "1898-01-01", "1898-12-31", "year", None),
        ],
    )
    conn.executemany(
        "INSERT INTO processing_runs VALUES (?,?,?,?,?)",
        [
            (1, "embed", "fastembed:BAAI/bge-small-en-v1.5",
             '{"dim": 384}', "2026-04-15T10:00:00Z"),
            (2, "ner", "spacy:en_core_web_sm",
             "{}", "2026-04-15T10:05:00Z"),
        ],
    )
    conn.commit()
    conn.close()


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "akb.sqlite"
        build_synthetic_db(db)
        manifest = export_manifest(db, label="Smoke test")

        # Round-trip through JSON to validate Manifest model.
        data = json.loads(manifest.model_dump_json())
        reparsed = Manifest.model_validate(data)

        # Counts
        nodes_by_type: dict[str, int] = {}
        for n in reparsed.nodes:
            nodes_by_type[n.type] = nodes_by_type.get(n.type, 0) + 1
        assert nodes_by_type == {"document": 2, "chunk": 3, "expression": 7}, (
            f"unexpected node counts: {nodes_by_type}"
        )

        # Embeddings present on chunks
        chunks = [n for n in reparsed.nodes if n.type == "chunk"]
        assert all(c.embedding is not None for c in chunks), "missing embeddings"
        assert len(chunks[0].embedding) == 4

        # Properties computed
        c0 = next(c for c in chunks if c.id == "chunk:1")
        assert c0.properties["length"]["value"] > 0
        assert c0.properties["link_count"]["value"] == 2.0  # 2 spans in chunk 1

        # Annotations attached
        exprs = [n for n in reparsed.nodes if n.type == "expression"]
        geo_anns = [a for e in exprs for a in e.annotations if a.type == "geographic"]
        tem_anns = [a for e in exprs for a in e.annotations if a.type == "temporal"]
        ent_anns = [a for e in exprs for a in e.annotations if a.type == "entity_ref"]
        assert len(geo_anns) == 3, f"expected 3 geo, got {len(geo_anns)}"
        assert len(tem_anns) == 3, f"expected 3 temporal, got {len(tem_anns)}"
        assert len(ent_anns) == 1, f"expected 1 entity, got {len(ent_anns)}"

        # Edges (next chunk in document 1)
        next_edges = [e for e in reparsed.edges if e.type == "next"]
        assert len(next_edges) == 1, f"expected 1 next edge, got {len(next_edges)}"
        assert next_edges[0].source == "chunk:1"
        assert next_edges[0].target == "chunk:2"

        # Document summary computed
        doc1 = next(n for n in reparsed.nodes if n.id == "doc:1")
        assert doc1.summary is not None
        assert "map" in doc1.summary.frame_summaries
        assert "timeline" in doc1.summary.frame_summaries
        assert doc1.summary.frame_summaries["map"].count == 2  # Lake Chad + Maiduguri
        assert doc1.summary.frame_summaries["timeline"].count == 2

        # Provenance
        assert reparsed.provenance is not None
        assert len(reparsed.provenance.runs) == 2

        print("OK: all assertions passed")
        print(
            f"  - {sum(nodes_by_type.values())} nodes "
            f"({nodes_by_type})"
        )
        print(f"  - {len(reparsed.edges)} edges")
        print(
            f"  - {sum(len(e.annotations) for e in exprs)} annotations across "
            f"{len(exprs)} expressions"
        )
        print(
            f"  - doc:1 summary: "
            f"{doc1.summary.descendant_count} descendants, "
            f"frames {list(doc1.summary.frame_summaries.keys())}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
