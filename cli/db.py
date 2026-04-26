"""SQLite database layer — schema, connection, and helpers."""

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import sqlite_vec

DATA_DIR = Path(__file__).parent.parent / "data"
DB_PATH = DATA_DIR / "archive.db"
BLOCKS_DIR = DATA_DIR / "blocks"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


@contextmanager
def get_conn(db_path: Path = DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS processing_runs (
    id         TEXT PRIMARY KEY,
    run_type   TEXT NOT NULL,
    model      TEXT,
    config     TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
    id          TEXT PRIMARY KEY,
    source_url  TEXT,
    title       TEXT,
    md_path     TEXT NOT NULL,
    ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    id            TEXT PRIMARY KEY,
    block_id      TEXT NOT NULL REFERENCES blocks(id),
    chunk_run_id  TEXT REFERENCES processing_runs(id),
    embed_run_id  TEXT REFERENCES processing_runs(id),
    position      INTEGER NOT NULL,
    text          TEXT NOT NULL,
    embedding     BLOB,
    prev_chunk_id TEXT REFERENCES chunks(id),
    next_chunk_id TEXT REFERENCES chunks(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content=chunks,
    content_rowid=rowid
);

CREATE TABLE IF NOT EXISTS ner_spans (
    id                TEXT PRIMARY KEY,
    chunk_id          TEXT NOT NULL REFERENCES chunks(id),
    ner_run_id        TEXT REFERENCES processing_runs(id),
    span_type         TEXT NOT NULL,
    raw_text          TEXT NOT NULL,
    normalized_value  TEXT,
    lat               REAL,
    lon               REAL,
    geo_confidence    REAL,
    iso_start         TEXT,
    iso_end           TEXT,
    timex_value       TEXT,
    chrono_confidence REAL
);

CREATE INDEX IF NOT EXISTS idx_chunks_block    ON chunks(block_id);
CREATE INDEX IF NOT EXISTS idx_chunks_pos      ON chunks(block_id, position);
CREATE INDEX IF NOT EXISTS idx_spans_chunk     ON ner_spans(chunk_id);
CREATE INDEX IF NOT EXISTS idx_spans_type_val  ON ner_spans(span_type, normalized_value);
CREATE INDEX IF NOT EXISTS idx_spans_geo       ON ner_spans(lat, lon)           WHERE span_type='LOC';
CREATE INDEX IF NOT EXISTS idx_spans_chrono    ON ner_spans(iso_start, iso_end) WHERE span_type='TIME';
"""


def init_db(db_path: Path = DB_PATH) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BLOCKS_DIR.mkdir(parents=True, exist_ok=True)
    with get_conn(db_path) as conn:
        conn.executescript(SCHEMA)


# ── processing runs ───────────────────────────────────────────────────────────

def insert_run(conn: sqlite3.Connection, run_type: str, model: str | None, config: dict) -> str:
    run_id = new_id()
    conn.execute(
        "INSERT INTO processing_runs VALUES (?,?,?,?,?)",
        (run_id, run_type, model, json.dumps(config), _now()),
    )
    return run_id


# ── blocks ────────────────────────────────────────────────────────────────────

def insert_block(conn: sqlite3.Connection, block_id: str, source_url: str | None,
                 title: str | None, md_path: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO blocks VALUES (?,?,?,?,?)",
        (block_id, source_url, title, md_path, _now()),
    )


def get_block(conn: sqlite3.Connection, block_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()


def list_blocks(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM blocks ORDER BY ingested_at DESC").fetchall()


# ── chunks ────────────────────────────────────────────────────────────────────

def insert_chunk(conn: sqlite3.Connection, chunk_id: str, block_id: str, run_id: str,
                 position: int, text: str, prev_id: str | None, next_id: str | None) -> None:
    conn.execute(
        "INSERT INTO chunks(id,block_id,chunk_run_id,position,text,prev_chunk_id,next_chunk_id) "
        "VALUES (?,?,?,?,?,?,?)",
        (chunk_id, block_id, run_id, position, text, prev_id, next_id),
    )
    conn.execute("INSERT INTO chunks_fts(rowid,text) VALUES (last_insert_rowid(),?)", (text,))


def update_chunk_embedding(conn: sqlite3.Connection, chunk_id: str,
                           embedding: bytes, embed_run_id: str) -> None:
    conn.execute(
        "UPDATE chunks SET embedding=?, embed_run_id=? WHERE id=?",
        (embedding, embed_run_id, chunk_id),
    )


def get_chunks_for_block(conn: sqlite3.Connection, block_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM chunks WHERE block_id=? ORDER BY position", (block_id,)
    ).fetchall()


def get_chunk(conn: sqlite3.Connection, chunk_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM chunks WHERE id=?", (chunk_id,)).fetchone()


def get_neighbor_chunks(conn: sqlite3.Connection, chunk_id: str,
                        window: int = 3) -> list[sqlite3.Row]:
    """Return up to `window` chunks before and after the given chunk."""
    chunk = get_chunk(conn, chunk_id)
    if not chunk:
        return []
    pos = chunk["position"]
    block_id = chunk["block_id"]
    return conn.execute(
        "SELECT * FROM chunks WHERE block_id=? AND position BETWEEN ? AND ? AND id!=? "
        "ORDER BY position",
        (block_id, pos - window, pos + window, chunk_id),
    ).fetchall()


# ── ner spans ─────────────────────────────────────────────────────────────────

def insert_span(conn: sqlite3.Connection, span_id: str, chunk_id: str, run_id: str,
                span_type: str, raw_text: str, normalized_value: str | None = None,
                lat: float | None = None, lon: float | None = None,
                geo_confidence: float | None = None, iso_start: str | None = None,
                iso_end: str | None = None, timex_value: str | None = None,
                chrono_confidence: float | None = None) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO ner_spans VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (span_id, chunk_id, run_id, span_type, raw_text, normalized_value,
         lat, lon, geo_confidence, iso_start, iso_end, timex_value, chrono_confidence),
    )


def get_spans_for_chunk(conn: sqlite3.Connection, chunk_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM ner_spans WHERE chunk_id=? ORDER BY span_type", (chunk_id,)
    ).fetchall()


def get_spans_for_block(conn: sqlite3.Connection, block_id: str,
                        span_type: str | None = None) -> list[sqlite3.Row]:
    q = """
        SELECT n.* FROM ner_spans n
        JOIN chunks c ON n.chunk_id = c.id
        WHERE c.block_id=?
    """
    params: list = [block_id]
    if span_type:
        q += " AND n.span_type=?"
        params.append(span_type)
    return conn.execute(q, params).fetchall()


def find_spans_by_entity(conn: sqlite3.Connection, span_type: str,
                         normalized_value: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM ner_spans WHERE span_type=? AND normalized_value=?",
        (span_type, normalized_value),
    ).fetchall()
