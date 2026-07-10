# Spike: WebAuthn on a .onion origin

Phase 0 of the onion-service epic (#138, spike issue #139). Empirically answers:
**can any Tor-capable browser complete a WebAuthn create + assert ceremony on a
`.onion` origin?** No successful attempt has been published anywhere as of 2026-07.

Design context: `docs/superpowers/specs/2026-07-10-onion-service-design.md`.

This directory is a self-contained throwaway onion service hosting a minimal
WebAuthn test page. The onion key here is disposable — never reuse it for the
real deployment.

## Layout

```
fetch-tor.sh   # download Tor Expert Bundle into ./bin (no root needed)
torrc          # throwaway onion: port 80 -> :8080 (http), 443 -> :8443 (https)
server.py      # static server for the test page + /whoami Host-header echo
index.html     # the WebAuthn test page (create / assert, verbatim logging)
gen-cert.sh    # local CA + leaf for <addr>.onion and *.<addr>.onion (https rows)
run.sh         # start tor + server, print the onion URLs
RESULTS.md     # test-matrix template — fill in as you go
```

## Run

```bash
cd spikes/webauthn-onion
./fetch-tor.sh          # or: sudo apt install tor (then it uses system tor)
./run.sh                # prints http://<addr>.onion once the descriptor is up
./gen-cert.sh           # after first run (needs data/onion/hostname); enables :443
```

`run.sh` also opens SOCKS on `127.0.0.1:9052` — point non-Tor-Browser browsers
at it for the Firefox/Chromium rows.

## Browser setup per matrix row

- **Brave Private Window with Tor**: no setup; open `http://<addr>.onion`.
- **Firefox 152+ over SOCKS**: Settings → Network Settings → Manual proxy,
  SOCKS5 host `127.0.0.1` port `9052`, "Proxy DNS when using SOCKS v5" ON.
  In `about:config`: `network.dns.blockDotOnion` → `false`.
  For https rows: Settings → Certificates → Import `certs/ca.pem`, trust for websites.
- **Chromium/Chrome over SOCKS**:
  `chromium --proxy-server="socks5://127.0.0.1:9052" --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`
  Trust `certs/ca.pem` via chrome://settings/certificates (Authorities).
- **Tor Browser stock / pref-flip**: open the onion URL; for the flip row set
  `security.webauth.webauthn` → `true` in `about:config`, restart.

On the page: check the environment readout (isSecureContext,
PublicKeyCredential present, Host header seen by server), then Create → Assert.
Test on the bare address AND the `test.` subdomain link (distinct origin,
distinct RP ID). Record exact errors in RESULTS.md.

## What this decides

- Any pass → epic phases 2+ proceed; the passing browsers become the
  detect-and-guide targets; HARICA wildcard cert required only if just the
  TLS rows passed.
- All fail → mirror + read-only still ships; signing waits on Tor Browser
  WebAuthn (tpo#44158) or a non-WebAuthn signer design.
