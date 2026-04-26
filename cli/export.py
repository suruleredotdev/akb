"""akb export — GeoJSON, KML, TIMEX JSON/XML, and entity table exports."""

import json
import sys
from pathlib import Path

from rich.console import Console

from cli.db import get_conn, get_spans_for_block, list_blocks

console = Console()


def _target_blocks(conn, block_id: str | None, all_blocks: bool):
    if all_blocks:
        return list_blocks(conn)
    elif block_id:
        row = conn.execute("SELECT * FROM blocks WHERE id=?", (block_id,)).fetchone()
        if not row:
            console.print(f"[red]Block not found: {block_id}[/red]")
            sys.exit(1)
        return [row]
    else:
        console.print("[red]Provide --block-id or --all[/red]")
        sys.exit(1)


def _chunk_excerpt(conn, chunk_id: str, max_len: int = 200) -> str:
    row = conn.execute("SELECT text FROM chunks WHERE id=?", (chunk_id,)).fetchone()
    if not row:
        return ""
    text = row["text"].replace("\n", " ").strip()
    return text[:max_len] + ("…" if len(text) > max_len else "")


# ── GeoJSON ────────────────────────────────────────────────────────────────────

def export_geojson(conn, blocks) -> dict:
    features = []
    for block in blocks:
        loc_spans = [s for s in get_spans_for_block(conn, block["id"], "LOC")
                     if s["lat"] is not None and s["lon"] is not None]
        # Also pull associated TIME spans per chunk for context
        time_by_chunk: dict[str, str] = {}
        for ts in get_spans_for_block(conn, block["id"], "TIME"):
            if ts["iso_start"] and ts["chunk_id"] not in time_by_chunk:
                time_by_chunk[ts["chunk_id"]] = ts["normalized_value"] or ts["iso_start"]

        for span in loc_spans:
            excerpt = _chunk_excerpt(conn, span["chunk_id"])
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [span["lon"], span["lat"]],
                },
                "properties": {
                    "name": span["normalized_value"] or span["raw_text"],
                    "raw_text": span["raw_text"],
                    "block_id": block["id"],
                    "block_title": block["title"],
                    "chunk_id": span["chunk_id"],
                    "excerpt": excerpt,
                    "time_context": time_by_chunk.get(span["chunk_id"], ""),
                    "geo_confidence": span["geo_confidence"],
                },
            })

    return {"type": "FeatureCollection", "features": features}


# ── KML ────────────────────────────────────────────────────────────────────────

def export_kml(conn, blocks) -> str:
    try:
        import simplekml
    except ImportError:
        console.print("[red]simplekml not installed. Run: pip install simplekml[/red]")
        sys.exit(1)

    kml = simplekml.Kml()
    for block in blocks:
        folder = kml.newfolder(name=block["title"] or block["id"])
        loc_spans = [s for s in get_spans_for_block(conn, block["id"], "LOC")
                     if s["lat"] is not None and s["lon"] is not None]
        time_by_chunk: dict[str, str] = {}
        for ts in get_spans_for_block(conn, block["id"], "TIME"):
            if ts["iso_start"] and ts["chunk_id"] not in time_by_chunk:
                time_by_chunk[ts["chunk_id"]] = ts["iso_start"]

        for span in loc_spans:
            excerpt = _chunk_excerpt(conn, span["chunk_id"])
            pnt = folder.newpoint(
                name=span["normalized_value"] or span["raw_text"],
                coords=[(span["lon"], span["lat"])],
                description=f"{excerpt}\n\nSource: {block['title']}\n"
                            f"Time context: {time_by_chunk.get(span['chunk_id'], 'unknown')}",
            )
            # Attach timespan if available
            time_str = time_by_chunk.get(span["chunk_id"])
            if time_str and len(time_str) >= 4:
                try:
                    pnt.timespan.begin = time_str[:10]
                except Exception:
                    pass

    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".kml", delete=False) as f:
        kml.save(f.name)
        content = Path(f.name).read_text(encoding="utf-8")
        os.unlink(f.name)
    return content


# ── TIMEX JSON ─────────────────────────────────────────────────────────────────

def export_timex_json(conn, blocks) -> list[dict]:
    output = []
    for block in blocks:
        time_spans = get_spans_for_block(conn, block["id"], "TIME")
        doc = {
            "block_id": block["id"],
            "block_title": block["title"],
            "source_url": block["source_url"],
            "timex_spans": [],
        }
        for span in time_spans:
            excerpt = _chunk_excerpt(conn, span["chunk_id"])
            doc["timex_spans"].append({
                "id": span["id"],
                "chunk_id": span["chunk_id"],
                "raw_text": span["raw_text"],
                "normalized_value": span["normalized_value"],
                "iso_start": span["iso_start"],
                "iso_end": span["iso_end"],
                "timex_value": span["timex_value"],
                "chrono_confidence": span["chrono_confidence"],
                "excerpt": excerpt,
            })
        output.append(doc)
    return output


# ── TIMEX3 XML ─────────────────────────────────────────────────────────────────

def export_timex3_xml(conn, blocks) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<TimeML>"]
    for block in blocks:
        lines.append(f'  <DOC id="{block["id"]}" title="{block["title"] or ""}">',)
        time_spans = get_spans_for_block(conn, block["id"], "TIME")
        for span in time_spans:
            tid = f"t{span['id'][:8]}"
            val = span["timex_value"] or span["iso_start"] or "UNKNOWN"
            raw = span["raw_text"].replace('"', "&quot;").replace("<", "&lt;")
            lines.append(
                f'    <TIMEX3 tid="{tid}" type="DATE" value="{val}"'
                f' chunk_id="{span["chunk_id"]}">{raw}</TIMEX3>'
            )
        lines.append("  </DOC>")
    lines.append("</TimeML>")
    return "\n".join(lines)


# ── Entity table ───────────────────────────────────────────────────────────────

def export_entities_json(conn, blocks, span_type: str | None = None) -> list[dict]:
    out = []
    for block in blocks:
        spans = get_spans_for_block(conn, block["id"], span_type)
        for span in spans:
            out.append({
                "block_id": block["id"],
                "block_title": block["title"],
                "chunk_id": span["chunk_id"],
                "span_type": span["span_type"],
                "raw_text": span["raw_text"],
                "normalized_value": span["normalized_value"],
                "lat": span["lat"],
                "lon": span["lon"],
                "iso_start": span["iso_start"],
                "iso_end": span["iso_end"],
            })
    return out


# ── Command entrypoints ────────────────────────────────────────────────────────

def export_geo_command(block_id: str | None, all_blocks: bool,
                       fmt: str, out: str | None) -> None:
    with get_conn() as conn:
        blocks = _target_blocks(conn, block_id, all_blocks)
        if fmt == "geojson":
            content = json.dumps(export_geojson(conn, blocks), indent=2)
            ext = "geojson"
        else:
            content = export_kml(conn, blocks)
            ext = "kml"

    _write_or_print(content, out, ext, f"geo.{ext}")


def export_chrono_command(block_id: str | None, all_blocks: bool,
                          fmt: str, out: str | None) -> None:
    with get_conn() as conn:
        blocks = _target_blocks(conn, block_id, all_blocks)
        if fmt == "timex-json":
            content = json.dumps(export_timex_json(conn, blocks), indent=2)
            ext = "json"
        else:
            content = export_timex3_xml(conn, blocks)
            ext = "xml"

    _write_or_print(content, out, ext, f"chrono.{ext}")


def export_entities_command(block_id: str | None, all_blocks: bool,
                            span_type: str | None, fmt: str, out: str | None) -> None:
    with get_conn() as conn:
        blocks = _target_blocks(conn, block_id, all_blocks)
        data = export_entities_json(conn, blocks, span_type)

    if fmt == "csv":
        import csv, io
        buf = io.StringIO()
        if data:
            writer = csv.DictWriter(buf, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)
        content = buf.getvalue()
        _write_or_print(content, out, "csv", "entities.csv")
    else:
        content = json.dumps(data, indent=2)
        _write_or_print(content, out, "json", "entities.json")


def _write_or_print(content: str, out: str | None, ext: str, default_name: str) -> None:
    if out:
        path = Path(out)
        path.write_text(content, encoding="utf-8")
        console.print(f"[green]Wrote:[/green] {path} ({path.stat().st_size} bytes)")
    else:
        print(content)
