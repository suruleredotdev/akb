"""akb search — BM25 + vector hybrid search with optional LLM synthesis."""

import json
import struct
import sys
from dataclasses import dataclass

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from cli.db import get_conn, get_spans_for_chunk

console = Console()


@dataclass
class SearchResult:
    chunk_id: str
    block_id: str
    block_title: str
    position: int
    text: str
    bm25_rank: int | None
    vec_rank: int | None
    rrf_score: float
    spans: list


def _bm25_search(conn, query: str, top_k: int) -> list[tuple[str, int]]:
    """Full-text search via FTS5. Returns [(chunk_id, rank)]."""
    rows = conn.execute(
        """
        SELECT c.id, rank
        FROM chunks_fts f
        JOIN chunks c ON c.rowid = f.rowid
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
        """,
        (query, top_k),
    ).fetchall()
    return [(r["id"], i + 1) for i, r in enumerate(rows)]


def _encode_query(query: str, model_name: str) -> list[float]:
    """Encode a query string using fastembed (primary) or sentence-transformers."""
    from cli.embed import FASTEMBED_MODELS, ST_MODELS
    try:
        from fastembed import TextEmbedding
        hf_name = FASTEMBED_MODELS.get(model_name, model_name)
        model = TextEmbedding(model_name=hf_name)
        return list(next(model.embed([query])))
    except ImportError:
        pass
    try:
        from sentence_transformers import SentenceTransformer
        hf_name = ST_MODELS.get(model_name, model_name)
        model = SentenceTransformer(hf_name)
        return model.encode([query], normalize_embeddings=True)[0].tolist()
    except ImportError:
        raise RuntimeError("No embedding backend available. Run: pip install fastembed")


def _vector_search(conn, query: str, top_k: int, model_name: str) -> list[tuple[str, int]]:
    """Semantic search via sqlite-vec. Returns [(chunk_id, rank)]."""
    try:
        import sqlite_vec

        vec = _encode_query(query, model_name)
        packed = struct.pack(f"{len(vec)}f", *vec)
        dim = len(vec)

        # Check if sqlite-vec virtual table exists; create if not
        existing = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='vec_chunks'"
        ).fetchone()
        if not existing:
            conn.execute(
                f"CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[{dim}])"
            )
            # Populate from chunks
            rows = conn.execute(
                "SELECT rowid, id, embedding FROM chunks WHERE embedding IS NOT NULL"
            ).fetchall()
            for row in rows:
                blob = row["embedding"]
                conn.execute(
                    "INSERT OR REPLACE INTO vec_chunks(rowid, embedding) VALUES (?,?)",
                    (row["rowid"], blob),
                )

        rows = conn.execute(
            """
            SELECT c.id, v.distance
            FROM vec_chunks v
            JOIN chunks c ON c.rowid = v.rowid
            WHERE v.embedding MATCH ? AND k=?
            ORDER BY v.distance
            """,
            (packed, top_k),
        ).fetchall()
        return [(r["id"], i + 1) for i, r in enumerate(rows)]

    except Exception as e:
        console.print(f"[yellow]Vector search unavailable: {e}[/yellow]")
        return []


def _rrf(bm25_ranks: dict[str, int], vec_ranks: dict[str, int],
         k: int = 60) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion."""
    scores: dict[str, float] = {}
    for chunk_id, rank in bm25_ranks.items():
        scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (k + rank)
    for chunk_id, rank in vec_ranks.items():
        scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)


def search(query: str, mode: str = "hybrid", top_k: int = 10,
           model_name: str = "all-MiniLM-L6-v2") -> list[SearchResult]:
    with get_conn() as conn:
        bm25_pairs = _bm25_search(conn, query, top_k * 2) if mode in ("bm25", "hybrid") else []
        vec_pairs = _vector_search(conn, query, top_k * 2, model_name) if mode in ("vector", "hybrid") else []

        bm25_map = {cid: rank for cid, rank in bm25_pairs}
        vec_map = {cid: rank for cid, rank in vec_pairs}

        if mode == "hybrid":
            ranked = _rrf(bm25_map, vec_map)[:top_k]
        elif mode == "bm25":
            ranked = [(cid, 1 / (60 + r)) for cid, r in bm25_pairs[:top_k]]
        else:
            ranked = [(cid, 1 / (60 + r)) for cid, r in vec_pairs[:top_k]]

        results: list[SearchResult] = []
        for chunk_id, rrf_score in ranked:
            chunk = conn.execute(
                "SELECT c.*, b.title as block_title FROM chunks c "
                "JOIN blocks b ON c.block_id = b.id WHERE c.id=?",
                (chunk_id,),
            ).fetchone()
            if not chunk:
                continue
            spans = get_spans_for_chunk(conn, chunk_id)
            results.append(SearchResult(
                chunk_id=chunk_id,
                block_id=chunk["block_id"],
                block_title=chunk["block_title"] or chunk["block_id"],
                position=chunk["position"],
                text=chunk["text"],
                bm25_rank=bm25_map.get(chunk_id),
                vec_rank=vec_map.get(chunk_id),
                rrf_score=rrf_score,
                spans=list(spans),
            ))

    return results


SPAN_COLORS = {"LOC": "blue", "TIME": "green", "PERSON": "yellow",
               "ORG": "magenta", "KEYWORD": "cyan"}


def _format_spans(spans) -> str:
    if not spans:
        return ""
    parts = []
    for s in spans:
        color = SPAN_COLORS.get(s["span_type"], "white")
        val = s["normalized_value"] or s["raw_text"]
        parts.append(f"[{color}]{s['span_type']}[/{color}]:{val}")
    return "  " + " · ".join(parts)


def print_results(results: list[SearchResult], query: str) -> None:
    console.print(f"\n[bold]Results for:[/bold] {query!r} ({len(results)} found)\n")
    for i, r in enumerate(results, 1):
        excerpt = r.text[:300].replace("\n", " ") + ("…" if len(r.text) > 300 else "")
        console.print(f"[bold]{i}.[/bold] [cyan]{r.block_title}[/cyan] §{r.position}")
        console.print(f"   {excerpt}")
        console.print(_format_spans(r.spans))
        console.print(f"   [dim]rrf={r.rrf_score:.4f} bm25={r.bm25_rank} vec={r.vec_rank}[/dim]\n")


def _llm_synthesize(query: str, results: list[SearchResult]) -> str:
    """Synthesize an answer from retrieved chunks using Claude or local LLM."""
    context_parts = []
    for i, r in enumerate(results[:6], 1):
        spans_text = "; ".join(
            f"{s['span_type']}:{s['normalized_value'] or s['raw_text']}"
            for s in r.spans[:5]
        )
        context_parts.append(
            f"[Source {i}: {r.block_title}, §{r.position}]\n"
            f"{r.text[:600]}\n"
            f"Entities: {spans_text}"
        )
    context = "\n\n---\n\n".join(context_parts)

    system = (
        "You are a research assistant synthesizing information from a personal knowledge base. "
        "Answer the question using only the provided sources. "
        "For each claim, cite the source number [1], [2], etc. "
        "Highlight specific named entities (locations, dates, people, organizations) that anchor your answer."
    )
    prompt = f"Question: {query}\n\nSources:\n{context}\n\nAnswer:"

    # Try Anthropic Claude first
    try:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
    except ImportError:
        pass
    except Exception as e:
        console.print(f"[yellow]Claude unavailable: {e}[/yellow]")

    # Fallback: ollama
    try:
        import ollama
        resp = ollama.chat(
            model="llama3",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
        )
        return resp["message"]["content"]
    except Exception as e:
        return f"[LLM unavailable: {e}]\n\nContext retrieved:\n{context[:500]}"


def search_command(query: str, mode: str, top_k: int, llm: bool,
                   llm_model: str, output_format: str) -> None:
    results = search(query, mode=mode, top_k=top_k)

    if not results:
        console.print("[yellow]No results found.[/yellow]")
        return

    if output_format == "json":
        out = []
        for r in results:
            out.append({
                "chunk_id": r.chunk_id,
                "block_id": r.block_id,
                "block_title": r.block_title,
                "position": r.position,
                "text": r.text,
                "rrf_score": r.rrf_score,
                "spans": [dict(s) for s in r.spans],
            })
        print(json.dumps(out, indent=2))
        return

    print_results(results, query)

    if llm:
        console.print("[bold]Synthesizing answer...[/bold]")
        answer = _llm_synthesize(query, results)
        console.print(Panel(answer, title="[bold green]Answer[/bold green]",
                            border_style="green"))

        console.print("\n[bold]Citations:[/bold]")
        for i, r in enumerate(results[:6], 1):
            loc_spans = [s for s in r.spans if s["span_type"] == "LOC"]
            time_spans = [s for s in r.spans if s["span_type"] == "TIME"]
            geo = f" · LOC:{loc_spans[0]['normalized_value'] or loc_spans[0]['raw_text']}" if loc_spans else ""
            time = f" · TIME:{time_spans[0]['normalized_value'] or time_spans[0]['raw_text']}" if time_spans else ""
            console.print(f"  [{i}] {r.block_title} §{r.position}{geo}{time}")
