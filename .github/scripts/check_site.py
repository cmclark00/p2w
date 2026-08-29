"""Fast, dependency-free checks for the files published as the static site."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[2]
EXCLUDED_HTML = {
    ROOT / "assets" / "files" / "index.html",
    ROOT / "team-guide-print.html",
}
IGNORED_SCHEMES = {"data", "mailto", "tel"}
HTTP_SCHEMES = {"http", "https"}
FORMSPREE_RE = re.compile(r"https://formspree\.io/f/[a-z0-9]+$")


class SiteParser(HTMLParser):
    def __init__(self, source: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.source = source
        self.ids: list[str] = []
        self.refs: list[tuple[str, str, str, int]] = []
        self.errors: list[str] = []
        self.forms: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        line, _ = self.getpos()

        if values.get("id"):
            self.ids.append(values["id"])

        if tag == "img" and "alt" not in values:
            self.errors.append(f"{self.source.relative_to(ROOT)}:{line}: image is missing alt text")

        if tag == "form":
            self.forms.append(values)

        for attr in ("href", "src", "poster"):
            if attr in values:
                self.refs.append((tag, attr, values[attr].strip(), line))

        if "srcset" in values:
            for candidate in values["srcset"].split(","):
                url = candidate.strip().split()[0] if candidate.strip() else ""
                self.refs.append((tag, "srcset", url, line))


def published_html() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.html")
        if path not in EXCLUDED_HTML
        and ".git" not in path.parts
        and "_site" not in path.parts
    )


def resolve_local_ref(source: Path, value: str) -> tuple[Path, str] | None:
    if not value:
        return None

    parsed = urlsplit(value)
    scheme = parsed.scheme.lower()
    if scheme in HTTP_SCHEMES or scheme in IGNORED_SCHEMES or parsed.netloc:
        return None
    if scheme:
        raise ValueError(f"unsupported URL scheme {scheme!r}")

    raw_path = unquote(parsed.path)
    if raw_path.startswith("/"):
        target = ROOT / raw_path.lstrip("/")
    elif raw_path:
        target = source.parent / raw_path
    else:
        target = source

    target = target.resolve()
    try:
        target.relative_to(ROOT)
    except ValueError as exc:
        raise ValueError("reference escapes the site root") from exc

    if target.is_dir() or value.endswith("/"):
        target /= "index.html"
    return target, unquote(parsed.fragment)


def check_html() -> list[str]:
    errors: list[str] = []
    parsed_pages: dict[Path, SiteParser] = {}

    for page in published_html():
        parser = SiteParser(page)
        try:
            parser.feed(page.read_text(encoding="utf-8"))
            parser.close()
        except Exception as exc:
            errors.append(f"{page.relative_to(ROOT)}: could not parse HTML: {exc}")
            continue

        parsed_pages[page.resolve()] = parser
        errors.extend(parser.errors)
        duplicates = [item for item, count in Counter(parser.ids).items() if count > 1]
        for item in duplicates:
            errors.append(f"{page.relative_to(ROOT)}: duplicate id {item!r}")

        for form in parser.forms:
            action = form.get("action", "")
            if "ptw-form-card" in form.get("class", ""):
                if not FORMSPREE_RE.fullmatch(action):
                    errors.append(
                        f"{page.relative_to(ROOT)}: public form has an invalid Formspree action"
                    )
                if form.get("method", "").lower() != "post":
                    errors.append(f"{page.relative_to(ROOT)}: public form must use method=POST")

    for page, parser in parsed_pages.items():
        for tag, attr, value, line in parser.refs:
            label = f"{page.relative_to(ROOT)}:{line}: {tag}[{attr}]"
            if not value:
                errors.append(f"{label} is empty")
                continue
            try:
                resolved = resolve_local_ref(page, value)
            except ValueError as exc:
                errors.append(f"{label} {exc}: {value!r}")
                continue
            if resolved is None:
                continue

            target, fragment = resolved
            if not target.exists():
                errors.append(f"{label} points to missing file {value!r}")
                continue
            if fragment and target.suffix.lower() == ".html":
                target_parser = parsed_pages.get(target.resolve())
                if target_parser and fragment not in target_parser.ids:
                    errors.append(f"{label} points to missing fragment {value!r}")

    return errors


def check_events() -> list[str]:
    errors: list[str] = []
    path = ROOT / "events.json"
    try:
        events = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"events.json: invalid JSON: {exc}"]

    if not isinstance(events, list):
        return ["events.json: top-level value must be an array"]

    seen_ids: set[int] = set()
    for index, event in enumerate(events):
        label = f"events.json[{index}]"
        if not isinstance(event, dict):
            errors.append(f"{label}: event must be an object")
            continue
        for field in ("id", "date", "title", "game", "gameLabel", "description"):
            if field not in event:
                errors.append(f"{label}: missing {field!r}")
        event_id = event.get("id")
        if not isinstance(event_id, int) or event_id <= 0:
            errors.append(f"{label}: id must be a positive integer")
        elif event_id in seen_ids:
            errors.append(f"{label}: duplicate id {event_id}")
        else:
            seen_ids.add(event_id)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(event.get("date", ""))):
            errors.append(f"{label}: date must use YYYY-MM-DD")
        for field in ("registerUrl", "facebookUrl"):
            value = event.get(field)
            if value and urlsplit(str(value)).scheme.lower() not in HTTP_SCHEMES:
                errors.append(f"{label}: {field} must be an http(s) URL")

    return errors


def main() -> int:
    errors = check_html() + check_events()
    if errors:
        print("Site checks failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Site checks passed ({len(published_html())} HTML pages, events.json).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
