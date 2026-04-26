"""akb resolve — geocode LOC spans and normalize TIME spans using neighbor context."""

import re
import sys
from pathlib import Path

from rich.console import Console
from rich.progress import track

from cli.db import (get_chunks_for_block, get_conn, get_neighbor_chunks,
                    get_spans_for_chunk, insert_run, list_blocks)

console = Console()

# ── Geo resolution ─────────────────────────────────────────────────────────────

def _load_geocoder():
    """Load the offline geocoder from libs/."""
    libs_path = Path(__file__).parent.parent.parent / "libs"
    sys.path.insert(0, str(libs_path))
    try:
        from offline_geocoder.geocoder import OfflineGeocoder
        assets = Path(__file__).parent.parent.parent / "src" / "python" / "assets"
        return OfflineGeocoder(
            cities_path=str(assets / "cities500.txt"),
            countries_path=str(assets / "countryInfo.txt"),
            regions_path=str(assets / "admin1CodesASCII.txt"),
        )
    except ImportError:
        try:
            from geopy.geocoders import Nominatim
            console.print("[yellow]offline_geocoder not available, falling back to Nominatim[/yellow]")
            return Nominatim(user_agent="akb/0.1")
        except Exception as e:
            console.print(f"[red]No geocoder available: {e}[/red]")
            return None


def _build_context_hints(neighbor_chunks, conn) -> list[str]:
    """Extract place names from neighboring chunks as disambiguation hints."""
    hints = []
    for nc in neighbor_chunks:
        spans = get_spans_for_chunk(conn, nc["id"])
        for s in spans:
            if s["span_type"] == "LOC" and s["normalized_value"]:
                hints.append(s["normalized_value"])
            elif s["span_type"] == "LOC" and s["raw_text"]:
                hints.append(s["raw_text"])
    return hints


def _geocode_with_fallback(geocoder, place_name: str, hints: list[str]) -> dict | None:
    """Try geocoding with context hints, then fall back to bare name."""
    if geocoder is None:
        return None
    try:
        # OfflineGeocoder uses .lookup() with optional GeocodeHints
        if hasattr(geocoder, "lookup"):
            try:
                from offline_geocoder.models import GeocodeHints
                hint_obj = GeocodeHints(context_text=" ".join(hints)) if hints else None
            except ImportError:
                hint_obj = None
            result = geocoder.lookup(place_name, hints=hint_obj)
            if result and isinstance(result, dict):
                name = (result.get("match") or {}).get("name", place_name)
                return {"lat": result.get("latitude"), "lon": result.get("longitude"),
                        "normalized": name, "confidence": 0.8}
        # Nominatim fallback (geopy)
        elif hasattr(geocoder, "geocode"):
            query = f"{place_name}, {hints[0]}" if hints else place_name
            loc = geocoder.geocode(query, timeout=5)
            if loc:
                return {"lat": loc.latitude, "lon": loc.longitude,
                        "normalized": loc.address, "confidence": 0.6}
    except Exception as e:
        console.print(f"  [dim]Geocoding failed for {place_name!r}: {e}[/dim]")
    return None


def resolve_geo(conn, block_id: str, context_window: int, min_confidence: float,
                run_id: str) -> int:
    geocoder = _load_geocoder()
    chunks = get_chunks_for_block(conn, block_id)
    updated = 0

    for chunk in chunks:
        loc_spans = [s for s in get_spans_for_chunk(conn, chunk["id"])
                     if s["span_type"] == "LOC" and s["lat"] is None]
        if not loc_spans:
            continue

        neighbors = get_neighbor_chunks(conn, chunk["id"], context_window)
        hints = _build_context_hints(neighbors, conn)

        for span in loc_spans:
            result = _geocode_with_fallback(geocoder, span["raw_text"], hints)
            if result and result["confidence"] >= min_confidence:
                conn.execute(
                    "UPDATE ner_spans SET lat=?, lon=?, geo_confidence=?, "
                    "normalized_value=?, ner_run_id=? WHERE id=?",
                    (result["lat"], result["lon"], result["confidence"],
                     result["normalized"], run_id, span["id"]),
                )
                updated += 1

    return updated


# ── Chrono resolution ──────────────────────────────────────────────────────────

_CENTURY_RE = re.compile(
    r"(\d+)(?:st|nd|rd|th)\s+century\s*(BC|BCE|AD|CE)?", re.IGNORECASE
)
_YEAR_RE = re.compile(r"\b(\d{3,4})\s*(BC|BCE|AD|CE)?\b")


def _parse_date_string(raw: str) -> tuple[str | None, str | None, str | None]:
    """Return (iso_start, iso_end, timex_value) or (None, None, None)."""
    import dateparser

    raw_clean = raw.strip()

    # Century pattern: "12th century BC"
    m = _CENTURY_RE.search(raw_clean)
    if m:
        n = int(m.group(1))
        era = (m.group(2) or "AD").upper()
        if era in ("BC", "BCE"):
            end = -(n - 1) * 100
            start = end - 99
        else:
            start = (n - 1) * 100 + 1
            end = n * 100
        return (f"{start:04d}", f"{end:04d}", f"CX{n}{era}")

    # Try dateparser
    parsed = dateparser.parse(
        raw_clean,
        settings={"PREFER_DAY_OF_MONTH": "first", "RETURN_AS_TIMEZONE_AWARE": False},
    )
    if parsed:
        iso = parsed.date().isoformat()
        return (iso, iso, f"T{iso}")

    # Bare year
    m = _YEAR_RE.search(raw_clean)
    if m:
        year = int(m.group(1))
        era = (m.group(2) or "AD").upper()
        if era in ("BC", "BCE"):
            year = -year
        return (f"{year:04d}", f"{year:04d}", f"T{year:04d}")

    return (None, None, None)


def _find_anchor_date(neighbors, conn) -> str | None:
    """Find the nearest already-resolved TIME span in neighboring chunks."""
    for nc in neighbors:
        spans = get_spans_for_chunk(conn, nc["id"])
        for s in spans:
            if s["span_type"] == "TIME" and s["iso_start"]:
                return s["iso_start"]
    return None


def resolve_chrono(conn, block_id: str, context_window: int, run_id: str) -> int:
    chunks = get_chunks_for_block(conn, block_id)
    updated = 0

    for chunk in chunks:
        time_spans = [s for s in get_spans_for_chunk(conn, chunk["id"])
                      if s["span_type"] == "TIME" and s["iso_start"] is None]
        if not time_spans:
            continue

        neighbors = get_neighbor_chunks(conn, chunk["id"], context_window)

        for span in time_spans:
            iso_start, iso_end, timex = _parse_date_string(span["raw_text"])

            # If still unresolved, check if it looks relative and use anchor
            if not iso_start and any(
                w in span["raw_text"].lower()
                for w in ("following", "previous", "next", "last", "that year",
                          "same year", "earlier", "later")
            ):
                anchor = _find_anchor_date(neighbors, conn)
                if anchor:
                    normalized = f"~{anchor} (relative: {span['raw_text']!r})"
                    conn.execute(
                        "UPDATE ner_spans SET normalized_value=?, timex_value=?, "
                        "chrono_confidence=?, ner_run_id=? WHERE id=?",
                        (normalized, f"REL:{anchor}", 0.4, run_id, span["id"]),
                    )
                    updated += 1
                continue

            if iso_start:
                conn.execute(
                    "UPDATE ner_spans SET iso_start=?, iso_end=?, timex_value=?, "
                    "normalized_value=?, chrono_confidence=?, ner_run_id=? WHERE id=?",
                    (iso_start, iso_end, timex, f"{iso_start}–{iso_end}",
                     0.85, run_id, span["id"]),
                )
                updated += 1

    return updated


# ── Command entrypoints ────────────────────────────────────────────────────────

def resolve_geo_command(block_id: str | None, all_blocks: bool,
                        context_window: int, min_confidence: float, force: bool) -> None:
    with get_conn() as conn:
        blocks = _resolve_target_blocks(conn, block_id, all_blocks)
        run_id = insert_run(conn, "resolve-geo", None,
                            {"context_window": context_window, "min_confidence": min_confidence})
        total = 0
        for block in track(blocks, description="Resolving geo..."):
            n = resolve_geo(conn, block["id"], context_window, min_confidence, run_id)
            console.print(f"  {block['title'] or block['id']}: {n} LOC spans geocoded")
            total += n
    console.print(f"[green]Done.[/green] {total} locations resolved.")


def resolve_chrono_command(block_id: str | None, all_blocks: bool,
                           context_window: int, force: bool) -> None:
    with get_conn() as conn:
        blocks = _resolve_target_blocks(conn, block_id, all_blocks)
        run_id = insert_run(conn, "resolve-chrono", None,
                            {"context_window": context_window})
        total = 0
        for block in track(blocks, description="Resolving chrono..."):
            n = resolve_chrono(conn, block["id"], context_window, run_id)
            console.print(f"  {block['title'] or block['id']}: {n} TIME spans resolved")
            total += n
    console.print(f"[green]Done.[/green] {total} dates resolved.")


def _resolve_target_blocks(conn, block_id, all_blocks):
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
