#!/bin/sh
set -eu
umask 077

root="$HOME/.local/share/p2w-ebay-cache"
test -s "$root/private/ngrok.yml" || exit 0

exec 9>"$root/private/tunnel.lock"
/usr/bin/flock -n -E 1 9 || exit 0
exec "$root/bin/ngrok" http http://127.0.0.1:8787 --config "$root/private/ngrok.yml" \
  --inspect=false --log=stdout --log-format=json >"$root/private/tunnel.log" 2>&1
