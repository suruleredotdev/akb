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

# Static coordinate table for common place names — used when offline geocoder
# and Nominatim are both unavailable (e.g. no network, no GeoNames data).
_STATIC_COORDS: dict[str, tuple[float, float, str]] = {
    # (lat, lon, normalized_name)
    "lake chad":             (13.50,  14.00, "Lake Chad"),
    "nigeria":               ( 9.08,   8.67, "Nigeria"),
    "niger":                 (17.61,   8.08, "Niger"),
    "chad":                  (15.45,  18.73, "Chad"),
    "cameroon":              ( 5.69,  12.35, "Cameroon"),
    "borno state":           (12.00,  13.16, "Borno State, Nigeria"),
    "borno":                 (12.00,  13.16, "Borno State, Nigeria"),
    "yobe state":            (12.29,  11.44, "Yobe State, Nigeria"),
    "yobe":                  (12.29,  11.44, "Yobe State, Nigeria"),
    "adamawa":               ( 9.33,  12.40, "Adamawa State, Nigeria"),
    "maiduguri":             (11.85,  13.16, "Maiduguri, Borno, Nigeria"),
    "damaturu":              (11.75,  11.96, "Damaturu, Yobe, Nigeria"),
    "gwoza":                 (10.88,  13.69, "Gwoza, Borno, Nigeria"),
    "kano":                  (12.00,   8.52, "Kano, Nigeria"),
    "kano state":            (12.00,   8.52, "Kano State, Nigeria"),
    "katsina":               (12.99,   7.60, "Katsina, Nigeria"),
    "jigawa":                (12.22,   9.35, "Jigawa State, Nigeria"),
    "lagos":                 ( 6.52,   3.38, "Lagos, Nigeria"),
    "abuja":                 ( 9.07,   7.40, "Abuja, Nigeria"),
    "sokoto":                (13.06,   5.24, "Sokoto, Nigeria"),
    "diffa":                 (13.31,  12.61, "Diffa, Niger"),
    "niamey":                (13.51,   2.12, "Niamey, Niger"),
    "tahoua":                (14.89,   5.26, "Tahoua, Niger"),
    "maradi":                (13.50,   7.10, "Maradi, Niger"),
    "n'djamena":             (12.10,  15.04, "N'Djamena, Chad"),
    "ndjamena":              (12.10,  15.04, "N'Djamena, Chad"),
    "kukawa":                (12.92,  13.54, "Kukawa, Borno, Nigeria"),
    "ngazargamu":            (13.11,  13.93, "Ngazargamu (historical), Nigeria/Niger"),
    "burkina faso":          (12.36,  -1.53, "Burkina Faso"),
    "yatenga":               (13.78,  -2.21, "Yatenga Province, Burkina Faso"),
    "mali":                  (17.57,  -3.99, "Mali"),
    "timbuktu":              (16.77,  -3.00, "Timbuktu, Mali"),
    "senegal":               (14.50, -14.45, "Senegal"),
    "ghana":                 ( 7.95,  -1.02, "Ghana"),
    "kenya":                 ( 0.02,  37.91, "Kenya"),
    "nairobi":               (-1.29,  36.82, "Nairobi, Kenya"),
    "mombasa":               (-4.05,  39.67, "Mombasa, Kenya"),
    "kilifi":                (-3.63,  39.85, "Kilifi, Kenya"),
    "africa":                ( 8.78,  34.51, "Africa"),
    "west africa":           ( 9.52,  -2.55, "West Africa"),
    "the sahel":             (14.50,  17.00, "Sahel"),
    "sahel":                 (14.50,  17.00, "Sahel"),
    "central african republic": ( 6.61,  20.94, "Central African Republic"),
    "congo river":           (-0.73,  17.54, "Congo River"),
    "arabian peninsula":     (23.89,  45.08, "Arabian Peninsula"),
    "egypt":                 (26.82,  30.80, "Egypt"),
    "oxford":                (51.75,  -1.26, "Oxford, UK"),
    "yorubaland":            ( 7.87,   3.93, "Yorubaland, Nigeria"),
    "hausaland":             (12.00,   8.52, "Hausaland, Nigeria"),
}


def _static_geocode(place_name: str, hints: list[str]) -> dict | None:
    """Look up coordinates from static table with fuzzy key matching."""
    key = place_name.lower().strip().rstrip("'s").strip()
    # Direct hit
    if key in _STATIC_COORDS:
        lat, lon, norm = _STATIC_COORDS[key]
        return {"lat": lat, "lon": lon, "normalized": norm, "confidence": 0.75}
    # Substring match — prefer longer matches
    matches = [(k, v) for k, v in _STATIC_COORDS.items() if k in key or key in k]
    if matches:
        best = max(matches, key=lambda x: len(x[0]))
        lat, lon, norm = best[1]
        return {"lat": lat, "lon": lon, "normalized": norm, "confidence": 0.6}
    return None


def _load_geocoder():
    """Load the offline geocoder from libs/, or return None."""
    libs_path = Path(__file__).parent.parent.parent / "libs"
    sys.path.insert(0, str(libs_path))
    try:
        from offline_geocoder.geocoder import OfflineGeocoder
        return OfflineGeocoder()
    except ImportError:
        return None  # Fall through to static table


def _build_context_hints(neighbor_chunks, conn) -> list[str]:
    hints = []
    for nc in neighbor_chunks:
        for s in get_spans_for_chunk(conn, nc["id"]):
            if s["span_type"] == "LOC":
                hints.append(s["normalized_value"] or s["raw_text"])
    return hints


def _geocode_with_fallback(geocoder, place_name: str, hints: list[str]) -> dict | None:
    # 1. Offline geocoder (libs/offline_geocoder)
    if geocoder is not None:
        try:
            result = geocoder.geocode(place_name, hints=hints)
            if result and hasattr(result, "latitude"):
                return {"lat": result.latitude, "lon": result.longitude,
                        "normalized": result.address or place_name, "confidence": 0.85}
            elif isinstance(result, dict):
                return {"lat": result.get("lat"), "lon": result.get("lon"),
                        "normalized": result.get("name", place_name), "confidence": 0.85}
        except Exception:
            pass

    # 2. Nominatim (needs network)
    try:
        from geopy.geocoders import Nominatim
        nom = Nominatim(user_agent="akb/0.1")
        query = f"{place_name}, {hints[0]}" if hints else place_name
        loc = nom.geocode(query, timeout=5)
        if loc:
            return {"lat": loc.latitude, "lon": loc.longitude,
                    "normalized": loc.address, "confidence": 0.7}
    except Exception:
        pass

    # 3. Static table fallback
    return _static_geocode(place_name, hints)


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
