# Nido Onion Service — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm → epic)
**Goal:** Serve nido as a Tor onion service with full app parity, publicly bound to nido.fyi.

## Motivation

Three goals, in priority order:

1. **Censorship resistance** — nido reachable where nido.fyi is blocked (DNS tampering, state firewalls).
2. **User privacy** — users reach nido without exit nodes; end-to-end onion encryption.
3. **Trust / verifiability** — a cryptographic, publicly auditable binding between nido.fyi and the onion address, usable as an anti-phishing signal.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Full app UI over onion (not just a docs mirror) |
| Accounts | Onion-native creation day one; existing-account linking as follow-up |
| Hosting | Fly.io machine running tor + Caddy |
| Onion address | Vanity `nido…` prefix (mkp224o, mined offline) |
| Tor mode | Single onion service (server anonymity not needed; users keep 3 hops) |
| Cert strategy | Onion-Location day one; **HARICA mixed-SAN cert (`nido.fyi` + `<addr>.onion` + `*.<addr>.onion`) required in phase 2** — spike proved TLS is the Chromium/Brave signing path, and a CT-logged cert containing both names IS the public domain↔onion binding (Facebook precedent). Sauteed-Onions SAN demoted to optional interim measure |
| Tor Browser signing gap | Detect + guide (read-only mode in stock Tor Browser) |

## Load-bearing facts (verified 2026-07-10 against primary sources)

1. **Stock Tor Browser cannot do WebAuthn.** `security.webauth.webauthn=false` ships in stable 15.0.17 and the 16.0 alpha branch; `PublicKeyCredential` is not web-exposed, so registration and assertion fail on every transport. Tracking issues tpo/applications/tor-browser#26614 and #44158 are open with no milestone, assignee, or merge requests. A stock-TB user can browse the onion app but cannot sign.
2. **Onion subdomains work.** The Tor address spec reserves labels left of the 56-char address for vhosting; they are carried in the HTTP Host header (and SNI). `onion` is on the Public Suffix List, so `<addr>.onion` is the registrable domain and `name.<addr>.onion` is a distinct origin — WebAuthn RP-ID scoping is exactly parallel to `name.nido.fyi`. Nido's per-account-subdomain model ports unchanged.
3. **RP ID is already dynamic.** `rpId: window.location.hostname` at every create/assert site (`primaryPasskeySigner.ts`, `walletSign.ts`, `sessionKey.ts`, account pages). No auth-code change needed for onion origins. The on-chain verifier does not check rpIdHash/origin; RP binding is enforced client-side by browser + authenticator.
4. **Plain-HTTP onion is a secure context in Tor Browser** (`dom.securecontext.allowlist_onions=true`) **and in Brave ≥1.56** (brave-core patch to `is_potentially_trustworthy.cc`), but **not** in vanilla Firefox or upstream Chromium. Gecko gates WebAuthn on potentially-trustworthy origin, not the https scheme.
5. **Signing paths — FIELD-VERIFIED by the phase-0 spike (2026-07-11, `spikes/webauthn-onion/`):** Chrome 147 over Tor SOCKS completed create+assert on `https://<addr>.onion` AND `https://test.<addr>.onion` (distinct RP IDs — per-account model confirmed) with a locally-trusted wildcard onion cert; Brave Private Window with Tor completed create with a real platform authenticator over https. Plain-http onion exposes no WebAuthn in Chromium (`PublicKeyCredential` undefined) — **TLS on the onion is required for every proven signing path**, which is why the HARICA cert is now a hard requirement.
6. **Wildcard onion TLS is obtainable.** HARICA sells "SSL DV Wildcard Onion" (`*.<addr>.onion`), validated via an ed25519 onion-CSR (BR Appendix B — the only wildcard-permitted method; HARICA publishes an open-source `onion-csr` tool). DigiCert issues EV equivalents (Proton, Brave hold live wildcard onion certs). Lifetimes: ≤200 days now, 100 from 2027-03, 47 from 2029-03. No publicly trusted CA implements ACME for onions (RFC 9799) yet; Let's Encrypt does not issue `.onion`. CT logging is de-facto mandatory, so the onion address becomes public (fine — it's advertised anyway); the wildcard keeps individual account names out of CT logs.
7. **Onion services are outbound-only** (they punch through NAT; no inbound ports or public IP), so a Fly machine with no `[[services]]` works; autostop only acts on proxy-managed services. Fly's AUP does not address onion services (they are neither exit nodes nor public proxies); public precedent exists for tor daemons on Fly.
8. **Onion-Location is manual-only.** Tor Browser removed the automatic redirect in 13.0.12 (2024-03) after the PoPETs 2025 fingerprinting study; the header now yields a ".onion available" button. It requires the advertising page to be certified HTTPS and non-onion, preserves the URL path, performs no same-entity check, and therefore supports per-subdomain targets (`name.nido.fyi` → `name.<addr>.onion`).
9. **Sauteed Onions** is the literal "link nido.fyi's HTTPS certificate to the onion": issue a CT-logged cert for `<56charaddr>onion.nido.fyi` (61 chars — under the 63-char label limit). Any CA works, including Let's Encrypt. Tor Project classifies it as research-phase (no browser UX), but the CT record is a public, censorship-resistant, auditable binding. Mullvad ships one in production.
10. **Cloudflare no longer challenges Tor by default** (IP threat score retired; rules disabled by ~Q1 2026), but the always-on automated botnet layer can still serve Managed Challenges, and a challenge on a fetch/XHR is a hard, silent failure; Turnstile pre-clearance cannot rescue cross-origin calls from an onion page. Tor exits are addressable as pseudo-country `T1` in WAF rules. All three nido API hosts are CF-proxied with `access-control-allow-origin: *`. Most public Soroban RPC endpoints are themselves CF-fronted.
11. **Cloudflare Onion Routing** (Alt-Svc to shared `cflare*.onion` addresses) is transparent transport, provides no stable branded onion identity, and is reported unreliable through 2026-03. Orthogonal — not a substitute for self-hosting.
12. **Related Origin Requests** (WebAuthn L3 §5.11; Chrome/Edge 128+, Safari 18, Firefox 152 — not TB's ESR-140 base): an onion origin may assert with `rpId: name.nido.fyi` if `https://name.nido.fyi/.well-known/webauthn` lists the onion origin — existing passkeys work on the onion without new registration, in supporting browsers.

## Architecture

One new Fly app (`nido-onion`), single machine, no inbound services:

```
Tor network ⇄ (outbound circuits) tor daemon ── HiddenServicePort 80 ──► Caddy (localhost)
                                                                            │ Host-header vhost routing
        ┌───────────────────────────────────────────────────────────────────┤
        │ <addr>.onion, <name>.<addr>.onion   → static Astro dist (onion build)
        │ relay.<addr>.onion                  → backhaul https://relay.nido.fyi
        │ pool-indexer.<addr>.onion           → backhaul https://pool-indexer.nido.fyi
        │ rpc.<addr>.onion                    → backhaul public Soroban RPC
        │ relayer path                        → Fly 6PN private network → existing `nido` app
        │ /.well-known/nido.json (any vhost)  → resolver backhaul (or Caddy reimpl — epic task)
        └───────────────────────────────────────────────────────────────────
```

### tor configuration

- `HiddenServiceNonAnonymousMode 1` + `HiddenServiceSingleHopMode 1` (`SocksPort 0` required): server-side path 3 hops → 1; users keep full 3-hop anonymity. Same mode as EOTK-based enterprise onions.
- `HiddenServicePoWDefensesEnabled 1` (+ intro-DoS rate limits). Requires tor 0.4.8+ built `--enable-gpl` — Debian's package qualifies; base the image on Debian.
- Vanguards irrelevant in non-anonymous mode.

### Onion identity key

- Mine `nido…` prefix with mkp224o **offline** (4–5 char prefix: seconds). Never accept third-party-mined keys.
- `hs_ed25519_secret_key` is the identity: leak = impersonation, loss = new address. Store as base64 Fly secret written into `HiddenServiceDir` at boot; keep an offline backup. Key-ceremony runbook is a phase-4 deliverable.

### Frontend (onion build)

- Second CI build of `packages/frontend` with onion env: `PUBLIC_NIDO_BASE=http://<addr>.onion`, relay/relayer/indexer URLs pointed at onion vhosts / same-origin paths. Baked into the Fly image on deploy.
- **Capability detection:** if `window.PublicKeyCredential` is undefined (stock Tor Browser), app runs read-only — browse, receive, view state — with a banner explaining signing options (Brave Tor window; Firefox over Tor once the HARICA cert ships). If present, full flows.

### API backhaul (EOTK pattern — BBC/NYT prior art)

Caddy reverse-proxies API vhosts server-side to clearnet over HTTPS from the machine's fixed egress IP. This solves both exit-IP reputation and the cross-origin-challenge problem in one move:

- Relayer via Fly 6PN — never touches the public internet.
- CF Workers backhaul + allowlist the egress IP; add WAF skip rules for `T1` on API hostnames so Tor users hitting clearnet APIs directly also survive.
- Audit relayer allowlist/Caddy `x-api-key` stamping for onion-origin awareness (phase 2).

## Discovery & binding

**Day 1 (free, automatable):**

1. `Onion-Location` header per-subdomain, added in the existing `*.nido.fyi` worker proxy: `name.nido.fyi` → `http(s)://name.<addr>.onion`. Manual button by design — do not attempt auto-redirect. Env-gated (`ONION_ADDR`) so it ships before the production address exists.
2. `/tor` docs page + `security.txt` entry listing the onion address.

**Phase 2 (required — spike settled it):** one HARICA DV cert with SANs `{nido.fyi, <addr>.onion, *.<addr>.onion}`:

- Onion names validated via the ed25519 onion-CSR (BR Appendix B — the only wildcard-permitted method); `nido.fyi` via standard DNS validation. Mixed clearnet+onion SANs are BR-legal (Facebook's DigiCert EV onion cert is precedent). **Verify at purchase that HARICA's product packaging accepts mixed SANs**; fallback = onion-only wildcard cert plus a separate free sauteed-SAN cert (`<addr>onion.nido.fyi`, Let's Encrypt) for the binding.
- The cert serves the onion vhosts on Fly Caddy AND its CT log entry is the public domain↔onion binding — one artifact, two jobs.
- Clearnet nido.fyi stays on Cloudflare Universal SSL (free). Serving the mixed cert at CF's edge would need a Business plan (~$200/mo) and buys nothing: the binding lives in CT, not in what clearnet visitors are served.
- Manual renewal ≤200 days → calendar runbook.

Sauteed-Onions SAN: optional interim only (e.g. if the gap between launch and the HARICA purchase is long).

## Accounts

- **Day 1 — onion-native:** create account on `name.<addr>.onion`; passkey RP ID is that hostname; same factory/contracts; zero contract changes.
- **Phase 3 — existing accounts:**
  - **ROR:** serve `/.well-known/webauthn` on `name.nido.fyi` (resolver worker) listing the onion origin → clearnet passkey asserts on onion in Chrome 128+/Safari 18/Firefox 152. Caveats: the browser fetches the well-known over clearnet (add CF skip rule so it is never challenged), and it leaks "this browser visits nido" to the clearnet path — some onion users will decline.
  - **Dual-signer fallback:** flow to add a second passkey (bound to the onion origin) as another signer on the existing smart account — multi-signer support already exists.

## Phases (epic structure)

- **Phase 0 — Spike (gates 2+):** throwaway onion; matrix: WebAuthn create/assert × {Brave Tor window, Firefox 152+ over Tor SOCKS (+ locally-trusted TLS), TB about:config flip} × {http, https}. Publish results (likely first public field verification of WebAuthn on an onion origin).
- **Phase 1 — Mirror:** key ceremony, Fly tor+Caddy app, onion frontend build, vhost routing, Onion-Location, sauteed SAN, `/tor` page.
- **Phase 2 — App parity:** API backhauls, capability-detect UX, onion-native accounts e2e, HARICA wildcard cert (conditional), relayer onion-awareness audit.
- **Phase 3 — Existing accounts:** ROR well-known + dual-signer flow.
- **Phase 4 — Hardening/ops:** PoW tuning, onion uptime monitoring (onionprobe), key-backup and cert-renewal runbooks, threat-model doc.

## Risks

- ~~Spike may refute Brave path~~ **Resolved 2026-07-11**: Chrome (automated, create+assert, both origins) and Brave (real platform authenticator, create) both pass over https. Remaining spike rows (Firefox, Tor Browser controls, Brave assert) are confirmatory, not gating.
- **HARICA mixed-SAN packaging unverified** — if their DV Onion product rejects non-onion SANs, fall back to onion-only wildcard + separate sauteed-SAN cert for the binding.
- **TB first-party isolation** buckets all `*.<addr>.onion` under one circuit/storage — same shape as clearnet eTLD+1 (`nido.fyi`); no regression.
- **Fly policy** — AUP silent on onion services; low risk (not an exit/proxy); optional support ticket for comfort.
- **Cert-lifetime squeeze** — 47-day certs by 2029 with no onion ACME CA yet; revisit when a CA implements RFC 9799.
- **Onion build drift** — two frontend builds must not diverge; CI builds both from one source.

## Key sources

- TB WebAuthn off: `001-base-profile.js` L504 (stable + alpha branches); tpo/applications/tor-browser#26614, #44158; support.torproject.org known-issues
- Subdomains/vhosting: spec.torproject.org/address-spec; RFC 7686; publicsuffix.org (`onion`)
- Secure context: `000-tor-browser.js` (`dom.securecontext.allowlist_onions`); Gecko `WebAuthnUtil.cpp` ("more lenient than the spec"); brave-core PR #18325
- Onion TLS: CA/B BR v2.2.8 Appendix B; HARICA onion announcement + guides + `HARICA-official/onion-csr`; RFC 9799; acmeforonions.org; crt.sh/Cert Spotter live wildcard onion certs (Proton, Brave)
- Onion-Location manual-only: TB 13.0.12 release; PoPETs 2025 Syverson/Dahlberg/Pulls/Jansen
- Sauteed Onions: sauteed-onions.org; Mullvad production SAN
- Cloudflare: challenges docs (fetch = hard fail), automated botnet protection blog, onion-routing docs, `T1` country code
- Fly: networking/services + egress docs; community Tor threads; fly-tor-bridge-obfs4
- ROR: WebAuthn L3 §5.11; Bugzilla 2010193 (Firefox 152)
- tor config: single-onion + PoW man pages; EOTK
