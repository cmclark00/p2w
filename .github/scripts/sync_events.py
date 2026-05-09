#!/usr/bin/env python3
"""Fetch events from Google Calendar and write events.json for the P2W website."""

import json
import os
import re
import sys
from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build
import yaml

# Map title keywords → game slug + display label
GAME_PATTERNS = [
    (r"pok[eé]mon", "pokemon", "Pokémon TCG"),
    (r"friday night magic|fnm|\bmagic\b|mtg", "magic", "Magic: The Gathering"),
    (r"yu.?gi.?oh", "yugioh", "Yu-Gi-Oh!"),
    (r"lorcana", "lorcana", "Disney Lorcana"),
    (r"smash", "smash", "Super Smash Bros."),
    (r"riftbound", "riftbound", "Riftbound"),
]


def detect_game(title: str):
    for pattern, game, label in GAME_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            return game, label
    return "other", "Other"


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

    parts = re.split(r"\n---\n", raw.replace("\r\n", "\n"), maxsplit=1)
    description = parts[0].strip()
    meta = {}
    if len(parts) > 1:
        try:
            meta = yaml.safe_load(parts[1]) or {}
        except Exception:
            pass
    return description, meta


def format_time_12h(dt: datetime) -> str:
    hour, minute = dt.hour, dt.minute
    period = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    return f"{hour12}:{minute:02d} {period}"


def process_event(item: dict, idx: int) -> dict:
    title = item.get("summary", "Untitled Event")
    description, meta = parse_description(item.get("description", ""))

    start = item["start"]
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
        game = str(meta["game"])
    if "gameLabel" in meta:
        game_label = str(meta["gameLabel"])

    return {
        "id": idx + 1,
        "title": title,
        "game": game,
        "gameLabel": game_label,
        "date": date_str,
        "time": time_str,
        "time24": time24_str,
        "entry": str(meta.get("entry", "TBA")),
        "format": str(meta.get("format", "See description")),
        "capacity": meta.get("capacity") or None,
        "registered": meta.get("registered") or None,
        "registerUrl": meta.get("registerUrl") or None,
        "recurring": meta.get("recurring") or None,
        "description": description or title,
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
