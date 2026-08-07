# Spike: bounded onboarding-sweep capability

**Verdict: VALIDATED (2026-08-07).** A dedicated "sweep signer" on a Nido smart
account `C` can be given authority bounded to *exactly one action* — pull a
recorded onboarding account `G`'s balance into `C` via SAC
`transfer_from(spender = C, from = G, to = C, amount)` — and nothing else. The
bound is enforced by a tiny standalone OpenZeppelin `Policy` contract,
`PreauthSweepPolicy`; the core smart-account and factory contracts are
**untouched**. 8/8 authorization-scoping tests pass through the real
`stellar_accounts::do_check_auth → Policy::enforce` path, and an adversarial
review found no unconditional escape.

## Design: standalone policy (design A)

OZ's `Policy::enforce` receives the full `soroban_sdk::auth::Context`; for a
`Context::Contract(ContractContext { fn_name, args, .. })` this exposes the
invoked function name and the raw positional argument vector. That is exactly
enough to pin `transfer_from`'s `from`/`to` and to reject any other function.
The alternative (a native sweep method on the account) was rejected: OZ context
rules only scope a signer to a whole contract (`CallContract(addr)`), never to a
single function, so it would both expose the sweep key to every account method
*and* require the same fn-name policy anyway — plus it would change
`smart_account::WASM` (which the factory embeds and hashes), forcing a
coordinated redeploy. Design A adds one small, independently
deployable/upgradable contract and zero core changes.

The three-layer bound (each layer independently tested):

1. **Signer membership** — the sweep signer belongs to exactly one context rule;
   `do_check_auth` rejects it for any other rule (`UnauthorizedSigner`).
2. **Rule scope** — that rule is `CallContract(sac)`; `do_check_auth` rejects any
   other contract *before* the policy runs (`UnvalidatedContext`).
3. **Policy `enforce`** — panics unless the call is `transfer_from` with
   `from == recorded G` and `to == C`.

## What was proven (8/8, real `do_check_auth` path)

| Case | Expectation | Result |
|---|---|---|
| compile → wasm | builds against real pinned deps (soroban-sdk 27, stellar-accounts `ec749c3`) | pass — 11,904-byte wasm |
| **P** allowed | `transfer_from(C, G, C, amt)` authorizes; funds move G→C | pass (incl. amounts `{0, 1, 1e6, i128::MAX}`) |
| **N1** wrong dest | `transfer_from(C, G, ATTACKER, amt)` | rejected — `WrongDestination` (#5), with a correct `from`, so genuinely the `to` check |
| **N2** wrong source | `transfer_from(C, OTHER, C, amt)` | rejected — `WrongSource` (#4), with a correct `to`, so genuinely the `from` check |
| **N3a** other fn | `transfer(...)` / `approve(...)` same token | rejected — `NotTransferFrom` (#6); sweep key can neither self-spend nor grant an allowance |
| **N3b** other contract | `transfer_from` on a *different* token | rejected upstream — `UnvalidatedContext` (#3002), before `enforce` runs |
| bound completeness | sweep signer used against another rule | rejected — signer authorizes nothing outside its single rule |

Adversarial verifier verdict: **bounded authority SUPPORTED**; no unconditional
escape the sweep signer can execute on its own in the wired configuration.

## Carried forward to the audit-bound implementation

Residual items — none are logic breaks in the proven config; all are hardening
or off-chain/wiring responsibilities:

- **Add `args[0] == C` (spender) assertion** — defense-in-depth. Unreachable for
  a standard SAC (only the spender is `require_auth`'d, so `enforce` runs only
  when `C` is spender), but it hardens against a nonstandard token pinned at
  install. Trivial add.
- **Rule `valid_until` = the allowance expiry ledger** — so a stale sweep
  capability cannot outlive the allowance window. Prototype rule had no expiry.
- **Wiring invariants (must be enforced at deploy, not testable in a unit
  spike):** the sweep signer must be a member of *exactly one* rule and must
  never be added to the passkey/Default rule or any `CallContract(self)` rule;
  the policy's admin/upgrade authority (admin-sep) must be a governance key,
  **never** the sweep key (an admin can upgrade `enforce` away).
- **Keep the `NoSigner` guard** — load-bearing: with a policy attached OZ defers
  all signer-matching to `enforce`, so `authenticated_signers.is_empty()` is
  what forces a real sweep-key signature.
- **Amount is unbounded by the policy** (capped only by `C`'s allowance over
  `G`); funds still only ever land in `C`. "Full-balance-only" is an off-chain
  (relayer) choice, not a policy guarantee.
- **Per-token scope** — one rule per SAC (`CallContract(sac)`), each with its own
  recorded source.
- **Testnet leg skipped** — tests use `mock_all_auths` + `Signer::Delegated`, so
  signature cryptography and the account wasm's `__check_auth` are mocked. The
  scoping logic is proven; an on-chain run against real signatures + the
  production account wasm remains to be done.

Artifacts: `preauth-sweep-policy/` (`src/lib.rs`, `tests/sweep_scoping.rs`,
`tests/value_movement.rs`).
