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
| 2 | Brave (Private Window w/ Tor) | | built-in Tor | https | bare | | | | | | |
| 3 | Firefox 152+ | | SOCKS 9052 | https | bare | | | | | | |
| 3b | Firefox 152+ | | SOCKS 9052 | https | test. subdomain | | | | | | |
| 4 | Firefox 152+ (control) | | SOCKS 9052 | http | bare | | | | | | |
| 5 | Tor Browser 15 stock (control) | | native | http | bare | | | | | | |
| 6 | Tor Browser 15, webauthn pref flipped | | native | http | bare | | | | | | |
| 7 | Chromium | | SOCKS 9052 | https | bare | | | | | | |

## Verdict

- [ ] Any browser passed create+assert on an onion origin?
- [ ] Passing set requires TLS (i.e. only https rows passed)?
- [ ] Go/no-go for epic phases 2+:

## Notes

