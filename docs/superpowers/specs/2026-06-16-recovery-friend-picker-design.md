# Recovery friend-picker + cross-device signing — design

Date: 2026-06-16
Branch: `feat/refractor-recovery-flow` (PR #100)
Status: approved design, pre-implementation

## Context

Account recovery uses a multi-party "handoff": the recovering account's owner
(originator) stages a signer rotation, then needs a threshold of pre-named
friends to authorize it with their own passkeys. Friends authorize a **nested
Soroban auth entry** (delegated-friend auth), not a Stellar envelope signature.

Today's flow (see `packages/frontend/src/lib/recoveryActions.ts`,
`packages/frontend/src/pages/security/recover/index.astro`):

- The originator stores each unsigned rotation tx in **Refractor**
  (`refractorClient.ts`) purely as a fetch-by-hash blob store, and shares ONE
  link `https://<account>.<…>.nido.fyi/security/recover/?handoff=<base64>`.
- The handoff payload (`RotationHandoff` v3, `passkey-sdk/src/friendSigning.ts`)
  carries only `account`, `recoveryRuleId`, `refractorTxHashes[]`,
  `parentSignatureExpirationLedger`.
- A friend must open the link **on their own account subdomain** (WebAuthn rpId),
  signs with `signRotationAsFriend`, and gets a blob they **copy/paste back** to
  the originator, who records it via `addFriendSignature` into
  `staging.collected` (localStorage). Progress + per-friend ✓ live only on the
  originator's device.

### Problems this solves

1. The shared link points at the **recovering** account's subdomain, where a
   friend cannot sign (wrong rpId). There is no guidance to get them to their own
   account.
2. Copy/paste of signature blobs is clumsy and error-prone.
3. "Who has signed" lives only in the originator's browser, so there is no
   cross-device / each-friend-on-their-own-phone view, and no way to grey out
   friends who already signed.

### Why not Refractor for status

Refractor (`stellar-expert/refractor`) is an **ed25519 envelope-signature**
aggregator content-addressed by the **tx body hash** (`Signer` in
`api/business-logic/signer.js`: keys on `tx.hash()`, verifies sigs with
`Keypair.verify(txHash, sig)` against source-account signers). Our friend
contributions are secp256r1/WebAuthn nested auth entries **inside** the tx body —
adding one changes the hash (→ different record, not a merge) and would be
rejected as a non-matching signature. So Refractor cannot collect friend
signatures; cross-device status needs a separate store.

## Goals

- Friend opens the shared link → a **picker** on the recovering-account page lets
  them choose which friend they are → redirect to their **own** nido subdomain to
  sign.
- Friends shown by **Nido name** (registry reverse-lookup), fallback truncated
  C-address.
- Friend signs once per staged tx with their passkey, then their signature is
  **submitted to a relay** (no more copy/paste); they land on a "Signed ✓"
  confirmation on their own nido.
- The picker **greys out** friends who have already signed, read from the relay
  (works on any device).
- Originator collects signatures by **polling the relay** instead of pasting;
  threshold met → existing `submitRotation`.

## Non-goals

- Changing the on-chain rotation / nested-auth mechanics
  (`buildFriendAuthEntry`, `submitRotation`, the parent auth-digest scheme) — all
  unchanged.
- Changing how Refractor stores the unsigned txs (still fetch-by-hash).
- Friend nicknames/management UI, notifications, or reminders.

## Architecture

### Components

| Unit | Location | Responsibility | Depends on |
|------|----------|----------------|------------|
| `recovery-relay` worker | `infra/recovery-relay/` | Dumb capability-gated blob store (KV) | Cloudflare KV |
| `relayClient.ts` | `packages/frontend/src/lib/relayClient.ts` | PUT/GET wrappers (mirrors `refractorClient.ts`) | fetch |
| Picker view | `security/recover/index.astro` (+ lib) | List friends, names, grey-out, redirect | `findRecoveryRules`, `lookupName`, `relayClient` |
| Friend-confirm view | `security/recover/index.astro` | Sign + PUT to relay + "Signed ✓" | `signRotationAsFriend`, `relayClient` |
| Originator collect | `recoveryActions.ts` | Poll relay → `addFriendSignature` → submit | `relayClient`, existing validator |

The relay is intentionally **dumb**: it never parses or validates blobs. All
cryptographic validation stays in the originator's existing `addFriendSignature`
(rule membership, entry count, digest match) at pull time, and on-chain at submit.

### Data model (relay KV)

- Key: `${relayKey}:${friendAddr}` → value: FriendSignature blob (base64url string,
  exactly what `signRotationAsFriend` produces today).
- `expirationTtl`: seconds remaining until `parentSignatureExpirationLedger`
  (converted ledger→time, ~5s/ledger on testnet), clamped to a sane min/max.
- `relayKey`: random 16 bytes (base64url), minted by the originator in
  `prepareRotation`. Possession of `relayKey` is the only capability — the worker
  derives the bucket from it. No accounts/secrets stored.

### Handoff payload: v3 → v4

Add one field to `RotationHandoff` (`passkey-sdk/src/friendSigning.ts`) and its
wire form:

```
version: 4
account, recoveryRuleId, refractorTxHashes[], parentSignatureExpirationLedger   // unchanged
relayKey: string   // NEW — base64url capability for the relay bucket
relayBaseUrl?: string  // optional override; defaults to the deployed relay URL
```

`encodeRotationHandoff` / `decodeRotationHandoff` updated; decode accepts v4 and
rejects v3 with a clear "stale link, restart recovery" error (recovery sessions
are short-lived, so no long-term back-compat needed).

### Relay worker API

- `PUT /sig/:friend` — body: blob (text). Query `?bucket=<relayKey>`. Stores
  `KV[`${bucket}:${friend}`] = body` with TTL. 204 on success. Rejects missing
  bucket/oversized body.
- `GET /sig` — query `?bucket=<relayKey>`. Lists KV by prefix `${bucket}:` →
  `{ signed: [{ friend, blob }] }`. Empty if none / unknown bucket.
- `GET /` — health.

CORS: allow the nido.fyi origins (and `*--pr-N` preview hosts) so the page can
call it cross-subdomain.

## Flows

### Originator stages (changed)
`prepareRotation`: as today (assemble txs, store unsigned to Refractor) **plus**
mint `relayKey`; include it in the v4 handoff. Share link unchanged in shape
(now carries the relayKey inside the payload).

### Friend opens link → picker (new)
Link host = recovering account subdomain. Page detects `?handoff` and
`contractIdFromHostname() === handoff.account` → **picker mode**:
1. `findRecoveryRules(account)` → friends[] + threshold (live chain read).
2. `lookupName(friendAddr)` (`resolve.ts`, registry `lookup(owner) -> Option<String>`)
   per friend → name, fallback `addr.slice(0,6)…slice(-4)`.
3. `relayClient.list(relayBaseUrl, relayKey)` → signed friend set.
4. Render list: each friend a row; signed → greyed + ✓ + disabled. Header
   "N of threshold collected".
5. Tap an unsigned friend → `location.assign("//<friendAddr>.nido.fyi/security/recover/?handoff=<same>")`.

### Friend signs on own subdomain (changed tail)
`?handoff` and `contractIdFromHostname()` is a FRIEND (≠ account) → friend mode:
1. existing membership gate + `signRotationAsFriend` (passkey nested auth, one
   assertion per staged tx) → FriendSignature blob.
2. `relayClient.put(relayBaseUrl, relayKey, friendAddr, blob)`.
3. Show "Signed ✓ — you can close this" confirmation on their own nido. (No paste
   textarea.)

### Originator collects + submits (changed source)
- Poll `relayClient.list(...)` (button + interval). For each blob not already in
  `staging.collected`, run **existing** `addFriendSignature(account, blob)`
  (validates + stores). Progress = `collectedCount(staging)` vs threshold.
- Threshold met → existing `submitRotation` (unchanged).
- Paste UI removed; `addFriendSignature` retained as the validator.

## Error handling

- **Relay unreachable (picker):** show all friends ungreyed with a "status
  unavailable" note; signing still works (PUT retried on the friend side).
- **Relay unreachable (friend PUT):** retry with backoff; on persistent failure,
  fall back to showing the blob with a copy button (degraded paste path) so the
  signature is not lost.
- **Bad/oversized/duplicate blob:** worker rejects oversized; originator's
  `addFriendSignature` rejects invalid blobs at pull time and surfaces which
  friend failed.
- **Non-friend signer:** blocked by the existing on-chain membership gate in
  `signRotationAsFriend`.
- **Stale v3 link:** decode throws a clear "restart recovery" error.
- **Expired bucket (TTL):** GET returns empty → picker shows nothing collected,
  consistent with an expired handoff.

## Security

- `relayKey` in the link is the capability to participate; sharing the link
  already grants that. Anyone with it can read who-signed and write a blob.
- Writing a bogus blob is harmless: the originator validates every blob
  (`addFriendSignature`) and the chain validates at submit; junk is rejected.
- Reading exposes friend addresses + their nested-auth assertions, but those
  authorize only THIS rotation digest and only within the parent-expiration
  window (TTL-bounded). Acceptable for a short-lived recovery session.
- Worker holds no secrets, does no chain I/O, and namespaces strictly by
  `relayKey`. KV TTL bounds retention.

## Testing

- **Worker:** wrangler/miniflare unit tests — PUT/GET round-trip, bucket
  isolation (one bucket can't read another), TTL set, oversized-body rejection,
  CORS headers.
- **`relayClient.ts`:** put/list against mocked fetch (success, error, empty).
- **`recoveryActions` collect:** relay poll → `addFriendSignature` integration
  with mocked relay; threshold transition.
- **Handoff v4:** `encode`/`decode` round-trip incl. `relayKey`; v3 rejected.
- **Picker:** name resolution (name + address fallback) and grey-out from relay
  status (component/DOM test).
- Preserve existing rotation/encoding tests (incl. the #72 ScVal byte-identity
  test).

## File map

- New: `infra/recovery-relay/{wrangler.toml,src/index.ts,test/…}`
- New: `packages/frontend/src/lib/relayClient.ts`
- Edit: `packages/passkey-sdk/src/friendSigning.ts` (handoff v4 + relayKey)
- Edit: `packages/frontend/src/lib/recoveryActions.ts` (mint relayKey; relay PUT on
  friend sign; relay poll on collect; drop paste path)
- Edit: `packages/frontend/src/pages/security/recover/index.astro` (picker view,
  friend-confirm view, remove paste UI)
- Edit: `.github/workflows/deploy.yml` (deploy the recovery-relay worker, same
  pattern as nido-proxy)

## Deployment notes

- New CF Worker needs a KV namespace (`wrangler kv namespace create`), a route on
  `nido.fyi`, and the existing `CLOUDFLARE_API_TOKEN` to include Workers
  Scripts:Edit (already added) + the KV/route scopes.
- The relay base URL is compiled into the frontend (env/public var) and echoed in
  the handoff (`relayBaseUrl`) so preview builds can point at a preview relay.

## Open questions

None blocking. Implementation plan to sequence: (1) worker + relayClient, (2)
handoff v4, (3) friend-submit, (4) picker + names, (5) originator poll + drop
paste, (6) deploy wiring.
