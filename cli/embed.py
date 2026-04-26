"""akb embed — generate vector embeddings for chunks."""

import struct
import sys

from rich.console import Console
from rich.progress import track

from cli.db import get_conn, insert_run, list_blocks, update_chunk_embedding

console = Console()

SUPPORTED_MODELS = {
    "all-MiniLM-L6-v2": "sentence-transformers/all-MiniLM-L6-v2",
    "nomic-embed-text": "nomic-ai/nomic-embed-text-v1",
}


def _load_model(model_name: str):
    from sentence_transformers import SentenceTransformer
    model_key = SUPPORTED_MODELS.get(model_name, model_name)
    console.print(f"Loading embedding model: [cyan]{model_key}[/cyan]")
    kwargs = {}
    if model_name == "nomic-embed-text":
        kwargs["trust_remote_code"] = True
    return SentenceTransformer(model_key, **kwargs)


def _pack(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def embed_command(block_id: str | None, all_blocks: bool, model_name: str,
                  batch_size: int, force: bool) -> None:
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

        # Collect chunks needing embeddings
        target_chunks: list[tuple[str, str]] = []  # (chunk_id, text)
        for block in blocks:
            q = "SELECT id, text FROM chunks WHERE block_id=?"
            if not force:
                q += " AND embedding IS NULL"
            rows = conn.execute(q, (block["id"],)).fetchall()
            target_chunks.extend((r["id"], r["text"]) for r in rows)

        if not target_chunks:
            console.print("[yellow]No chunks need embedding. Use --force to re-embed.[/yellow]")
            return

        console.print(f"Embedding {len(target_chunks)} chunks with [cyan]{model_name}[/cyan]")
        model = _load_model(model_name)
        run_id = insert_run(conn, "embed", model_name, {"batch_size": batch_size})

        for i in track(range(0, len(target_chunks), batch_size),
                       description="Embedding..."):
            batch = target_chunks[i:i + batch_size]
            texts = [t for _, t in batch]
            vecs = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
            for (chunk_id, _), vec in zip(batch, vecs):
                update_chunk_embedding(conn, chunk_id, _pack(vec.tolist()), run_id)

    console.print(f"[green]Done.[/green] {len(target_chunks)} embeddings written.")
