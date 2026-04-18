"""akb — Archive Knowledge Base CLI."""

from __future__ import annotations

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(
    name="akb",
    help="Archive Knowledge Base — local-first multi-dimensional document analysis.",
    no_args_is_help=True,
)
resolve_app = typer.Typer(help="Resolve geo and chrono spans using neighbor context.")
app.add_typer(resolve_app, name="resolve")

export_app = typer.Typer(help="Export NER data to GeoJSON, KML, TIMEX, CSV.")
app.add_typer(export_app, name="export")

console = Console()


# ── ingest ────────────────────────────────────────────────────────────────────

@app.command()
def ingest(
    source: str = typer.Argument(..., help="URL or local file path"),
    title: str = typer.Option(None, help="Override document title"),
    force: bool = typer.Option(False, "--force", help="Re-ingest even if already exists"),
):
    """Fetch a URL or local file and store as Markdown."""
    from cli.ingest import ingest as _ingest
    _ingest(source, title=title, force=force)


# ── chunk ─────────────────────────────────────────────────────────────────────

@app.command()
def chunk(
    block_id: str = typer.Option(None, "--block-id", "-b", help="Block ID to chunk"),
    all_blocks: bool = typer.Option(False, "--all", help="Chunk all ingested blocks"),
    strategy: str = typer.Option("markdown", "--strategy", "-s",
                                 help="Chunking strategy: markdown | fixed"),
    chunk_size: int = typer.Option(512, "--chunk-size", help="Max tokens per chunk"),
    overlap: int = typer.Option(64, "--overlap", help="Token overlap between chunks"),
    force: bool = typer.Option(False, "--force", help="Re-chunk even if chunks exist"),
):
    """Split block Markdown into indexed chunks."""
    from cli.chunk import chunk_command
    chunk_command(block_id, all_blocks, strategy, chunk_size, overlap, force)


# ── embed ─────────────────────────────────────────────────────────────────────

@app.command()
def embed(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    model: str = typer.Option("all-MiniLM-L6-v2", "--model", "-m",
                               help="Model: all-MiniLM-L6-v2 | bge-small-en | nomic-embed-text"),
    backend: str = typer.Option("fastembed", "--backend",
                                 help="fastembed (default, no torch) | sentence-transformers"),
    batch_size: int = typer.Option(32, "--batch-size"),
    force: bool = typer.Option(False, "--force"),
):
    """Generate vector embeddings for chunks. Uses fastembed (ONNX) by default — no torch needed."""
    from cli.embed import embed_command
    embed_command(block_id, all_blocks, model, backend, batch_size, force)


# ── ner ───────────────────────────────────────────────────────────────────────

@app.command()
def ner(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    model: str = typer.Option("en_core_web_sm", "--model", "-m",
                               help="spaCy model: en_core_web_sm | en_core_web_trf"),
    types: str = typer.Option("LOC,TIME,PERSON,ORG,KEYWORD", "--types",
                               help="Comma-separated span types to extract"),
    force: bool = typer.Option(False, "--force"),
):
    """Extract named entity spans (LOC, TIME, PERSON, ORG, KEYWORD) from chunks."""
    from cli.ner import ner_command
    ner_command(block_id, all_blocks, model, types.split(","), force)


# ── resolve ───────────────────────────────────────────────────────────────────

@resolve_app.command("geo")
def resolve_geo(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    context_window: int = typer.Option(3, "--context-window",
                                        help="Neighbor chunks to use for disambiguation"),
    min_confidence: float = typer.Option(0.5, "--min-confidence"),
    force: bool = typer.Option(False, "--force"),
):
    """Geocode LOC spans using offline geocoder + neighbor context."""
    from cli.resolve import resolve_geo_command
    resolve_geo_command(block_id, all_blocks, context_window, min_confidence, force)


@resolve_app.command("chrono")
def resolve_chrono(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    context_window: int = typer.Option(3, "--context-window"),
    force: bool = typer.Option(False, "--force"),
):
    """Normalize TIME spans to ISO 8601 using dateparser + neighbor anchor resolution."""
    from cli.resolve import resolve_chrono_command
    resolve_chrono_command(block_id, all_blocks, context_window, force)


# ── search ────────────────────────────────────────────────────────────────────

@app.command()
def search(
    query: str = typer.Argument(..., help="Search query"),
    mode: str = typer.Option("hybrid", "--mode", help="bm25 | vector | hybrid"),
    top_k: int = typer.Option(10, "--top-k", "-k"),
    llm: bool = typer.Option(False, "--llm", help="Synthesize answer with LLM"),
    llm_model: str = typer.Option("claude-sonnet-4-6", "--llm-model"),
    output_format: str = typer.Option("text", "--format", help="text | json"),
):
    """Search the knowledge base. Hybrid BM25 + vector with optional LLM synthesis."""
    from cli.search import search_command
    search_command(query, mode, top_k, llm, llm_model, output_format)


# ── export ────────────────────────────────────────────────────────────────────

@export_app.command("geo")
def export_geo(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    fmt: str = typer.Option("geojson", "--format", help="geojson | kml"),
    out: str = typer.Option(None, "--out", "-o", help="Output file (default: stdout)"),
):
    """Export geocoded LOC spans as GeoJSON or KML."""
    from cli.export import export_geo_command
    export_geo_command(block_id, all_blocks, fmt, out)


@export_app.command("chrono")
def export_chrono(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    fmt: str = typer.Option("timex-json", "--format", help="timex-json | timex3-xml"),
    out: str = typer.Option(None, "--out", "-o"),
):
    """Export TIME spans as TIMEX JSON or TIMEX3 XML."""
    from cli.export import export_chrono_command
    export_chrono_command(block_id, all_blocks, fmt, out)


@export_app.command("entities")
def export_entities(
    block_id: str = typer.Option(None, "--block-id", "-b"),
    all_blocks: bool = typer.Option(False, "--all"),
    span_type: str = typer.Option(None, "--type", help="LOC | TIME | PERSON | ORG | KEYWORD"),
    fmt: str = typer.Option("json", "--format", help="json | csv"),
    out: str = typer.Option(None, "--out", "-o"),
):
    """Export NER spans as JSON or CSV for external analysis."""
    from cli.export import export_entities_command
    export_entities_command(block_id, all_blocks, span_type, fmt, out)


# ── serve ─────────────────────────────────────────────────────────────────────

@app.command()
def serve(
    port: int = typer.Option(8765, "--port", "-p"),
    host: str = typer.Option("127.0.0.1", "--host"),
):
    """Start local HTTP + MCP server for UI and Claude Code integration."""
    import uvicorn
    from mcp.server import create_app
    uvicorn.run(create_app(), host=host, port=port, log_level="info")


# ── status ────────────────────────────────────────────────────────────────────

@app.command()
def status():
    """Show database statistics."""
    from cli.db import get_conn, DB_PATH
    if not DB_PATH.exists():
        console.print("[yellow]No database found. Run `akb ingest` first.[/yellow]")
        raise typer.Exit()

    with get_conn() as conn:
        blocks = conn.execute("SELECT COUNT(*) FROM blocks").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        embedded = conn.execute("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL").fetchone()[0]
        spans = conn.execute("SELECT span_type, COUNT(*) as n FROM ner_spans GROUP BY span_type").fetchall()
        runs = conn.execute(
            "SELECT run_type, model, config, created_at FROM processing_runs "
            "ORDER BY created_at DESC LIMIT 5"
        ).fetchall()

    t = Table(title="akb status", show_header=True)
    t.add_column("Metric"); t.add_column("Value", justify="right")
    t.add_row("Blocks", str(blocks))
    t.add_row("Chunks", str(chunks))
    t.add_row("Embedded chunks", str(embedded))
    for span in spans:
        t.add_row(f"NER spans ({span['span_type']})", str(span["n"]))
    t.add_row("DB size", f"{DB_PATH.stat().st_size // 1024} KB")
    console.print(t)

    if runs:
        console.print("\n[bold]Recent processing runs:[/bold]")
        for r in runs:
            console.print(f"  {r['run_type']} · {r['model'] or 'n/a'} · {r['created_at'][:19]}")


if __name__ == "__main__":
    app()
