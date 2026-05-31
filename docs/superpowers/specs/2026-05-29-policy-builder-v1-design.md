# Policy Builder v1 — Recovery & Session Keys

**Date:** 2026-05-29
**Status:** Approved, ready for implementation plan
**Sub-project:** #1 of the Policy Builder roadmap. Later sub-projects: #2 spending limits, #3 time delays, #4 plugin-slot registration.

## Why

The G2C smart account already supports OpenZeppelin's full context-rule machinery — scoped signers, attached policy contracts, expiry — but the wallet only ever installs the constructor-seeded default rule. Users can't take advantage of multisig recovery or scoped session keys, and the existing scoping tests in `crates/integration-tests/tests/it/smart_account_scoping.rs` exercise synthetic configurations that nothing in the product actually uses.

v1 closes both gaps by shipping two concrete, user-facing policies — social recovery and scoped session keys — plus the SDK and UI scaffolding that future policy types plug into without changing existing code. Tests are rewritten to drive the same builder helpers the UI uses, so the test suite documents real product flows rather than test-only plumbing.

## Goals

1. **Social recovery.** A user can designate trusted friends; any *M* of *N* of them, acting together, can rotate the account's primary passkey and adjust its context rules. They cannot move funds.
2. **Scoped session keys.** A user can delegate signing for a specific contract to a fresh device-local session key, optionally with an expiry. Once delegated, calls to that contract sign in-page without bouncing through the wallet UI.
3. **Composable abstraction.** The SDK and UI represent policies as a discriminated union of *PolicyBlocks*. Adding a new block kind in a later sub-project is a localized change — one new wrapper contract, one new SDK module, one new UI component — with no edits to existing blocks or page-shell code.
4. **Tests drive real builder paths.** Every integration test constructs transactions through the same SDK helpers the frontend calls. The synthetic `smart_account_scoping.rs` tests are deleted, their coverage subsumed by the new policy tests.

## Non-goals

- Spending limits, time delays, weighted multisig (deferred to sub-projects #2 and #3).
- Cross-device session-key import — v1 only generates session keys on the device that's setting them up.
- Spending caps on session keys (depends on the spending-limit policy in #2).
- Off-chain friend coordination — there is no backend that notifies friends of a pending recovery; coordination is via shared URL + local accumulation of signatures.
- Friend address-book sync across devices.
- Recovery without any working signer — friends must each still have a working passkey/account.

## Architecture

### Principle: modular policies, unified façade

Each policy is a focused `#![no_std]` Soroban contract deployed once and shared across all smart accounts (same lazy-singleton pattern as the WebAuthn verifier). Composition happens at the OpenZeppelin context-rule level via the rule's `policies: Vec<Address>`; a single rule can stack multiple policies, each of which must enforce. This matches the ERC-6900 modular-account pattern.

The "single composable system" the user perceives lives in the **SDK and UI**, not in one mega-contract. Trying to collapse policies into one contract (via an embedded DSL or switch-on-kind) sacrifices isolation, complicates audits, and provides no real benefit since context rules already compose at the rule level.

### Storage tiers

| Tier | Lives where | Authoritative? | Examples |
|---|---|---|---|
| A. Rule structure | Smart-account contract storage | Chain | Context rule id/type/scope/signers/`valid_until`; attached policy addresses |
| B. Policy state | Each policy contract's own storage, keyed by `(account, rule_id)` | Chain | Multisig threshold `M` |
| C. Display overlay | Browser localStorage | Local — no on-chain counterpart | Friend nicknames, rule labels, last-used timestamps |
| D. Private material | Browser IndexedDB / non-resident passkey | Local — cannot be on-chain | Session-key private bytes, credential IDs |

The SDK fetches A + B from the chain on every page load via cheap simulate-only RPCs (one `get_context_rules_count`, *N* `get_context_rule(i)`, plus one `get_threshold(account, rule_id)`-style call per attached policy). The UI joins those records with the C overlay before rendering. No persistent A/B cache in v1 — the chain is what's real and the screen always reflects it. A render-while-revalidating cache can be added later if first-paint becomes a problem.

## Contracts

### New: `contracts/multisig-policy`

A ~30-line `#![no_std]` wrapper implementing OZ's `Policy` trait. Every method delegates to `stellar_accounts::policies::simple_threshold::*`:

- `type AccountParams = SimpleThresholdAccountParams` (a `{ threshold: u32 }` struct from the OZ lib).
- `install` / `uninstall` / `can_enforce` / `enforce` all forward to the matching `simple_threshold::*` function.
- Exposes a read-only `get_threshold(account: Address, rule_id: u32) -> u32` for the SDK fetch path (re-exports `simple_threshold::get_threshold`).

The contract carries no logic of its own; M-of-N enforcement, storage layout, and error handling are the audited OZ library. Storage is keyed `(smart_account, rule_id)` so one shared deployment serves all accounts.

### Factory change

`contracts/factory` resolves canonical singleton contracts (the WebAuthn verifier, the multisig policy, and any future shared contracts) by **name lookup against the on-chain stellar-registry**, replacing the previous "hardcoded wasm hash + lazy-deploy" pattern.

The registry contract (the testnet "unverified" instance at `CAMLHKQHNZO2IOIBFUF5BGZ2V62BMS5QCWFFGRCB4NOB3G5OMDA7SGZN`) exposes `fetch_contract_id(name: String) -> Address`, which the factory calls via a small `RegistryClient` declared inline. Resolved addresses are cached in the factory's instance storage to amortize the cross-contract call.

```rust
const REGISTRY: &str = "CAMLHKQHNZO2IOIBFUF5BGZ2V62BMS5QCWFFGRCB4NOB3G5OMDA7SGZN";

mod registry {
    use soroban_sdk::*;
    #[contractclient(name = "RegistryClient")]
    pub trait RegistryInterface {
        fn fetch_contract_id(name: String) -> Address;
    }
}

impl Contract {
    fn resolve(env: &Env, name: &str) -> Address {
        let key = Symbol::new(env, name);
        if let Some(addr) = env.storage().instance().get::<_, Address>(&key) {
            return addr;
        }
        let client = registry::RegistryClient::new(env, &Address::from_str(env, REGISTRY));
        let addr = client.fetch_contract_id(&String::from_str(env, name));
        env.storage().instance().set(&key, &addr);
        addr
    }
}
```

`deploy_account_contract` calls `Self::resolve(env, "verifier")` to obtain the verifier address for the initial signer. Future policies plug in with one line: e.g. an SDK method that needs the multisig-policy address calls `Self::resolve(env, "multisig-policy")`. The factory carries no policy- or verifier-specific knowledge in its source — adding a new policy contract means publishing it via `stellar registry publish` and `stellar registry deploy --name <foo>` without touching the factory.

**Trade-offs.** The first call for any given name pays one cross-contract simulate-time hop; subsequent calls are pure-read from instance storage. The factory source no longer chases the hash of any dependency wasm, so adding policies stops requiring a factory rebuild + upgrade. The deployed factory holds the registry address as a compile-time constant; switching networks (or registries) means a factory wasm rebuild and `stellar registry upgrade`.

### No new contract for session keys

A session key is exactly `add_context_rule(CallContract(target), name, valid_until=Some(N), signers=[Signer::External(verifier, session_pubkey)], policies=Map::new())` — an empty policy map; the signer rule alone (N-of-N where N=1) is what gates the key. The existing smart account and verifier handle it without changes.

## SDK (`packages/passkey-sdk`)

### PolicyBlock model

```ts
type PolicyBlock =
  | { kind: 'multisig-recovery'; ruleId?: number; threshold: number;
      friends: Friend[]; label?: string; }
  | { kind: 'scoped-session-key'; ruleId?: number; targetContract: string;
      sessionPubkey: Uint8Array; credentialId: string;
      validUntil?: number; label?: string; };

interface Friend {
  address: string;        // resolved C-address or G-address (authoritative)
  inputAs: string;        // what the user typed (g2c name | C… | G…)
  nickname?: string;      // local overlay
}
```

### Per-block module interface

Every block kind exports the same shape, which is what makes the page rendering generic:

```ts
interface PolicyBlockModule<B extends PolicyBlock> {
  kind: B['kind'];
  buildInstall(account: Address, block: B, rpc: SorobanRpc): Promise<TxBuild>;
  buildRevoke(account: Address, ruleId: number): Promise<TxBuild>;
  fromChain(rule: ContextRule, policyState: PolicyState,
            overlay: LocalOverlay): B | null;
  summarize(block: B): string;
  defaultDraft(): B;
}
```

v1 ships two modules:
- `multisigRecovery.ts` (~120 lines)
- `scopedSessionKey.ts` (~140 lines)

### Shared helpers

- `resolveFriendInput(input)` — accepts `alice` (g2c name lookup via the existing name registry), `C…` (validate strkey), or `G…` (validate strkey); returns `{ address, kind: 'name'|'contract'|'account', hint }`.
- `loadPolicyBlocks(account, rpc)` — fetches all context rules and per-policy state, joins with local overlay, returns `PolicyBlock[]`. This is the SDK function the page and the integration tests both call.
- `generateSessionKey(account, target, validUntil)` — generates a P-256 keypair, stores the private bytes in IndexedDB keyed by `(account, target)`, returns the public key bytes ready for `add_context_rule`.

### Storage additions (`packages/passkey-sdk/src/storage.ts`)

Pure additions, no changes to existing entries:

- `saveFriendNickname(account, address, nickname)` / `loadFriendNicknames(account)`
- `saveSessionKeyMaterial(account, target, { privateKey, credentialId, label })` / `loadSessionKeyMaterial(account, target)` / `forgetSessionKeyMaterial(account, target)`
- `saveBlockLabel(account, ruleId, label)` / `loadBlockLabels(account)`

## Frontend

### `/security` page

New top-level Astro page: `packages/frontend/src/pages/security/index.astro`. Linked from the account page header. Layout: sectioned settings ("A" from the brainstorm mockup).

- **Account Recovery** — one card per `multisig-recovery` block. Empty state shows a "Set up recovery →" button that expands the inline form.
- **App Delegations** — one card per `scoped-session-key` block, grouped by target contract. Each card shows the dApp identifier, expiry countdown, and a "Revoke" action. Sticky `+ Delegate to a dApp` button.
- **Advanced** — the default rule rendered read-only. A "Manage signers" sub-link routes to a raw context-rule editor (power-user escape hatch, minimal UI).

Per-block rendering is delegated to small components (`<MultisigRecoveryCard.astro>`, `<SessionKeyCard.astro>`). The page enumerates `PolicyBlock[]` and dispatches by `kind`. Adding a new block kind = new component + new section, no page-shell edits.

### Recovery: set up flow

Inline form expanded under the Recovery section card (matches the approved mockup):

1. Friends list — each row is an input that accepts a g2c name, `C…`, or `G…`. Live resolution via `resolveFriendInput`; green ✓ on success. `+ Add another friend`, `×` to remove.
2. Threshold stepper — "Require [−][M][+] of N friends to approve" with a one-liner explaining the trade-off.
3. Optional rule name (defaults to "Recovery").
4. Plain-English summary box restating the effect, including the *cannot move funds* reassurance.
5. **Sign & save** — one primary-passkey signature. SDK builds a single tx invoking the smart account's `add_context_rule(context_type, name, valid_until, signers, policies)` where `policies: Map<Address, Val>` is `{ multisig_policy_addr => SimpleThresholdAccountParams { threshold: M } }`. The account internally invokes `multisig_policy.install(...)` with that param as a sub-call during rule creation.
6. On success, the friend nicknames the user entered are written to localStorage overlay.

**Editing an existing recovery rule.** In v1 there is no in-place "change M" or "change friends" affordance: the OZ smart-account API has `add_signer`/`remove_signer` but no `update_threshold`, and changing the friend set typically wants atomic threshold + signers updates anyway. The card's "Edit" action removes the existing rule (`remove_context_rule`) and reopens the inline form pre-populated from the old block; the user reviews and signs once to create the replacement. This trades one extra signature for a much simpler invariant ("the rule you see is the rule that's installed"). Native partial edits can land later if they prove worth the surface area.

### Recovery: `/recover/?account=<addr>` page

A separate route used by friends when the primary passkey is lost. Crude v1 UX, no backend:

1. Page loads the account's recovery context rule from the chain.
2. The recovering user (whoever holds the URL) describes the recovery: enters a new passkey (registers it via `navigator.credentials.create`).
3. The page builds a tx that calls the account's `add_signer(new_signer)` (and optionally `remove_signer(old_signer)` if the user wants the old key revoked, with a clear warning that this is irreversible).
4. Friends visit the URL, each signs the tx hash with their own account's passkey, and the page accumulates signatures in localStorage keyed by `(account, tx_hash)`. The signed signature blobs are exported as a copy-pasteable string so friends can send them out-of-band if they're not all using the same browser.
5. Once M signatures are accumulated, anyone can submit.

Not pretty, but functional. A real recovery coordinator with friend notifications is post-v1.

### Session keys: delegate flow

A user can delegate from two places: the `/security` page (proactive setup) or the sample dApp (just-in-time setup). Both call the same SDK builder.

From `/security`:

1. User clicks `+ Delegate to a dApp`, picks a target contract (paste address or pick from a small list of known dApps), picks a duration (24h / 7d / 30d / no expiry).
2. SDK generates a P-256 keypair, stores the private bytes in IndexedDB keyed by `(account, target)`, builds the `add_context_rule` tx.
3. Single primary-passkey signature submits it.

### Session keys: sample dApp (cross-origin)

To make the value prop visible and realistic, the existing `packages/frontend/src/pages/status-message/index.astro` page is **moved to a separate subdomain** — e.g., `status-message.<base>` via the existing subdomain routing — so its IndexedDB is origin-isolated from the wallet's.

**Just-in-time delegation handover.** When the dApp has no local session-key material for a user's account:

1. User clicks "Delegate this dApp" in the sample dApp.
2. dApp opens `https://<account>.<base>/security/delegate/?origin=<dapp_origin>&target=<contract>&duration=24h&return=<callback_url>` in a popup.
3. Wallet runs the normal scoped-session-key flow. After the `add_context_rule` tx confirms, instead of just closing, the wallet `postMessage`s the bundle to the popup opener:
   ```ts
   { type: 'g2c-session-key', payload: {
       account, target, ruleId, validUntil,
       verifier, sessionPubkey,
       privateKey, credentialId,  // the session key material
   }}
   ```
4. The dApp validates:
   - `event.origin === '<account>.<base>'` (the wallet subdomain it opened),
   - `event.source === popupWindow` (the exact window handle the dApp opened),
   - the payload's `account`, `target`, and original `origin` parameter match the request the dApp sent,

   then stores the material in its own IndexedDB. Any mismatch is rejected silently — defends against malicious tabs racing to `postMessage` into the listener.

The private key now lives in the dApp's origin. That is intentional — it *is* the delegated capability. The scope (`CallContract(target)`) and `valid_until` bound the blast radius.

**In-page signing.** Once delegated, the dApp signs all calls to `target` locally:

1. Build tx, simulate to extract the auth-entry hash.
2. Use the stored session-key private bytes to produce an in-page synthetic WebAuthn assertion. The TS implementation mirrors `build_contract_assertion` from `crates/integration-tests/src/lib.rs` — same shape, same RFC-6979 deterministic signing path.
3. Inject the signature via the existing `injectPasskeySignature` SDK helper and submit.

No popups, no biometric prompts, no redirects. That is the demo.

**Fallback.** If no session-key material is present (never delegated or `validUntil` past), the dApp falls back to the existing redirect-to-wallet sign flow at `<account>/?sign=…&callback=…`. Both code paths are exercised by tests.

**UI in the sample dApp:** a small "Delegated until <countdown>" status pill with a "Forget delegation" button (clears local material; user can re-delegate or fall back to redirect signing).

## Testing

### Rust integration tests

Replaces `crates/integration-tests/tests/it/smart_account_scoping.rs` (deleted) with:

- `multisig_recovery.rs` — end-to-end recovery:
  - Deploy account with primary passkey (deterministic key seed 1).
  - Build & invoke the same install tx the SDK produces; install a 2-of-3 recovery rule with three friend addresses (seeds 2/3/4).
  - Try `add_signer(new_key)` signed by only one friend → rejected (threshold not met).
  - Try the same call signed by two friends → succeeds; new signer is present in the default rule's signers vec.
  - Try a token-contract transfer signed by two friends → rejected (rule is scoped to `CallContract(self)`).
- `scoped_session_key.rs` — session-key path:
  - Install a scoped session-key rule for a target contract with `valid_until = N`.
  - Call target with the session key only → succeeds.
  - Call a different contract with the session key only → rejected.
  - Advance ledger past `valid_until` → call to target rejected.
  - Revoke the rule → call to target rejected even within `valid_until`.

Both files use the deterministic `test_key(seed)` helper introduced in PR #23, and both construct their transactions through Rust-side builder functions that share code with the TS SDK (via wasm-bindgen or a parallel hand-rolled equivalent — selected during planning). Whatever the share mechanism, the assertion is the same: tests build the same byte-level transactions the UI builds.

### TypeScript SDK tests (vitest)

- `multisigRecovery.test.ts` — `buildInstall` produces the expected ScVal arguments; `fromChain` parses a recorded chain payload back into the expected `PolicyBlock`.
- `scopedSessionKey.test.ts` — `generateSessionKey` produces material that round-trips through `injectPasskeySignature`; the synthetic in-page assertion verifies via the WebAuthn verifier (parity with the Rust path).
- `policyBlocks.test.ts` — `loadPolicyBlocks` against a fixture of mixed rule types returns a correctly tagged union.
- `resolveFriendInput.test.ts` — name / C-address / G-address inputs all resolve correctly; invalid inputs return a typed error.

### E2E tests (Playwright, extends `tests/e2e/`)

- `recovery.spec.ts` — virtual authenticator: create primary account, set up 2-of-3 recovery with three additional virtual accounts, simulate primary-passkey loss, collect two friend signatures at `/recover/?account=…`, submit the rotation tx, sign in with the new passkey.
- `session-key.spec.ts` — create account, delegate to the sample dApp via the popup handover, verify the dApp signs in-page on subsequent calls without redirect, revoke from `/security`, verify the dApp falls back to redirect-signing on the next call.

## Open questions

These are flagged for the planning phase; they do not block the design itself.

1. **Recovery coordination UX.** Whether to ship `/recover/?account=…` in this sub-project or split it into a follow-up. v1 includes it because shipping recovery *setup* without a recovery *use* leaves users with a sword-of-Damocles UX. If scope pressure appears during planning, splitting it out is the natural cut.
2. **Rust↔TS share mechanism for transaction shape.** Both layers must produce byte-identical add_context_rule transactions for the install paths. Options: wasm-bindgen of an SDK-shaped Rust crate, hand-rolled parallel implementations with cross-language fixtures, or pulling tx-building down into a small WASM module shared by both. Picked during plan-writing.
3. **Sample dApp identity.** Currently the existing status-message page is the demo. A purpose-built tiny game-like demo could land harder, but recycling status-message keeps scope tight and the before/after contrast (redirect vs in-page) is the literal demo.

## Out-of-scope reminder

See *Non-goals* above. The most likely scope-creep requests during planning are (a) "while we're here, let's also do spending limits" and (b) "let's also support importing a session key from another device." Both are explicitly out — the modular structure means they slot in cleanly later.
