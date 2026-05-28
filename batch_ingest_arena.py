"""
Batch-ingest downloaded Are.na markdown files directly into the akb SQLite database.
Reads frontmatter from each .md file and calls insert_block() directly.
"""

import re
import sys
from pathlib import Path

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn

from cli.db import BLOCKS_DIR, DATA_DIR, get_conn, init_db, insert_block

console = Console()


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML-ish frontmatter from '---...---\\n\\n{body}'."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm_text = text[3:end].strip()
    body = text[end + 4:].lstrip("\n")
    meta = {}
    for line in fm_text.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta, body


def main():
    init_db()

    # Find all arena-downloaded markdown files (those with arena_channel frontmatter)
    all_md = sorted(BLOCKS_DIR.glob("*.md"))
    console.print(f"[bold]Batch ingest[/bold] — {len(all_md)} markdown files in {BLOCKS_DIR}")

    new_count = 0
    skip_count = 0
    err_count = 0

    with get_conn() as conn:
        existing_ids = {
            row[0] for row in conn.execute("SELECT id FROM blocks").fetchall()
        }

    console.print(f"  {len(existing_ids)} blocks already in DB")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
        console=console,
        transient=True,
    ) as progress:
        task = progress.add_task("Ingesting...", total=len(all_md))

        # Batch in chunks of 500 for efficiency
        batch: list[tuple] = []

        def flush():
            nonlocal new_count
            if not batch:
                return
            with get_conn() as conn:
                conn.executemany(
                    "INSERT OR REPLACE INTO blocks(id, source_url, title, md_path, ingested_at) "
                    "VALUES (?,?,?,?,datetime('now'))",
                    batch,
                )
            new_count += len(batch)
            batch.clear()

        for md_path in all_md:
            progress.advance(task)
            try:
                text = md_path.read_text(encoding="utf-8")
                meta, _ = parse_frontmatter(text)

                block_id = meta.get("block_id")
                if not block_id:
                    # Skip files without our frontmatter (legacy files)
                    skip_count += 1
                    continue

                if block_id in existing_ids:
                    skip_count += 1
                    continue

                source_url = meta.get("source") or None
                title = meta.get("title") or md_path.stem
                rel_path = str(md_path.relative_to(DATA_DIR.parent))

                batch.append((block_id, source_url, title, rel_path))
                existing_ids.add(block_id)

                if len(batch) >= 500:
                    flush()

            except Exception as exc:
                console.print(f"[red]Error {md_path.name}: {exc}[/red]")
                err_count += 1

        flush()

    console.print(f"\n[bold green]Done![/bold green]")
    console.print(f"  New: {new_count}")
    console.print(f"  Skipped (already ingested): {skip_count}")
    console.print(f"  Errors: {err_count}")
    console.print(f"\nNext: uv run -m cli.main chunk --all --force")


if __name__ == "__main__":
    main()
