#!/bin/sh
# Boot: materialize the onion identity key from the Fly secret, start Caddy,
# run tor as PID 1 (tor dying restarts the machine; Caddy dying is caught
# by the health loop below).
set -eu

: "${ONION_ED25519_SECRET_KEY_B64:?set via: fly secrets set ONION_ED25519_SECRET_KEY_B64=<base64 of hs_ed25519_secret_key>}"
: "${ONION_ADDR:?set via fly.toml [env] once the address is minted}"

mkdir -p /var/lib/tor/onion
echo "$ONION_ED25519_SECRET_KEY_B64" | base64 -d > /var/lib/tor/onion/hs_ed25519_secret_key
# tor derives hs_ed25519_public_key and hostname from the secret key itself
chown -R debian-tor:debian-tor /var/lib/tor
chmod 700 /var/lib/tor /var/lib/tor/onion
chmod 600 /var/lib/tor/onion/hs_ed25519_secret_key

# Assemble the runtime Caddyfile: base http site always; append the https
# site only when a cert is actually mounted (WebAuthn on onion needs TLS).
cp /etc/caddy/Caddyfile /run/Caddyfile
if [ -n "${ONION_TLS_CERT:-}" ] && [ -r "${ONION_TLS_CERT}" ]; then
	: "${ONION_TLS_KEY:?ONION_TLS_CERT is set but ONION_TLS_KEY is not}"
	cat >> /run/Caddyfile <<EOF

https://:8443 {
	tls ${ONION_TLS_CERT} ${ONION_TLS_KEY}
	import routes
}
EOF
	echo "TLS enabled: serving https on :8443 with ${ONION_TLS_CERT}" >&2
else
	echo "no cert mounted (ONION_TLS_CERT unset/unreadable) — http :8080 only" >&2
fi

caddy run --config /run/Caddyfile &
CADDY_PID=$!

# If Caddy dies, take the machine down so Fly restarts it whole.
(
	while kill -0 "$CADDY_PID" 2>/dev/null; do sleep 5; done
	echo "caddy exited; stopping tor" >&2
	kill 1 2>/dev/null
) &

exec setpriv --reuid=debian-tor --regid=debian-tor --clear-groups \
	tor -f /etc/tor/torrc-onion
