# nido onion service (epic #138, phase 1)

Fly app serving nido over Tor: tor daemon (single-onion mode, PoW DoS
defenses) + Caddy routing per-account subdomain vhosts to the static frontend
and backhauling APIs over clearnet from one fixed egress IP (EOTK pattern).

Design: `docs/superpowers/specs/2026-07-10-onion-service-design.md`.
Spike proving WebAuthn works on onion origins over TLS: `spikes/webauthn-onion/`.

## One-time: key ceremony

The onion address IS the ed25519 key. Leak = impersonation; loss = new address.

1. On a trusted, ideally offline machine: mine a `nido`-prefixed address —

   ```bash
   git clone https://github.com/cathugger/mkp224o && cd mkp224o
   ./autogen.sh && ./configure && make
   ./mkp224o -d out nido
   ```

   Seconds for a 4-char prefix. `out/<addr>/` contains `hs_ed25519_secret_key`.
2. Back up `hs_ed25519_secret_key` offline (two copies, separate media).
3. Load it into Fly:

   ```bash
   fly secrets set -a nido-onion \
     ONION_ED25519_SECRET_KEY_B64=$(base64 -w0 out/<addr>/hs_ed25519_secret_key)
   ```

4. Put the address in `fly.toml` `[env] ONION_ADDR` and in the worker proxy's
   `ONION_ADDR` var (`frontend/worker-proxy-nido`) to turn on `Onion-Location`.

## Deploy

```bash
# 1. Onion build of the frontend (API URLs point at onion vhosts)
cd packages/frontend
PUBLIC_NIDO_BASE="http://$ONION_ADDR" \
PUBLIC_RECOVERY_RELAY_URL="http://relay.$ONION_ADDR" \
PUBLIC_RELAYER_URL="http://relayer.$ONION_ADDR" \
npm run build

# 2. Stage dist into the build context and deploy
rm -rf ../../infra/onion/dist && cp -r dist ../../infra/onion/dist
cd ../../infra/onion && fly deploy
```

No `fly ips allocate` — the app must keep zero public IPs.

Verify: `curl --socks5-hostname 127.0.0.1:9050 http://$ONION_ADDR/` (any tor
daemon), and check `fly logs` for `Bootstrapped 100%` + descriptor upload.

## TLS (phase 2 — required for signing)

WebAuthn on onion origins needs https in every proven browser path. Get the
HARICA DV cert with SANs `{nido.fyi, <addr>.onion, *.<addr>.onion}` — the
onion names validate via HARICA's ed25519 onion-CSR tool
(<https://github.com/HARICA-official/onion-csr>), and the cert's CT log entry
doubles as the public domain↔onion binding. Then:

1. Mount cert+key (Fly secrets → files, or a volume) and add the `:8443` TLS
   site blocks to the Caddyfile (`tls /path/cert.pem /path/key.pem`).
2. Renewal ≤200 days, manual — put it on a calendar. No ACME for .onion yet
   (RFC 9799 unimplemented by public CAs).

## Notes

- tor state (consensus cache) is ephemeral here; bootstrap after a restart
  takes ~30s longer than with a volume. Add a `[mounts]` volume for
  `/var/lib/tor` later if restart latency matters.
- PoW defense requires Debian's GPL tor build — the Dockerfile asserts
  `tor --version` at build; PoW params are tor defaults (rate 250/s burst 2500).
- Never run this image with the spike's throwaway key or vice versa.
