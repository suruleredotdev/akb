"""akb chunk — split block markdown into indexed chunks."""

import re
import sys
from pathlib import Path

from rich.console import Console

from cli.db import (BLOCKS_DIR, get_conn, insert_chunk, insert_run,
                    list_blocks, new_id)

console = Console()

STRATEGY_MARKDOWN = "markdown"
STRATEGY_FIXED = "fixed"


def _split_markdown(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split on markdown headings first, then subdivide long sections by sentence."""
    heading_re = re.compile(r"^#{1,4}\s+.+$", re.MULTILINE)
    boundaries = [m.start() for m in heading_re.finditer(text)] + [len(text)]
    if not boundaries or boundaries[0] != 0:
        boundaries.insert(0, 0)

    sections: list[str] = []
    for i in range(len(boundaries) - 1):
        section = text[boundaries[i]:boundaries[i + 1]].strip()
        if section:
            sections.append(section)

    chunks: list[str] = []
    for section in sections:
        words = section.split()
        if len(words) <= chunk_size:
            chunks.append(section)
        else:
            # Subdivide by sentences
            sentences = re.split(r"(?<=[.!?])\s+", section)
            current: list[str] = []
            current_len = 0
            for sent in sentences:
                sent_len = len(sent.split())
                if current_len + sent_len > chunk_size and current:
                    chunks.append(" ".join(current))
                    # Overlap: keep last `overlap` words
                    overlap_words = " ".join(current).split()[-overlap:]
                    current = overlap_words + sent.split()
                    current_len = len(current)
                else:
                    current.extend(sent.split())
                    current_len += sent_len
            if current:
                chunks.append(" ".join(current))

    return [c for c in chunks if c.strip()]


def _split_fixed(text: str, chunk_size: int, overlap: int) -> list[str]:
    words = text.split()
    chunks = []
    step = max(1, chunk_size - overlap)
    for i in range(0, len(words), step):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    return chunks


def chunk_block(conn, block_id: str, strategy: str, chunk_size: int,
                overlap: int, force: bool) -> int:
    block = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
    if not block:
        console.print(f"[red]Block not found: {block_id}[/red]")
        return 0

    # Check existing chunks
    existing = conn.execute(
        "SELECT COUNT(*) FROM chunks WHERE block_id=?", (block_id,)
    ).fetchone()[0]
    if existing and not force:
        console.print(f"  [yellow]Already chunked ({existing} chunks). Use --force.[/yellow]")
        return existing

    if force:
        # Delete existing chunks and their FTS entries and NER spans
        old_ids = [r[0] for r in conn.execute(
            "SELECT id FROM chunks WHERE block_id=?", (block_id,)
        ).fetchall()]
        if old_ids:
            placeholders = ",".join("?" * len(old_ids))
            conn.execute(f"DELETE FROM ner_spans WHERE chunk_id IN ({placeholders})", old_ids)
            conn.execute(
                f"DELETE FROM chunks_fts WHERE rowid IN "
                f"(SELECT rowid FROM chunks WHERE id IN ({placeholders}))", old_ids
            )
            conn.execute(f"DELETE FROM chunks WHERE id IN ({placeholders})", old_ids)

    md_path = Path(__file__).parent.parent / block["md_path"]
    text = md_path.read_text(encoding="utf-8")
    # Strip YAML front matter
    if text.startswith("---"):
        end = text.find("---", 3)
        if end != -1:
            text = text[end + 3:].strip()

    if strategy == STRATEGY_MARKDOWN:
        texts = _split_markdown(text, chunk_size, overlap)
    else:
        texts = _split_fixed(text, chunk_size, overlap)

    run_id = insert_run(conn, "chunk", strategy,
                        {"strategy": strategy, "chunk_size": chunk_size, "overlap": overlap})

    ids = [new_id() for _ in texts]

    # Insert without prev/next first (next_chunk_id doesn't exist yet)
    for i, (chunk_id, chunk_text) in enumerate(zip(ids, texts)):
        insert_chunk(conn, chunk_id, block_id, run_id, i, chunk_text, None, None)

    # Second pass: wire up the linked list now all rows exist
    for i, chunk_id in enumerate(ids):
        conn.execute(
            "UPDATE chunks SET prev_chunk_id=?, next_chunk_id=? WHERE id=?",
            (ids[i - 1] if i > 0 else None,
             ids[i + 1] if i < len(ids) - 1 else None,
             chunk_id),
        )

    return len(texts)


def chunk_command(block_id: str | None, all_blocks: bool, strategy: str,
                  chunk_size: int, overlap: int, force: bool) -> None:
    with get_conn() as conn:
        if all_blocks:
            blocks = list_blocks(conn)
        elif block_id:
            blocks = [conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()]
            if not blocks[0]:
                console.print(f"[red]Block not found: {block_id}[/red]")
                sys.exit(1)
        else:
            console.print("[red]Provide --block-id or --all[/red]")
            sys.exit(1)

        total = 0
        for block in blocks:
            console.print(f"Chunking: [cyan]{block['title'] or block['id']}[/cyan]")
            n = chunk_block(conn, block["id"], strategy, chunk_size, overlap, force)
            console.print(f"  → {n} chunks")
            total += n

    console.print(f"\n[green]Done.[/green] {total} total chunks written.")
