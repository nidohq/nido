# Send to a named nido — design

**Date:** 2026-06-07
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `feat/send-to-named-nido` (stacked on `fix/name-claim-bug-3`, PR targets #61)

## Context

The account page now has a **Send XLM** panel (added in PR #59). Today the recipient
field accepts a raw C-address (contract) or G-address (classic account). We want a user
to instead type a **named nido** — `alice`, or the cosmetic `alice.nido` — and have it
resolve to the correct account contract (C-address) before sending.

The name-registry contract already exposes a read-only `resolve(name) -> Option<Address>`
and `lookup(address) -> Option<String>`. The SDK already has `resolveFriendInput(input,
{resolveName})` which accepts a name, C-address, or G-address and returns
`{kind, address}`. The Send flow already pays a C-address: `sendXlm` calls
`smartAccount.execute(XLM_SAC, "transfer", [from, to, amount])`, and the XLM SAC accepts
any Soroban `Address`, including a contract. **So this is a frontend-only change** — no
contract modification is required.

## Security analysis (the core decision)

A name is a **mutable** pointer (it can be released, transferred, re-registered). An
address is **immutable**. The security of name-based payments hinges entirely on **what
the passkey signs**: the name, or the resolved address.

### Approach A — resolve in the frontend, sign over the address (chosen basis)
Resolve `alice → CABC…` client-side **before** building the tx. The signed transaction's
destination is the concrete C-address; the name never enters the signed payload.

- **TOCTOU-safe:** if the name is transferred/re-pointed after signing, funds still go to
  the address the user reviewed. The signature commits to an address, not to a mutable
  name binding.
- **Registry stays a non-custodial read oracle** — it only answers `resolve`; it never
  touches funds.
- **Residual risks, all mitigated in UI:**
  - *Malicious/compromised registry* could answer `alice → attacker`. → Mitigation: render
    the resolved C-address (and reverse-lookup name) before the passkey prompt.
  - *Look-alike names* (`alice`/`a1ice`, `0`/`o`, `1`/`l`). → Mitigation: show resolved
    address; names are constrained to `[a-z0-9]`, so the surface is small.
  - *Stale cache* (the 5-min `resolveNameCached`) could resolve a just-transferred name to
    the old owner. → Mitigation: bypass the cache for the actual send (resolve fresh); the
    user still verifies the address.

### Approach B — resolve on-chain at execution time (rejected)
The tx carries the **name**; a contract (registry-as-forwarder, or a name-resolving SAC
wrapper) determines the destination at execution time.

- **TOCTOU-vulnerable / fund misdirection:** between sign and ledger-close the name can be
  re-registered or transferred, so funds land on whoever owns the name *at execution*, not
  whom the user reviewed. Mempool-watching attackers who can re-point the name front-run
  the payment.
- **Turns a directory into a payment router:** giving the name-registry an `execute`/
  forward capability makes it a fund-moving contract — far larger attack surface (upgrade
  risk, reentrancy, a bug drains forwarded value) and it enters the signed auth path.
- Strictly more trust, strictly more risk, for no UX gain over A.

### Decision: Approach C = A hardened
Approach A **plus** a non-optional confirmation line that renders the resolved address and
the reverse-lookup canonical name before signing. No contract change. The registry remains
a pure read oracle; the signature commits to the concrete resolved address.

## Components (all frontend)

1. **`normalizeRecipientInput(raw): string`** — new util in `packages/frontend/src/lib/`.
   Trims/lowercases; strips a known cosmetic suffix (`.nido`, `.nido.fyi`, and `.localhost`
   for dev) **only when** the remaining label is a valid registry name (`/^[a-z][a-z0-9]{0,14}$/`).
   Raw `C…`/`G…` and anything else pass through unchanged (let `resolveFriendInput` judge).
   Focused unit tests.
2. **Resolution wiring in the Send panel** (`packages/frontend/src/pages/account/index.astro`)
   — debounced as-you-type call to `resolveFriendInput(normalizeRecipientInput(value),
   { resolveName })`, mirroring the recovery-friend UX. `resolveName` calls the registry's
   `resolve()` **fresh (cache bypassed)** for correctness.
3. **Confirmation display** — `Sending to alice → CABC…XYZ`, plus a reverse `lookup()` of
   the resolved address to show its canonical registered name when present. The anti-spoof
   step; always visible before the passkey prompt.
4. **Send handler change** — feed the **resolved address** (not the typed string) into the
   existing `sendXlm(...)`. Submit is blocked unless resolution succeeded.

## Data flow

```
type → debounce → normalizeRecipientInput → resolveFriendInput
  kind:'name'              → show "name → address" + reverse name
  kind:'contract'|'account'→ show address (+ reverse name if registered)
  null                     → "No nido named X / invalid address"; submit disabled
submit → re-resolve FRESH → sendXlm({ smartAccount, destination: resolvedAddress, stroops })
         (passkey signs over the concrete address — TOCTOU-safe)
```

## Error handling

- Unresolvable name or RPC failure → block send with a clear message; never fall through to
  a raw/zero/typed address.
- Cache is bypassed for the actual send; any short-lived cache is for typing feedback only.

## Testing

- **Unit:** `normalizeRecipientInput` — suffix stripping, `C…`/`G…` passthrough, invalid
  labels, dev `.localhost`. (`resolveFriendInput` already has tests.)
- **Unit:** the Send handler resolves and uses the resolved address; blocks on `null`.
- **Testnet e2e (real proof):** register a name, send XLM to it from another account, assert
  the balance moves. The @fast tier has no chain, so name resolution can't be exercised
  there — the testnet tier is the real guard.

## Branch / PR logistics

- Branch `feat/send-to-named-nido` off `fix/name-claim-bug-3`.
- PR targets `fix/name-claim-bug-3` (stacked on #61).
- When #61 merges, GitHub auto-closes a child PR if its base branch is deleted — so
  **retarget this PR to `main` once #61 lands**.

## Out of scope

- No name-registry contract changes (no on-chain `execute`/forwarding).
- No `.nido` TLD support on-chain (the suffix is purely a cosmetic frontend convenience).
- Non-XLM assets / batch sends.
