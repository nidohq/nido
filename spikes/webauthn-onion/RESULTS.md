# WebAuthn-on-onion spike results

Issue: #139. Fill one row per (browser × scheme × origin) run; both ceremonies.
Record exact error strings — they decide the epic's detect-and-guide copy.

## Server-side reachability (automated)

| Check | Result | Notes |
|---|---|---|
| Onion descriptor published, page loads via Tor | ✅ 2026-07-10 | tor 0.4.9.11 expert bundle; `curl --socks5-hostname` to `http://<addr>.onion/whoami` returns page + correct Host |
| `test.<addr>.onion` routes to service, Host header intact | ✅ 2026-07-10 | Full label delivered in Host header through the Tor hop — vhost-per-account model confirmed end-to-end |
| https vhost with local-CA wildcard leaf | ✅ 2026-07-10 | TLS handshake through Tor on bare **and** `test.` origins with one `*.<addr>.onion` leaf (SNI carried the subdomain) |

## Browser matrix

| # | Browser + version | OS | Transport | Scheme | Origin | isSecureContext | PublicKeyCredential | create() | get() | Authenticator | Errors (verbatim) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Brave (Private Window w/ Tor) | | built-in Tor | http | bare | | | | | | |
| 1b | Brave (Private Window w/ Tor) | | built-in Tor | http | test. subdomain | | | | | | |
| 2 | Brave (Private Window w/ Tor) — version TBD | user machine, OS TBD | built-in Tor | https | test. subdomain | | | ✅ OK (2026-07-11) | ✅ OK (2026-07-11) | **platform** (`authenticatorAttachment=platform`, `transports=hybrid,internal`) | Real-hardware full ceremony after trusting spike CA via /ca.pem; `rpId=test.<addr>.onion`, userHandle returned. First human-verified WebAuthn ceremony on an onion origin. |
| 3 | Firefox 152+ | | SOCKS 9052 | https | bare | | | | | | |
| 3b | Firefox 152+ | | SOCKS 9052 | https | test. subdomain | | | | | | |
| 4 | Firefox 152+ (control) | | SOCKS 9052 | http | bare | | | | | | |
| 5 | Tor Browser 15 stock (control) | | native | http | bare | | | | | | |
| 6 | Tor Browser 15, webauthn pref flipped | | native | http | bare | | | | | | |
| 7 | Chrome 147.0.7727.55 (headless, automated) | Linux (Pop!_OS) | SOCKS 9052 | https | bare | true | function | ✅ OK | ✅ OK | CDP virtual authenticator (ctap2/internal, UV) | — |
| 7b | Chrome 147.0.7727.55 (headless, automated) | Linux (Pop!_OS) | SOCKS 9052 | https | test. subdomain | true | function | ✅ OK | ✅ OK | CDP virtual authenticator | Distinct RP ID `test.<addr>.onion` — per-account model confirmed |
| 7c | Chrome 147.0.7727.55 (headless, automated) | Linux (Pop!_OS) | SOCKS 9052 | http | bare + subdomain | false | undefined | API absent | API absent | — | Upstream Chromium has no .onion secure-context carve-out — http onion is dead for Chrome |

## Verdict

- [x] Any browser passed create+assert on an onion origin? **YES — Chrome 147 over Tor SOCKS, https with locally-trusted wildcard onion cert, both bare and subdomain origins (2026-07-11, automated via `auto-test.mjs`).** Believed to be the first field-verified WebAuthn ceremony on a .onion origin.
- [x] Passing set requires TLS? **Yes for Chrome/Chromium** — http onion is not a secure context upstream, `PublicKeyCredential` absent. TLS row passes cleanly once the CA is actually in the NSS trust store. (Brave's http-onion carve-out remains untested — no Brave on this machine.)
- [ ] Go/no-go for epic phases 2+: **Chromium leg is GO.** Consequence for the epic: the HARICA wildcard onion cert moves from "conditional" to **required** — it is the thing that unlocks the proven signing path. Firefox / Brave / Tor Browser rows still open.

## Notes

- 2026-07-11: `NotAllowedError: WebAuthn is not supported on sites with TLS certificate errors` in manual Chrome testing was caused by the browser not being fully restarted after `certutil` trust install (Chromium reads NSS at startup and remembers interstitial bypasses). The automated run against the same trust store passed.
- The virtual-authenticator pass answers the browser-gating question (RP ID validity, secure context, security level). A one-off manual confirmation with a physical/platform authenticator is still worth recording for UX (prompt behavior over slow Tor round-trips).

