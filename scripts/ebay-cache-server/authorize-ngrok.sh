#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$HOME/.local/share/p2w-ebay-cache"
if [[ -e "$root/private/ngrok.yml" ]]; then
  printf 'ngrok is already configured for this cache.\n'
  exit 0
fi

read -rs -p 'Paste your ngrok agent authtoken: ' token </dev/tty
printf '\n' >/dev/tty
if [[ ! "$token" =~ ^[a-zA-Z0-9._-]{20,512}$ ]]; then
  printf 'Enter the agent authtoken shown in the ngrok dashboard.\n' >&2
  exit 1
fi

config="$(mktemp "$root/private/.ngrok-config.XXXXXX")"
trap 'rm -f -- "$config"' EXIT
printf 'version: 3\nagent:\n  authtoken: %s\n  web_addr: false\n' "$token" >"$config"
unset token
"$root/bin/ngrok" config check --config "$config"
mv -T "$config" "$root/private/ngrok.yml"
nohup "$root/bin/start-ngrok" </dev/null >/dev/null 2>&1 &
printf 'Authtoken saved privately. The cache tunnel is starting.\n'
