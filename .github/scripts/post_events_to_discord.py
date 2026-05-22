#!/usr/bin/env python3
"""
Post (or edit) an 'Upcoming Events — next 7 days' message in Discord.

Reads events.json (maintained by sync_events.py), filters to events in the
next 7 days, formats them as a Discord embed, and either creates a new
webhook message or PATCHes the existing one (tracked via
`.github/discord-events-state.json`).

Stdlib only — no pip dependencies.

Env:
  DISCORD_EVENTS_WEBHOOK = full webhook URL
    (https://discord.com/api/webhooks/{id}/{token})

Exits 0 even on missing events.json so a one-time setup glitch doesn't
fail the whole workflow. Exits 1 on misconfiguration (missing webhook env).
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from urllib import request, error

WEBHOOK = (os.environ.get('DISCORD_EVENTS_WEBHOOK') or '').strip()
if not WEBHOOK:
    sys.stderr.write('DISCORD_EVENTS_WEBHOOK env var not set\n')
    sys.exit(1)
if not WEBHOOK.startswith('https://discord.com/api/webhooks/'):
    sys.stderr.write(
        'DISCORD_EVENTS_WEBHOOK does not look like a Discord webhook URL '
        '(expected https://discord.com/api/webhooks/{id}/{token}).\n'
    )
    sys.exit(1)

# Resolve paths from the script location so this works in CI and locally.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
EVENTS_PATH = os.path.join(ROOT, 'events.json')
STATE_PATH = os.path.join(ROOT, '.github', 'discord-events-state.json')

if not os.path.exists(EVENTS_PATH):
    print(f'No events.json at {EVENTS_PATH}; skipping Discord post.')
    sys.exit(0)

with open(EVENTS_PATH, encoding='utf-8') as f:
    all_events = json.load(f)

# Filter to events in [today, today+7] inclusive, matching the website's window.
today = date.today()
end = today + timedelta(days=7)
upcoming = []
for ev in all_events:
    try:
        d = datetime.strptime(ev['date'], '%Y-%m-%d').date()
    except (ValueError, KeyError, TypeError):
        continue
    if today <= d <= end:
        upcoming.append(ev)

upcoming.sort(key=lambda e: (e['date'], e.get('time24') or '00:00'))

GAME_EMOJI = {
    'pokemon':   '🃏',
    'magic':     '🪄',
    'yugioh':    '🃏',
    'lorcana':   '🏰',
    'digimon':   '🦖',
    'gundam':    '🤖',
    'one-piece': '⚓',
    'onepiece':  '⚓',
    'riftbound': '⚔',
    'other':     '🎴',
}


def format_event(ev):
    emoji = GAME_EMOJI.get((ev.get('game') or 'other').lower(), '🎴')
    title = ev.get('title') or '(untitled event)'
    d = datetime.strptime(ev['date'], '%Y-%m-%d')
    # %-d (no leading zero) is Linux-only; CI runs on ubuntu-latest so this is fine.
    when = d.strftime('%a, %b %-d')
    time = ev.get('time') or 'TBA'
    line2_parts = [f'{when} · {time}']
    entry = ev.get('entry')
    if entry:
        line2_parts.append(f'Entry {entry}')
    reg = ev.get('registerUrl')
    if reg:
        line2_parts.append(f'[Register]({reg})')
    return f'{emoji} **{title}**\n{" · ".join(line2_parts)}'


if upcoming:
    body = '\n\n'.join(format_event(ev) for ev in upcoming)
    # Discord embed description hard cap is 4096 chars. Defensive truncation.
    if len(body) > 3900:
        body = body[:3900] + '\n\n_…more events at play2wingames.com/events_'
else:
    body = '_No events scheduled in the next 7 days. Check back soon, or follow us on Facebook for late additions._'

embed = {
    'title': '📅 Upcoming Events — next 7 days',
    'description': body,
    'color': 0xD91F38,  # brand red
    'footer': {
        'text': 'Updated daily · Full schedule: play2wingames.com/events',
    },
    'timestamp': datetime.now(timezone.utc).isoformat(),
}

payload = {
    'embeds': [embed],
    # No mentions — this post should never @everyone.
    'allowed_mentions': {'parse': []},
}

# Load existing state (just the message ID, if any).
state = {}
if os.path.exists(STATE_PATH):
    try:
        with open(STATE_PATH, encoding='utf-8') as f:
            state = json.load(f)
    except json.JSONDecodeError:
        state = {}
message_id = state.get('message_id')


USER_AGENT = (
    'Play2Win-Games-Events/1.0 '
    '(+https://play2wingames.com; '
    'https://github.com/play2wingames/p2w)'
)


def http(method, url, data):
    """Tiny POST/PATCH helper. Raises on non-2xx (except as handled below)."""
    req = request.Request(
        url,
        data=json.dumps(data).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            # Discord/Cloudflare may 403 the default Python-urllib UA.
            'User-Agent': USER_AGENT,
        },
        method=method,
    )
    try:
        with request.urlopen(req) as resp:
            body = resp.read()
            return json.loads(body) if body else {}
    except error.HTTPError as e:
        # Surface Discord's actual error body so the workflow log is useful.
        try:
            err_body = e.read().decode('utf-8', errors='replace')
        except Exception:
            err_body = '(unable to read response body)'
        sys.stderr.write(
            f'\nDiscord HTTP {e.code} on {method} {url.split("/webhooks/")[0]}/webhooks/<redacted>\n'
            f'Response: {err_body}\n'
        )
        raise


def post_new():
    """Create a new webhook message; returns the message ID."""
    url = WEBHOOK + '?wait=true'  # ?wait=true makes Discord return the message JSON
    result = http('POST', url, payload)
    return result['id']


def edit_existing(msg_id):
    """PATCH an existing message. Returns True on success, False if 404 (deleted)."""
    url = f'{WEBHOOK}/messages/{msg_id}'
    try:
        http('PATCH', url, payload)
        return True
    except error.HTTPError as e:
        if e.code == 404:
            return False
        raise


if message_id:
    print(f'Editing existing Discord message {message_id}')
    if not edit_existing(message_id):
        print('Stored message ID 404d (deleted?); posting a fresh message')
        message_id = post_new()
else:
    print('No stored message ID; posting a new message')
    message_id = post_new()

# Only write the state file if the message ID actually changed — keeps the
# workflow from making a commit every single night.
new_state = {'message_id': message_id}
if state != new_state:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(new_state, f, indent=2)
    print(f'Saved new state with message ID {message_id}')
else:
    print(f'Message ID unchanged ({message_id}); state file untouched')
