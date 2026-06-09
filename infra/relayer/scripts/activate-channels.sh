#!/bin/sh
# One-time channel-pool activation (the plugin won't process transactions
# until channel accounts are registered in its KV pool).
# The relayer's authenticated port is not exposed through Caddy; tunnel first:
#   fly proxy 8090:8090 -a nido-relayer
# Usage: API_KEY=... PLUGIN_ADMIN_SECRET=... ./activate-channels.sh http://localhost:8090
set -eu
BASE="${1:?usage: activate-channels.sh <relayer-base-url>}"
: "${API_KEY:?}" ; : "${PLUGIN_ADMIN_SECRET:?}"
curl -fsS -X POST "$BASE/api/v1/plugins/channels/call" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"params\":{\"management\":{\"action\":\"setChannelAccounts\",\"adminSecret\":\"$PLUGIN_ADMIN_SECRET\",\"relayerIds\":[\"channel-001\",\"channel-002\"]}}}"
echo
