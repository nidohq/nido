#!/bin/sh
set -eu
umask 077

(caddy run --config /app/Caddyfile --adapter caddyfile || true; kill $$) &

exec /app/openzeppelin-relayer
