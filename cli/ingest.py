"""akb ingest — fetch a URL or local file and store as Markdown."""

import hashlib
import re
import sys
from pathlib import Path

import httpx
from rich.console import Console

from cli.db import BLOCKS_DIR, get_conn, init_db, insert_block

console = Console()


def _slug(text: str, max_len: int = 48) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower())
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text[:max_len]


def _block_id(source: str) -> str:
    return hashlib.sha256(source.encode()).hexdigest()[:16]


def _fetch_url(url: str) -> tuple[str, str]:
    """Return (title, markdown_text) for a URL."""
    try:
        from markdownify import markdownify
        from bs4 import BeautifulSoup

        resp = httpx.get(url, follow_redirects=True, timeout=30,
                         headers={"User-Agent": "akb/0.1 archive-knowledge-base"})
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")

        if "pdf" in content_type or url.lower().endswith(".pdf"):
            return _fetch_pdf_bytes(resp.content, url)

        soup = BeautifulSoup(resp.text, "html.parser")
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else url

        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()

        body = soup.find("article") or soup.find("main") or soup.find("body") or soup
        md = markdownify(str(body), heading_style="ATX", strip=["a"])
        md = re.sub(r"\n{3,}", "\n\n", md).strip()
        return title, md

    except Exception as exc:
        console.print(f"[red]Failed to fetch URL: {exc}[/red]")
        sys.exit(1)


def _fetch_pdf_bytes(content: bytes, source: str) -> tuple[str, str]:
    try:
        import pymupdf4llm
        import tempfile, os
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(content)
            tmp = f.name
        md = pymupdf4llm.to_markdown(tmp)
        os.unlink(tmp)
        title = Path(source).stem.replace("-", " ").replace("_", " ").title()
        return title, md
    except Exception as exc:
        console.print(f"[red]PDF extraction failed: {exc}[/red]")
        sys.exit(1)


def _fetch_pdf_path(path: Path) -> tuple[str, str]:
    try:
        import pymupdf4llm
        md = pymupdf4llm.to_markdown(str(path))
        title = path.stem.replace("-", " ").replace("_", " ").title()
        return title, md
    except Exception as exc:
        console.print(f"[red]PDF extraction failed: {exc}[/red]")
        sys.exit(1)


def _fetch_wikipedia(url: str) -> tuple[str, str]:
    """Use wikipedia-api for cleaner extraction of Wikipedia pages."""
    try:
        import wikipediaapi
        # Extract article title from URL
        slug = url.rstrip("/").split("/wiki/")[-1].replace("_", " ")
        wiki = wikipediaapi.Wikipedia("akb/0.1", "en")
        page = wiki.page(slug)
        if not page.exists():
            return _fetch_url(url)
        sections = []
        for s in page.sections:
            sections.append(f"## {s.title}\n\n{s.text}")
        md = f"# {page.title}\n\n{page.summary}\n\n" + "\n\n".join(sections)
        return page.title, md
    except Exception:
        return _fetch_url(url)


def ingest(source: str, title: str | None = None, force: bool = False) -> str:
    """Ingest a URL or file path. Returns block_id."""
    init_db()
    block_id = _block_id(source)

    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM blocks WHERE id=?", (block_id,)).fetchone()
        if existing and not force:
            console.print(f"[yellow]Already ingested (id={block_id}). Use --force to re-ingest.[/yellow]")
            return block_id

    # Determine source type and extract markdown
    path = Path(source)
    if path.exists():
        if path.suffix.lower() == ".pdf":
            auto_title, md = _fetch_pdf_path(path)
        elif path.suffix.lower() in (".md", ".txt"):
            auto_title = path.stem.replace("-", " ").replace("_", " ").title()
            md = path.read_text(encoding="utf-8")
        else:
            console.print(f"[red]Unsupported file type: {path.suffix}[/red]")
            sys.exit(1)
        source_url = None
    elif source.startswith("http"):
        source_url = source
        if "wikipedia.org/wiki/" in source:
            auto_title, md = _fetch_wikipedia(source)
        else:
            auto_title, md = _fetch_url(source)
    else:
        console.print(f"[red]Source not found: {source}[/red]")
        sys.exit(1)

    final_title = title or auto_title

    # Write .md file
    safe = _slug(final_title) or block_id
    md_path = BLOCKS_DIR / f"{block_id}_{safe}.md"
    header = f"---\ntitle: {final_title}\nsource: {source}\nblock_id: {block_id}\n---\n\n"
    md_path.write_text(header + md, encoding="utf-8")

    with get_conn() as conn:
        insert_block(conn, block_id, source_url, final_title,
                     str(md_path.relative_to(Path(__file__).parent.parent)))

    console.print(f"[green]Ingested:[/green] {final_title}")
    console.print(f"  id:   {block_id}")
    console.print(f"  file: {md_path.name}")
    return block_id
