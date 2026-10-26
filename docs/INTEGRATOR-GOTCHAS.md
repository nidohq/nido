# Integrator gotchas & error-code reference

Notes from integrating Nido into a real dapp on Stellar (HackMeridian). This
complements [`ADD-NIDO-TO-DAPP.md`](./ADD-NIDO-TO-DAPP.md) with the sharp edges we hit, the exact error
codes, and the fixes — so the next integrator doesn't rediscover them.

## Session models

For app-scoped calls (letting your app act for the account without a wallet popup each time), Nido has a
good model and a legacy one — use the good one.

1. **Per-transaction passkey.** Every `signTransaction` opens the passkey ceremony: one device prompt per
   transaction, nothing signable kept on the client. The kit's basic flow.

2. **Session passkeys (recommended).** The owner approves a Perch rule once that names an app-held WebAuthn
   passkey (an `External` signer) for a contract's functions, optionally under a rolling cap. The device
   then prompts on **every call**, and the passkey's private key **never leaves the authenticator** — so
   nothing in the browser can spend. This is the model the current example ships.

3. **Legacy ed25519 "session keys" (avoid).** An older path where the app holds a classic ed25519
   `Delegated` key whose **secret sits in `localStorage`** and signs **silently** until the grant expires.
   It's easy to land on from an older scaffold (watch for a `scaffold:nido-session:` secret). If you're on
   it, migrate to session passkeys — same grant model, but nothing signable on disk.

## Error-code cheat sheet

| Symptom | Code | Cause → fix |
| --- | --- | --- |
| A popup-signed call *into another contract* is refused | `#3002` UnvalidatedContext / `#3014` ContextRuleIdsLengthMismatch | The sign popup signs under the account's **admin rule**, scoped to the account itself — it can't authorize a call into a protocol contract. Use a **session-key rule** targeting that contract. |
| A grant with a spending cap is rejected | `#3223` | A cap can only be carried by a token **`transfer`**. Put the cap on the token rule; other functions get an uncapped rule. |
| A grant without a cap "allows no token functions" | — (on-screen) | An uncapped rule can't move tokens. If your call must move USDC/tokens, add a **capped token rule** alongside the contract rule. |
| A new grant is refused with "12 rules; at most 11" | — (on-screen) | A Perch account holds **at most 11 rules**. One-rule-per-contract plus one-policy-per-vault hits this fast. Prune expired rules, or scope one rule to a factory/wildcard if available. |
| Classic (non-Soroban) tx fails to sign | — | A passkey account is a C-address contract: it can't source/sign a classic Stellar operation. Build a Soroban transaction or auth entry. |
| `signAuthEntry` rejects a valid-looking entry | — | The auth preimage's `signatureExpirationLedger` must be **≤ ~720 ledgers (~1h)** ahead and not past. Build auth entries with a short expiry. |

## Session rule notes (Perch)

- **One rule per contract.** A call that touches several contracts (e.g. a vault `buy` + a USDC `transfer`)
  needs one rule per contract in the call's authorization tree. Build the tree with the app key named as a
  CAP-0071 `Delegated` signer (`authorizeEntry` / delegate entries).
- **Rules are named by label (≤ 20 bytes) and replace in place.** Asking again for the same label renews or
  changes that rule — handy for renewal, easy to clobber by accident. Validate the 20-byte limit up front.
- **On the legacy path, the app key pays its own fees.** The hosted relayer doesn't decode `Delegated`
  entries, so the ed25519 session key (a classic G-address) needs funding. (Open question: are session-passkey
  `External` calls relayed? If so, that's another reason to prefer them.)
- **The session-passkey grant is a popup, not a full-page redirect.** It posts the result back without
  tearing down your page. The legacy path's full-page redirect — which drops the user back at the app origin,
  not the page they were on (so you must restore the URL + scroll yourself) — is one more reason to prefer
  session passkeys.
- **Grants always expire** (no "never"). Plan for re-granting; prefer the longest safe expiry.

## One-click multi-call actions

A single UI action that fans out into N sub-calls (e.g. minting N tokens, or a batch faucet) becomes **N+1
confirmations** for a passkey account. Where possible, move the fan-out into a single contract call your own
code authorizes, so the user approves once.
