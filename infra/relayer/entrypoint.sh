#!/bin/sh
set -eu
umask 077

mkdir -p /app/config/keys
printf '%s' "$KEYSTORE_FUND_B64" | base64 -d > /app/config/keys/fund.json
printf '%s' "$KEYSTORE_CHANNEL_001_B64" | base64 -d > /app/config/keys/channel-001.json
printf '%s' "$KEYSTORE_CHANNEL_002_B64" | base64 -d > /app/config/keys/channel-002.json
# The relayer spawns the Channels plugin (ts-node + its npm dep tree) WITHOUT
# env_clear, so anything left here is readable by third-party plugin code.
# Drop the raw key material; KEYSTORE_PASSPHRASE must stay (config.json loads
# it via env) — fully removing key access from the plugin is the KMS migration.
unset KEYSTORE_FUND_B64 KEYSTORE_CHANNEL_001_B64 KEYSTORE_CHANNEL_002_B64

(caddy run --config /app/Caddyfile --adapter caddyfile || true; kill $$) &

exec /app/openzeppelin-relayer
