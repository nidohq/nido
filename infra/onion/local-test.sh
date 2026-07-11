#!/usr/bin/env bash
# Run the REAL nido dapp over a local Tor onion address with TLS, end-to-end,
# before any Fly deploy. Proves the onion image + WebAuthn-over-onion in one go.
#
#   ./local-test.sh          # mint a disposable onion, build, run
#   ./local-test.sh --rebuild # rebuild the frontend + image, reuse the onion key
#
# Requires: docker, and a tor binary for minting the throwaway key (uses the
# spike's bundle at ../../spikes/webauthn-onion/bin/tor/tor, else system tor).
# Keys/certs/build live under ./.local (gitignored) — DISPOSABLE, never prod.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(git rev-parse --show-toplevel)
LOCAL=.local
mkdir -p "$LOCAL"

TOR=$(command -v tor || true)
[ -x "$ROOT/spikes/webauthn-onion/bin/tor/tor" ] && TOR="$ROOT/spikes/webauthn-onion/bin/tor/tor"

# --- 1. disposable onion key -------------------------------------------------
if [ ! -s "$LOCAL/onion/hostname" ]; then
	echo "==> minting disposable onion key"
	[ -n "$TOR" ] || { echo "no tor to mint a key (run spikes/webauthn-onion/fetch-tor.sh)"; exit 1; }
	mkdir -p "$LOCAL/mint-data" "$LOCAL/onion"; chmod 700 "$LOCAL/onion"
	cat > "$LOCAL/mint.torrc" <<EOF
DataDirectory $PWD/$LOCAL/mint-data
SocksPort 0
HiddenServiceDir $PWD/$LOCAL/onion
HiddenServicePort 80 127.0.0.1:1
Log err stdout
EOF
	"$TOR" -f "$LOCAL/mint.torrc" >/dev/null 2>&1 &
	MINT=$!
	for _ in $(seq 1 20); do [ -s "$LOCAL/onion/hostname" ] && break; sleep 1; done
	kill "$MINT" 2>/dev/null || true
fi
ADDR=$(cat "$LOCAL/onion/hostname")
echo "==> onion address: $ADDR"

# --- 2. local CA + wildcard leaf (WebAuthn needs a trusted cert) -------------
if [ ! -f "$LOCAL/certs/leaf.pem" ]; then
	echo "==> generating local CA + *.$ADDR leaf"
	mkdir -p "$LOCAL/certs"
	openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
		-keyout "$LOCAL/certs/ca.key" -out "$LOCAL/certs/ca.pem" -days 90 \
		-subj "/CN=nido onion local-test CA" -addext basicConstraints=critical,CA:TRUE 2>/dev/null
	openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
		-keyout "$LOCAL/certs/leaf.key" -out "$LOCAL/certs/leaf.csr" -subj "/CN=$ADDR" 2>/dev/null
	openssl x509 -req -in "$LOCAL/certs/leaf.csr" -CA "$LOCAL/certs/ca.pem" -CAkey "$LOCAL/certs/ca.key" \
		-CAcreateserial -out "$LOCAL/certs/leaf.pem" -days 90 \
		-extfile <(printf "subjectAltName=DNS:%s,DNS:*.%s\nbasicConstraints=CA:FALSE" "$ADDR" "$ADDR") 2>/dev/null
	rm -f "$LOCAL/certs/leaf.csr"
fi

# --- 3. build the real frontend for the onion origin -------------------------
# RPC + Horizon are hardcoded to Soroban testnet in the frontend, so they are
# fetched directly through Tor (fine for testing). Only the env-driven relay /
# indexer / relayer are pointed at the onion backhaul vhosts (all https so the
# https page has no mixed-content blocks).
if [ ! -d "$LOCAL/dist" ] || [ "${1:-}" = "--rebuild" ] || [ "${1:-}" = "" ]; then
	echo "==> building frontend for https://$ADDR"
	( cd "$ROOT" && npm run build:packages >/dev/null 2>&1 || true )
	( cd "$ROOT/packages/frontend" \
		&& PUBLIC_RPC_URL="https://rpc.$ADDR" \
		   PUBLIC_RELAYER_URL="https://relayer.$ADDR" \
		   PUBLIC_RELAYER_SIM_SOURCE="GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2" \
		   PUBLIC_RECOVERY_RELAY_URL="https://relay.$ADDR" \
		   PUBLIC_POOL_INDEXER_URL="https://pool-indexer.$ADDR" \
		   npx astro build )
	rm -rf "$LOCAL/dist"; cp -r "$ROOT/packages/frontend/dist" "$LOCAL/dist"
fi
rm -rf dist; cp -r "$LOCAL/dist" dist

# --- 4. build image + run ----------------------------------------------------
echo "==> building image"
docker build -q -t nido-onion-local . >/dev/null
docker rm -f nido-onion-local >/dev/null 2>&1 || true
echo "==> starting container"
docker run -d --name nido-onion-local \
	-e ONION_ED25519_SECRET_KEY_B64="$(base64 -w0 "$LOCAL/onion/hs_ed25519_secret_key")" \
	-e ONION_ADDR="$ADDR" \
	-e ONION_TLS_CERT=/certs/leaf.pem -e ONION_TLS_KEY=/certs/leaf.key \
	-e RPC_UPSTREAM=https://soroban-testnet.stellar.org -e RPC_UPSTREAM_HOST=soroban-testnet.stellar.org \
	-e RELAYER_UPSTREAM=https://nido.fly.dev -e RELAYER_UPSTREAM_HOST=nido.fly.dev \
	-v "$PWD/$LOCAL/certs:/certs:ro" \
	nido-onion-local >/dev/null

cat <<EOF

===============================================================
  nido dapp live over Tor (local docker, disposable key):

    https://$ADDR/

  1. Trust the local CA in your test browser:
       $PWD/$LOCAL/certs/ca.pem
     Chromium/Brave (Linux):
       certutil -d sql:\$HOME/.pki/nssdb -A -t "C,," -n nido-onion-local-ca -i $PWD/$LOCAL/certs/ca.pem
  2. Open the URL above in Brave (Private Window with Tor) or a
     browser proxied through Tor. Create an account — the passkey
     RP ID will be the onion hostname.

  Logs:  docker logs -f nido-onion-local   (watch for Bootstrapped 100%)
  Stop:  docker rm -f nido-onion-local
===============================================================
EOF
