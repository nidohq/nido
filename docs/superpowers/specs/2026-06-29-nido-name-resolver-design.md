# Nido Name Resolver — Design

**Status:** approved (brainstorming)
**Date:** 2026-06-29
**Author:** Nido team + Claude

## Goal

Let Soroban-aware wallets and dApps turn a Nido name into the account's
contract address (and back) over plain HTTP, without running any Nido code or
speaking Soroban RPC themselves.

A single read-only endpoint, served on every account subdomain:

```
GET https://<subdomain>.nido.fyi/.well-known/nido.json
```

## Background & constraints

- Nido accounts are **Soroban smart accounts — C-addresses (contract
  addresses)**. A classic Stellar wallet cannot pay a C-address (that needs a
  Soroban SAC transfer), so the only consumers that can *act* on a resolved
  address are already Soroban-aware. This is why we expose a plain JSON shape
  rather than SEP-0002 federation (whose `account_id` is a `G…` and which
  classic wallets still couldn't use here).
- Name ↔ address mapping already lives on-chain in the **name-registry**
  contract (`resolve(name) -> Option<Address>`, `lookup(owner) -> Option<String>`).
  The frontend already calls these via `resolveName` / `lookupName`
  (`packages/passkey-sdk/src/resolve.ts`). The resolver re-uses that exact
  logic, server-side.
- Every `*.nido.fyi/*` request already passes through the `nido-proxy`
  Cloudflare Worker (`frontend/worker-proxy-nido/index.js`), which reverse-
  proxies to the `nido` Pages project and maps preview suffixes (`--<N>`) to
  Pages branch aliases. The apex `nido.fyi` is NOT matched by `*.nido.fyi`.
- Workers are deployed from CI on push to `main`
  (`.github/workflows/deploy.yml`, `wrangler deploy --config <worker>/wrangler.toml`).
  `infra/recovery-relay` is the precedent for a full TS worker (own
  `package.json`, deps bundled by wrangler, own route, vitest tests).

## Out of scope

- **Name passkey as an on-chain signer / operating from the name subdomain.**
  That is a separate, deferred sub-project. The current
  `/security/` + `/transfer/` behaviour (resolve the name, redirect to the
  contract-id subdomain to sign) is unchanged by this work.
- A central `nido.fyi/resolve?name=` endpoint. The per-subdomain well-known is
  sufficient for both directions (see Endpoint), so YAGNI.
- Write operations, auth, accounts list, SEP-0001/0002 documents.

## Architecture

A new dedicated Cloudflare Worker, **`nido-resolver`**, bound to the more-
specific route:

```
*.nido.fyi/.well-known/nido.json
```

Cloudflare dispatches the most specific matching route, so this Worker handles
`/.well-known/nido.json` while the existing `nido-proxy` Worker continues to
serve everything else under `*.nido.fyi/*`. The trivial proxy stays
dependency-free; resolution logic and the Stellar dependency are isolated here.

Rationale for a dedicated Worker over the alternatives:
- **Extend `nido-proxy`:** would add a build step + a heavy Stellar dependency
  to a currently dependency-free file that every request flows through.
  Rejected to keep the hot proxy path lean and independently deployable.
- **Pages Function:** the proxy rewrites the request host to `…pages.dev`
  before the Pages origin sees it, so a Function would lose the original
  `<name>`. A Worker bound to `*.nido.fyi/…` runs *before* the proxy and sees
  the real subdomain in `request.url`. Rejected.

The Worker reuses `@nidohq/passkey-sdk`'s `resolveName` / `lookupName` and the
hostname parsers (`contractIdFromHostname`, `nameFromHostname`, `isContractId`)
so the resolution rules stay identical to the app. (If the bundled
`@stellar/stellar-sdk` exceeds the Worker size budget, the implementation falls
back to `@stellar/stellar-base` + a hand-built `simulateTransaction` POST; the
plan verifies bundle size before choosing.)

## Endpoint contract

### Request

`GET https://<subdomain>.nido.fyi/.well-known/nido.json`

`<subdomain>` (after stripping any `--<N>` / `--pr-<N>` preview suffix) is one
of:
- a **name** — `^[a-z][a-z0-9]{0,14}$`, not numeric, not a reserved dApp
  subdomain (`status-message`), not a contract id;
- a **contract id** — a 56-char `C…` strkey.

`OPTIONS` is answered for CORS preflight.

### Success — `200 application/json`

```json
{ "name": "alice", "address": "CDRBWQ…ZBFMM", "network": "testnet" }
```

- **Name subdomain (forward):** `name` = the requested name, `address` =
  `registry.resolve(name)`.
- **Contract subdomain (reverse):** `address` = the contract id from the
  subdomain, `name` = `registry.lookup(address)` or `null` if the account has
  no registered name. (The address alone is a valid result, so this is `200`,
  not `404`.)
- `network` reflects the Worker's configured network (`"testnet"` now).

Response headers (all responses):
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, OPTIONS`
- `Cache-Control: public, max-age=60` (names rarely change; bounds RPC load)
- `Content-Type: application/json`

### Errors

| Case | Status | Body |
|---|---|---|
| Name subdomain, not registered | `404` | `{ "error": "name not found", "name": "alice", "network": "testnet" }` |
| Subdomain is neither a valid name nor a valid C-address (apex, reserved dApp subdomain, malformed) | `404` | `{ "error": "not a Nido account" }` |
| Registry / RPC upstream failure | `502` | `{ "error": "resolver upstream unavailable" }` |
| Method other than GET/OPTIONS | `405` | `{ "error": "method not allowed" }` |

Errors carry the same CORS headers. `404`/`405` use a short cache
(`max-age=10`); `502` is `no-store`.

## Resolution logic

1. Parse `url.hostname` → first label → strip preview suffix → `raw`.
2. If `isContractId(raw)` → **reverse**: `address = raw.toUpperCase()`,
   `name = await lookupName(rpcUrl, registryId, address, passphrase)`.
3. Else if `nameFromHostname(hostname)` returns a name → **forward**:
   `address = await resolveName(rpcUrl, registryId, name, passphrase)`;
   `404` if `null`.
4. Else → `404 not a Nido account`.

`resolveName` / `lookupName` already wrap `simulateTransaction` and return
`null` on simulation error, so a genuine RPC/transport failure must be
distinguished from "not found": the Worker wraps the calls and maps a thrown
transport error (fetch reject / non-200 RPC) to `502`, while a `null` return
on a name lookup is `404`.

## Configuration

Per-network, via `wrangler.toml` `[vars]`:
- `NIDO_NETWORK` — `"testnet"` (drives the `network` field).
- `NIDO_RPC_URL` — `https://soroban-testnet.stellar.org`.
- `NIDO_REGISTRY_ID` — the name-registry contract id for the network
  (testnet: `CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX`, the
  same value as `REGISTRY_FALLBACKS["name-registry"]`).
- `NIDO_NETWORK_PASSPHRASE` — `Test SDF Network ; September 2015`.

**Preview vs production network:** today every `*.nido.fyi` host — production
and `--<N>` previews alike — is testnet, so one config serves both. When
production moves to mainnet, previews must remain testnet; at that point the
Worker keys network/registry off the presence of a `--<N>` suffix. Documented
here; not built now (single testnet config).

## Caching

`Cache-Control: public, max-age=60` lets Cloudflare's edge and clients cache.
Optionally the Worker uses the Cache API keyed on the full URL to collapse
RPC calls for hot names; this is an optimisation the plan may include but is
not required for correctness.

## Security

- Read-only. Names and addresses are already public on-chain; exposing them
  over HTTP leaks nothing. No auth, no secrets in the Worker.
- `Access-Control-Allow-Origin: *` is appropriate for public read data and lets
  any dApp fetch it.
- The Worker only issues `simulateTransaction` (read) calls — it never signs,
  submits, or holds keys.
- Abuse surface is RPC load; the 60s cache + Cloudflare's edge absorb repeats.
  No additional rate-limiting in v1.

## Testing

- **Unit (vitest, mirroring `infra/recovery-relay/test`):** subdomain parsing
  (name / contract id / preview suffix / reserved / apex / malformed), forward
  hit, forward miss → `404`, reverse hit, reverse `name: null`, RPC throw →
  `502`, `OPTIONS` preflight, non-GET → `405`, and that CORS + cache headers
  are present. `resolveName`/`lookupName` (i.e. the RPC `fetch`) are mocked.
- **Live smoke (post-deploy):**
  `curl https://<name>--<PR>.nido.fyi/.well-known/nido.json` returns the right
  address; `curl https://<contract>--<PR>.nido.fyi/.well-known/nido.json`
  returns the name (or `null`); an unregistered name → `404`.

## Components / files (anticipated)

- `infra/nido-resolver/` — new Worker package, structured like
  `infra/recovery-relay/`:
  - `src/index.ts` — fetch handler: parse, dispatch forward/reverse, errors,
    CORS, cache.
  - `wrangler.toml` — `name = "nido-resolver"`, route
    `*.nido.fyi/.well-known/nido.json`, `[vars]` config.
  - `package.json`, `tsconfig.json`, `vitest.config.ts`, `test/`.
  - `DEPLOY.md` — mirror recovery-relay's (token scopes, route, smoke check).
- `.github/workflows/deploy.yml` — add a "Deploy nido-resolver worker" step
  (mirrors the recovery-relay step), gated on the resolver path.

## Risks / assumptions

- **Route precedence (correctness-critical).** This design assumes Cloudflare
  dispatches `*.nido.fyi/.well-known/nido.json` to `nido-resolver` while
  `*.nido.fyi/*` continues to reach `nido-proxy` (most-specific route wins).
  This is documented Cloudflare behaviour, but the plan must verify it early
  (deploy both, confirm the resolver answers `/.well-known/nido.json` AND a
  normal page path still proxies). **Fallback if it does not hold:** fold the
  resolver into `nido-proxy` itself — intercept the `/.well-known/nido.json`
  pathname before the proxy rewrite and serve from there (accepting the
  Stellar dependency in that Worker).
- **Worker bundle size.** `@stellar/stellar-sdk` may be large for a Worker;
  the plan measures it and falls back to `@stellar/stellar-base` + a raw
  `simulateTransaction` POST if needed (resolution logic is otherwise
  identical).

## Success criteria

1. `GET <name>.nido.fyi/.well-known/nido.json` returns
   `{name, address, network}` with the correct on-chain address.
2. `GET <contract>.nido.fyi/.well-known/nido.json` returns the reverse name (or
   `null`).
3. Unregistered name → `404`; non-account subdomain → `404`; RPC down → `502`.
4. CORS allows cross-origin `fetch`; responses are edge-cacheable.
5. The existing `nido-proxy` behaviour for all other paths is unchanged.
