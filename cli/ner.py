"""akb ner — extract named entity spans from chunks using spaCy."""

import sys
from typing import Sequence

from rich.console import Console
from rich.progress import track

from cli.db import (get_chunks_for_block, get_conn, insert_run, insert_span,
                    list_blocks, new_id)

console = Console()

# spaCy label → our span_type
LABEL_MAP = {
    "GPE": "LOC",
    "LOC": "LOC",
    "FAC": "LOC",
    "DATE": "TIME",
    "TIME": "TIME",
    "PERSON": "PERSON",
    "NORP": "ORG",
    "ORG": "ORG",
    "EVENT": "KEYWORD",
    "WORK_OF_ART": "KEYWORD",
    "LAW": "KEYWORD",
    "LANGUAGE": "KEYWORD",
    "PRODUCT": "KEYWORD",
}

ALL_TYPES = {"LOC", "TIME", "PERSON", "ORG", "KEYWORD"}


def _load_nlp(model: str):
    import spacy
    try:
        return spacy.load(model)
    except OSError:
        console.print(f"[yellow]Model {model!r} not found, downloading...[/yellow]")
        import subprocess
        subprocess.run([sys.executable, "-m", "spacy", "download", model], check=True)
        return spacy.load(model)


def _extract_spans(nlp, text: str, types: set[str]) -> list[dict]:
    doc = nlp(text)
    seen: set[str] = set()
    spans = []
    for ent in doc.ents:
        span_type = LABEL_MAP.get(ent.label_)
        if not span_type or span_type not in types:
            continue
        key = f"{span_type}:{ent.text.strip().lower()}"
        if key in seen:
            continue
        seen.add(key)
        spans.append({
            "span_type": span_type,
            "raw_text": ent.text.strip(),
        })
    return spans


def ner_command(block_id: str | None, all_blocks: bool, model: str,
                types: Sequence[str], force: bool) -> None:
    active_types = set(t.upper() for t in types) & ALL_TYPES

    with get_conn() as conn:
        if all_blocks:
            blocks = list_blocks(conn)
        elif block_id:
            row = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
            if not row:
                console.print(f"[red]Block not found: {block_id}[/red]")
                sys.exit(1)
            blocks = [row]
        else:
            console.print("[red]Provide --block-id or --all[/red]")
            sys.exit(1)

        nlp = _load_nlp(model)
        run_id = insert_run(conn, "ner", model, {"types": sorted(active_types)})
        total = 0

        for block in blocks:
            chunks = get_chunks_for_block(conn, block["id"])
            if not chunks:
                console.print(f"  [yellow]No chunks for {block['id']} — run `akb chunk` first[/yellow]")
                continue

            console.print(f"NER: [cyan]{block['title'] or block['id']}[/cyan] ({len(chunks)} chunks)")

            for chunk in track(chunks, description="  Extracting..."):
                if not force:
                    existing = conn.execute(
                        "SELECT COUNT(*) FROM ner_spans WHERE chunk_id=? AND ner_run_id=?",
                        (chunk["id"], run_id),
                    ).fetchone()[0]
                    if existing:
                        continue

                spans = _extract_spans(nlp, chunk["text"], active_types)
                for span in spans:
                    insert_span(
                        conn,
                        span_id=new_id(),
                        chunk_id=chunk["id"],
                        run_id=run_id,
                        span_type=span["span_type"],
                        raw_text=span["raw_text"],
                    )
                total += len(spans)

        console.print(f"[green]Done.[/green] {total} NER spans written.")
