"""akb embed — generate vector embeddings for chunks.

Uses fastembed (ONNX-based, no torch) by default — works on all platforms
including Intel Mac. Pass --backend sentence-transformers to use torch-based
embeddings if you have a GPU setup.
"""

import struct
import sys

from rich.console import Console
from rich.progress import track

from cli.db import get_conn, insert_run, list_blocks, update_chunk_embedding

console = Console()

# fastembed model names (ONNX, no torch required)
FASTEMBED_MODELS = {
    "all-MiniLM-L6-v2": "sentence-transformers/all-MiniLM-L6-v2",
    "bge-small-en":      "BAAI/bge-small-en-v1.5",
    "bge-base-en":       "BAAI/bge-base-en-v1.5",
    "nomic-embed-text":  "nomic-ai/nomic-embed-text-v1.5",
}

# sentence-transformers HF names (requires torch)
ST_MODELS = {
    "all-MiniLM-L6-v2": "sentence-transformers/all-MiniLM-L6-v2",
    "nomic-embed-text":  "nomic-ai/nomic-embed-text-v1",
}

DEFAULT_MODEL = "all-MiniLM-L6-v2"


def _load_fastembed(model_name: str):
    try:
        from fastembed import TextEmbedding
    except ImportError:
        console.print("[red]fastembed not installed. Run: pip install fastembed[/red]")
        sys.exit(1)
    hf_name = FASTEMBED_MODELS.get(model_name, model_name)
    console.print(f"Loading fastembed model: [cyan]{hf_name}[/cyan]")
    return TextEmbedding(model_name=hf_name)


def _load_sentence_transformers(model_name: str):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        console.print(
            "[red]sentence-transformers not installed. "
            "Run: pip install sentence-transformers[/red]\n"
            "[yellow]Or omit --backend to use the default fastembed backend.[/yellow]"
        )
        sys.exit(1)
    hf_name = ST_MODELS.get(model_name, model_name)
    console.print(f"Loading sentence-transformers model: [cyan]{hf_name}[/cyan]")
    kwargs = {"trust_remote_code": True} if "nomic" in model_name else {}
    return SentenceTransformer(hf_name, **kwargs)


def _pack(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _embed_batch_fastembed(model, texts: list[str]) -> list[list[float]]:
    return [list(v) for v in model.embed(texts)]


def _embed_batch_st(model, texts: list[str]) -> list[list[float]]:
    return model.encode(texts, show_progress_bar=False, normalize_embeddings=True).tolist()


def embed_command(block_id: str | None, all_blocks: bool, model_name: str,
                  backend: str, batch_size: int, force: bool) -> None:
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

        target_chunks: list[tuple[str, str]] = []
        for block in blocks:
            q = "SELECT id, text FROM chunks WHERE block_id=?"
            if not force:
                q += " AND embedding IS NULL"
            rows = conn.execute(q, (block["id"],)).fetchall()
            target_chunks.extend((r["id"], r["text"]) for r in rows)

        if not target_chunks:
            console.print("[yellow]No chunks need embedding. Use --force to re-embed.[/yellow]")
            return

        console.print(
            f"Embedding {len(target_chunks)} chunks "
            f"[cyan]{model_name}[/cyan] via [cyan]{backend}[/cyan]"
        )

        if backend == "fastembed":
            model = _load_fastembed(model_name)
            embed_fn = lambda texts: _embed_batch_fastembed(model, texts)
        else:
            model = _load_sentence_transformers(model_name)
            embed_fn = lambda texts: _embed_batch_st(model, texts)

        run_id = insert_run(conn, "embed", model_name,
                            {"backend": backend, "batch_size": batch_size})

        for i in track(range(0, len(target_chunks), batch_size),
                       description="Embedding..."):
            batch = target_chunks[i:i + batch_size]
            texts = [t for _, t in batch]
            vecs = embed_fn(texts)
            for (chunk_id, _), vec in zip(batch, vecs):
                update_chunk_embedding(conn, chunk_id, _pack(vec), run_id)

    console.print(f"[green]Done.[/green] {len(target_chunks)} embeddings written.")
