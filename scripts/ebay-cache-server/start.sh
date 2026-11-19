#!/bin/sh
set -eu
umask 077

P2W_EBAY_CACHE_HOME="$HOME/.local/share/p2w-ebay-cache"
P2W_EBAY_CACHE_RELEASE=$(readlink -f "$P2W_EBAY_CACHE_HOME/current")
export P2W_EBAY_CACHE_HOME P2W_EBAY_CACHE_RELEASE

exec /usr/bin/flock -n -E 0 "$P2W_EBAY_CACHE_HOME/private/service.lock" \
  "$P2W_EBAY_CACHE_HOME/bin/frankenphp" run --config "$P2W_EBAY_CACHE_RELEASE/Caddyfile" --adapter caddyfile
