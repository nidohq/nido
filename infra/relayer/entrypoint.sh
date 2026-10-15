#!/bin/sh
set -eu
umask 077

# All three signers (fund + two channels) are Turnkey-backed — no local
# keystore material to write. TURNKEY_API_PRIVATE_KEY stays set for the
# relayer process's whole lifetime (every signature calls out to Turnkey), so
# unlike the old local-keystore flow it can't be unset after a one-time setup
# step. The relayer spawns the Channels plugin (ts-node + its npm dep tree)
# without env_clear, so that subprocess inherits it too — see README.md
# "Secret Handling" for the residual-exposure note.

(caddy run --config /app/Caddyfile --adapter caddyfile || true; kill $$) &

exec /app/openzeppelin-relayer
