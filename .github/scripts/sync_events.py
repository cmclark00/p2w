#!/usr/bin/env python3
"""Fetch events from Google Calendar and write events.json for the P2W website."""

import html
import json
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

from google.oauth2 import service_account
from googleapiclient.discovery import build
import yaml

# Map title keywords → game slug + display label
GAME_PATTERNS = [
    (r"pok[eé]mon", "pokemon", "Pokémon TCG"),
    (r"friday night magic|fnm|\bmagic\b|mtg", "magic", "Magic: The Gathering"),
    (r"yu.?gi.?oh", "yugioh", "Yu-Gi-Oh!"),
    (r"lorcana", "lorcana", "Disney Lorcana"),
    (r"digimon", "digimon", "Digimon TCG"),
    (r"gundam", "gundam", "Gundam Card Game"),
    (r"smash", "smash", "Super Smash Bros."),
    (r"riftbound", "riftbound", "Riftbound"),
]

ALLOWED_GAMES = {
    "pokemon", "magic", "yugioh", "lorcana", "digimon", "gundam",
    "smash", "riftbound", "other",
}
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(value, default="", max_length=2000):
    """Return bounded display text without browser-hostile control chars."""
    if value is None:
        return default
    text = CONTROL_CHARS.sub("", str(value)).strip()
    return text[:max_length] or default


def safe_http_url(value):
    """Keep only absolute HTTP(S) links supplied in calendar metadata."""
    if not value:
        return None
    url = clean_text(value, max_length=2000)
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None
    return url


def nonnegative_int(value):
    """Normalize optional capacity fields to safe, bounded integers."""
    if value in (None, ""):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if 0 <= result <= 100000 else None


def boundary_iso(boundary):
    """Preserve Google's timezone-aware start/end value for JSON-LD and ICS."""
    if not isinstance(boundary, dict):
        return None
    if boundary.get("dateTime"):
        return datetime.fromisoformat(boundary["dateTime"]).isoformat()
    return boundary.get("date") or None


def detect_game(title: str):
    for pattern, game, label in GAME_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            return game, label
    return "other", "Other"


def normalize_description(raw: str) -> str:
    """Flatten a Google Calendar description to plain text with real newlines.

    Google Calendar stores descriptions as HTML when they're edited in the web
    UI (lines wrapped in <br>/<div>, entities escaped). The metadata split below
    keys off plain-text "\\n---\\n", so without this an HTML-formatted event
    never parses its metadata. Handles plain-text input unchanged.
    """
    text = raw.replace("\r\n", "\n")
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)             # <br> → newline
    text = re.sub(r"(?i)</(?:p|div|li|ul|ol|h[1-6])>", "\n", text)  # block closings
    text = re.sub(r"<[^>]+>", "", text)                      # drop remaining tags
    text = html.unescape(text)                               # &amp; → &, &nbsp; → space
    text = re.sub(r"[ \t]+\n", "\n", text)                   # trim trailing spaces
    text = re.sub(r"\n{3,}", "\n\n", text)                   # collapse blank-line runs
    return text


def parse_description(raw: str):
    """Split description into visible text and optional YAML metadata block.

    Metadata goes after a line containing only ---:
        This is the public description.

        ---
        game: pokemon
        entry: Free
        format: Casual & Competitive
        recurring: Every Saturday
    """
    if not raw:
        return "", {}

    text = normalize_description(raw)
    parts = re.split(r"\n[ \t]*---[ \t]*\n", "\n" + text.strip("\n") + "\n", maxsplit=1)
    description = parts[0].strip()
    meta = {}
    if len(parts) > 1:
        try:
            loaded = yaml.safe_load(parts[1])
            if isinstance(loaded, dict):
                meta = loaded
        except Exception:
            pass
    return description, meta


def format_time_12h(dt: datetime) -> str:
    hour, minute = dt.hour, dt.minute
    period = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    return f"{hour12}:{minute:02d} {period}"


def process_event(item: dict, idx: int) -> dict:
    title = clean_text(item.get("summary"), "Untitled Event", 180)
    description, meta = parse_description(str(item.get("description") or ""))
    description = clean_text(description, title, 5000)

    start = item["start"]
    end = item.get("end") or {}
    if "dateTime" in start:
        dt = datetime.fromisoformat(start["dateTime"])
        date_str = dt.strftime("%Y-%m-%d")
        time_str = format_time_12h(dt)
        time24_str = f"{dt.hour:02d}:{dt.minute:02d}"
    else:
        date_str = start["date"]
        time_str = "TBA"
        time24_str = "00:00"

    game, game_label = detect_game(title)
    if "game" in meta:
        requested_game = clean_text(meta["game"], max_length=40).lower()
        game = requested_game if requested_game in ALLOWED_GAMES else "other"
    if "gameLabel" in meta:
        game_label = clean_text(meta["gameLabel"], "Other", 80)

    return {
        "id": idx + 1,
        "title": title,
        "game": game,
        "gameLabel": game_label,
        "date": date_str,
        "time": time_str,
        "time24": time24_str,
        "startISO": boundary_iso(start),
        "endISO": boundary_iso(end),
        "entry": clean_text(meta.get("entry"), "TBA", 80),
        "format": clean_text(meta.get("format"), "See description", 160),
        "capacity": nonnegative_int(meta.get("capacity")),
        "registered": nonnegative_int(meta.get("registered")),
        "registerUrl": safe_http_url(meta.get("registerUrl")),
        "facebookUrl": safe_http_url(meta.get("facebookUrl")),
        "recurring": clean_text(meta.get("recurring"), max_length=160) or None,
        "prizing": clean_text(meta.get("prizing"), max_length=300) or None,
        "description": description,
    }


def main():
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    calendar_id = os.environ.get("GOOGLE_CALENDAR_ID")

    if not sa_json or not calendar_id:
        print("ERROR: set GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_CALENDAR_ID secrets", file=sys.stderr)
        sys.exit(1)

    sa_info = json.loads(sa_json)
    creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/calendar.readonly"]
    )
    service = build("calendar", "v3", credentials=creds)

    now = datetime.now(timezone.utc).isoformat()
    result = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=now,
            maxResults=50,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    items = result.get("items", [])
    events = [process_event(item, i) for i, item in enumerate(items)]

    out_path = os.path.join(os.path.dirname(__file__), "..", "..", "events.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(events)} events to events.json")


if __name__ == "__main__":
    main()
