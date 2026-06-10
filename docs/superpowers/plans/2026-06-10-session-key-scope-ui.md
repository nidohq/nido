# Session-Key Scope UI Implementation Plan (Deliverable 4, PR 2 — #72/#75)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delegations can carry a spending limit (amount + rolling period) alongside contract scope and time window; the Security page shows full scope and revokes for real; the status-message dApp proves it by tipping authors through a limited session key, gaslessly.

**Architecture:** A new thin policy contract (`contracts/spending-limit-policy`, exact mirror of `contracts/multisig-policy`) wraps OZ's `policies::spending_limit` (pinned rev 637c53a: `SpendingLimitAccountParams { spending_limit: i128 stroops, period_ledgers: u32 }`, rolling window, meters SAC `transfer` only, `CallContract` contexts only). The delegate page passes `policies: Map{ policyAddr → ScVal(params) }` into the existing `add_context_rule` bindings call. The dApp tips via a **direct `SAC.transfer(smartAccount → author, amount)`** (auth context = `CallContract(SAC)`, so scope + metering both apply), signs with the session passkey, and submits `{func, auth}` to the relayer.

**Tech Stack:** soroban-sdk 26 / stellar-accounts 637c53a (no_std), stellar-cli deploy + registry, generated TS bindings, Astro frontend + vitest, status-message dApp (React), relayer protocol from PR 1.

**Spec:** `docs/superpowers/specs/2026-06-10-session-key-scope-ui-design.md`. Branch `feat/72-session-key-scope-ui` (worktree `/home/willem/c/s/g2c/.claude/worktrees/session-key-scope-ui`), stacked on PR 1. NOTE: the harness shell may reset cwd to another worktree between commands — `cd /home/willem/c/s/g2c/.claude/worktrees/session-key-scope-ui` at the start of every Bash block.

**Verified facts (do not re-derive):**
- Workspace `members = ["crates/integration-tests", "contracts/*"]` — a new contract dir is auto-included. `just build-contracts` uses stellar-scaffold + wasm-opt; smart-account wasm must build before factory (recipe handles ordering).
- OZ lib import style (mirror multisig): `use stellar_accounts::policies::spending_limit::{self, SpendingLimitAccountParams};` Functions: `install(e, &params, &context_rule, &smart_account)`, `enforce(e, &context, &authenticated_signers, &context_rule, &smart_account)`, `set_spending_limit(e, i128, &context_rule, &smart_account)`, `uninstall(e, &context_rule, &smart_account)`. The lib does NOT export a getter — the wrapper adds one reading its own storage.
- Bindings: `add_context_rule({context_type, name, valid_until, signers, policies: Map<string, any>})`; `remove_context_rule({context_rule_id: u32})`. `just bindings <name>` regenerates (runs `scripts/fix-bindings.sh`). Passing an `xdr.ScVal` instance in the `any` slot passes through encoding untouched.
- `#[contracttype]` named-struct ScVal encoding = `scvMap` with symbol keys in lexicographic order: `period_ledgers` < `spending_limit` ✓.
- Frontend: `fetchRegistryAddress(name)` (policyChainFetch.ts) resolves via the unverified registry; `revokeSessionKey(account, ruleId, target)` ALREADY EXISTS in `sessionKeyActions.ts:48-65` — only `SessionKeyCard.ts`'s button is a placeholder alert. `ChainRule.policies: string[]` (policy contract addresses).
- Delegate page (security/delegate/index.astro): `DURATIONS = {'24h':17280,'7d':120960,'30d':518400,'none':null}`; calls `client.add_context_rule({... policies: new Map()})` then signs via `signAndSubmit`.
- dApp: `startDelegation(opts)` builds the wallet URL with `origin/target/pubkey/duration/return`; `nidoSign.ts:signUpdateMessageInPage` is the session-signing template (loadSessionKeyMaterial → build+simulate → getAuthEntry → findRuleForPubkey → computeAuthDigest → signWithSessionPasskey → injectPasskeySignature → self-submit with own fee payer). XLM SAC id = `Asset.native().contractId(networkPassphrase)`.
- Integration tests: `deploy_multisig_policy(env) = env.register(MULTISIG_POLICY_WASM, ())`; `multisig_install_map(env, addr, threshold)` builds `Map<Address, Val>` via `params.into_val(env)`; helpers `test_key`, `external_signer`, `build_contract_assertion`, `compute_auth_digest`; SAC in tests via `env.register_stellar_asset_contract_v2(admin)` (testutils; verify exact sdk-26 name with `cargo doc`/source if it differs).
- Deploy/registry CLI (DEPLOYED.md): `stellar contract deploy --wasm target/wasm32v1-none/contract/g2c_spending_limit_policy.wasm --source-account <alias> --network testnet`; then registry `update_contract_address --contract_name spending-limit-policy --new_address <C…>` on `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S`. Check `stellar keys ls` for an alias; if none usable, STOP and ask the operator (Willem) — registering may also need `register_contract_name` if the name is new (try update first; on "name not found" error use the registry's register/add entry point — inspect `stellar contract invoke --id <registry> -- --help`).

## File structure

```
contracts/spending-limit-policy/{Cargo.toml, src/lib.rs, src/contract.rs}   # NEW
crates/integration-tests/src/lib.rs                                        # +SPENDING_LIMIT_POLICY_WASM, deploy_, install_map helpers
crates/integration-tests/tests/it/spending_limit_policy.rs                  # NEW test file (+ mod in it/main.rs or lib glob — mirror existing)
packages/contract-bindings/spending-limit-policy/                           # generated
packages/passkey-sdk/src/relayer.ts (+test)                                 # lifted pure client from frontend
packages/frontend/src/lib/relayerClient.ts                                  # becomes re-export shim + env defaults
packages/frontend/src/lib/spendingLimitParams.ts (+test)                    # period maps + ScVal encoder
packages/frontend/src/pages/security/delegate/index.astro                   # limit controls + policies wiring
packages/frontend/src/components/SessionKeyCard.ts                          # scope display + real revoke
packages/passkey-sdk/src/policyBlocks/scopedSessionKey.ts                   # summarize() gains limit text (block gains limit fields)
packages/frontend/src/lib/policyChainFetch.ts                               # read limit params via wrapper view fn
examples/status-message-dapp/src/lib/{delegationHandover.ts, nidoSign.ts}   # limit params; generalized session call + relayer submit
examples/status-message-dapp/src/components/StatusMessage.tsx               # Enable tipping + Tip buttons
DEPLOYED.md                                                                 # new policy row
```

---

### Task 1: `contracts/spending-limit-policy`

**Files:** Create the three files below, byte-mirroring the multisig template.

- [ ] **Step 1.1** `contracts/spending-limit-policy/Cargo.toml` — copy `contracts/multisig-policy/Cargo.toml` verbatim, change only `name = "g2c-spending-limit-policy"`. Check whether multisig's Cargo.toml has `[package.metadata.stellar] contract = true` (scaffold build ordering) — replicate whatever it has exactly.
- [ ] **Step 1.2** `contracts/spending-limit-policy/src/lib.rs`:
```rust
#![no_std]
#![allow(dead_code)]

mod contract;

pub use contract::SpendingLimitPolicy;
```
- [ ] **Step 1.3** `contracts/spending-limit-policy/src/contract.rs`:
```rust
//! Spending-limit policy contract — thin wrapper around OpenZeppelin's
//! `spending_limit` library. Stateless per-deployment; per-`(account,
//! rule_id)` limit + rolling spending window live in this contract's
//! persistent storage as managed by the library. Meters SAC `transfer`
//! calls within `CallContract` contexts only.

use soroban_sdk::auth::Context;
use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use stellar_accounts::policies::spending_limit::{self, SpendingLimitAccountParams};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, Signer};

#[contract]
pub struct SpendingLimitPolicy;

#[contractimpl]
impl SpendingLimitPolicy {
    /// Read the installed params for a given account + rule. Returns None if
    /// not installed. (The OZ lib exposes no getter; read its storage key.)
    pub fn get_spending_limit(
        e: &Env,
        context_rule_id: u32,
        smart_account: Address,
    ) -> Option<SpendingLimitAccountParams> {
        // Inspect the lib source at the pinned rev for the exact storage key +
        // data types: SpendingLimitStorageKey::AccountContext(Address, u32)
        // -> SpendingLimitData (holds params + entries). If SpendingLimitData
        // or the key enum is not pub, fall back to tracking install params in
        // THIS contract's own storage inside install() below (a parallel map
        // keyed the same way) — report which path you took.
        spending_limit_params_for(e, context_rule_id, &smart_account)
    }
}

#[contractimpl]
impl Policy for SpendingLimitPolicy {
    type AccountParams = SpendingLimitAccountParams;

    fn enforce(
        e: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        spending_limit::enforce(e, &context, &authenticated_signers, &context_rule, &smart_account);
    }

    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        spending_limit::install(e, &install_params, &context_rule, &smart_account);
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        spending_limit::uninstall(e, &context_rule, &smart_account);
    }
}
```
(`spending_limit_params_for` is yours to write per the comment — read `/home/willem/.cargo/git/checkouts/stellar-contracts-23b9f8e80f2c4738/637c53a/packages/accounts/src/policies/spending_limit.rs` first; prefer reading the lib's storage; the parallel-map fallback is acceptable and must then also be cleaned in `uninstall`.)
- [ ] **Step 1.4** Build: `cd <worktree> && just build-contracts` → expect `g2c_spending_limit_policy.wasm` optimized in `target/wasm32v1-none/contract/`. Then `just test` (workspace must stay green).
- [ ] **Step 1.5** Commit: `feat(contracts): spending-limit policy wrapper over OZ spending_limit (#72)`.

### Task 2: Integration tests (TDD — write before relying on the contract)

**Files:** Modify `crates/integration-tests/src/lib.rs`; create `crates/integration-tests/tests/it/spending_limit_policy.rs` (register the module exactly how `scoped_session_key` is registered — check `tests/it/` for a `main.rs`/mod pattern and mirror).

- [ ] **Step 2.1** Add to `src/lib.rs` (mirror the multisig constants/helpers — find `MULTISIG_POLICY_WASM` and copy its import mechanism for the new wasm):
```rust
pub fn deploy_spending_limit_policy(env: &soroban_sdk::Env) -> soroban_sdk::Address {
    env.register(SPENDING_LIMIT_POLICY_WASM, ())
}

pub fn spending_limit_install_map(
    env: &soroban_sdk::Env,
    policy_addr: &soroban_sdk::Address,
    spending_limit: i128,
    period_ledgers: u32,
) -> soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> {
    use soroban_sdk::IntoVal;
    let params = SpendingLimitAccountParams { spending_limit, period_ledgers };
    let mut m: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> =
        soroban_sdk::Map::new(env);
    m.set(policy_addr.clone(), params.into_val(env));
    m
}
```
- [ ] **Step 2.2** Write `tests/it/spending_limit_policy.rs` with three tests, structured exactly like `scoped_session_key.rs` (same helper usage: `deploy_smart_account`, `external_signer`/session key setup, `build_contract_assertion`, `compute_auth_digest`, `do_check_auth` invocation with a `CallContract` context):
  1. `within_limit_transfer_authorizes`: SAC via `env.register_stellar_asset_contract_v2(admin)` (verify exact sdk-26 testutils name); session rule scoped `CallContract(sac_addr)` with `spending_limit_install_map(env, &policy, 5_0000000, 17280)`; build a `transfer` context for 1 XLM (context fn symbol `transfer`, args `[from, to, amount: i128]` — copy the Context construction style from `scoped_session_key.rs`'s target-contract contexts); `do_check_auth` succeeds.
  2. `over_limit_rejected`: same rule; first a 4 XLM transfer succeeds, then a second 2 XLM transfer (cumulative 6 > 5) panics (`std::panic::catch_unwind`, mirroring test 2 of scoped_session_key).
  3. `window_roll_allows_again`: limit 5 XLM/100 ledgers; spend 5; advance `env.ledger().set_sequence_number(current + 101)`; spending 5 again succeeds.
- [ ] **Step 2.3** Run: `cargo test -p g2c-integration-tests spending_limit` → 3 pass (first run will fail until Step 1's wasm exists — Tasks 1 and 2 land together; run after both). Full `just test` green.
- [ ] **Step 2.4** Commit: `test(integration): spending-limit policy enforcement (#72)`.

### Task 3: Bindings + testnet deploy + registry (operator-assisted)

- [ ] **Step 3.1** `just bindings spending-limit-policy` → `packages/contract-bindings/spending-limit-policy/` generated; `npm install` at repo root so the workspace links it; commit the package (mirror how other bindings packages are committed — check git status of an existing one first).
- [ ] **Step 3.2** Deploy: `stellar keys ls` — pick the alias used for prior deploys (DEPLOYED.md says `<alias>`; if unclear, STOP and ask Willem which alias/key to use). `stellar contract deploy --wasm target/wasm32v1-none/contract/g2c_spending_limit_policy.wasm --source-account <alias> --network testnet` → record C-address.
- [ ] **Step 3.3** Register: `stellar contract invoke --id CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S --source-account <alias> --network testnet -- update_contract_address --contract_name spending-limit-policy --new_address <C…>`. If the registry rejects an unknown name, inspect `-- --help` for the add/register entry point and use it. Verify: frontend-style fetch (`stellar contract invoke … -- fetch_contract_id --contract_name spending-limit-policy` or the registry's getter — check its spec).
- [ ] **Step 3.4** Add a DEPLOYED.md row (address + "registered as unverified/spending-limit-policy" + soroban-sdk 26/OZ rev note). Commit: `feat(contracts): deploy + register spending-limit-policy on testnet (#72)`.

### Task 4: Lift the relayer client into `@g2c/passkey-sdk`

**Files:** Create `packages/passkey-sdk/src/relayer.ts` + `relayer.test.ts` (move from `packages/frontend/src/lib/relayerClient{,.test}.ts`); modify frontend `relayerClient.ts` to a shim.

- [ ] **Step 4.1** Move the PURE client (everything except the `RELAYER_URL` import/defaults) into `packages/passkey-sdk/src/relayer.ts`: exports `RelayerStatus`, `RelayerTxResponse`, `RelayerError`, `submitSorobanTransaction(args, baseUrl)`, `getRelayerTransaction(id, baseUrl)`, `waitForConfirmation(id, baseUrl, opts?)`, `extractFuncAndAuth(tx)` — `baseUrl` becomes REQUIRED (no env default in the sdk). Export from the sdk's index the way other modules are exported (check `packages/passkey-sdk/src/index.ts` or package exports map — mirror).
- [ ] **Step 4.2** Frontend `packages/frontend/src/lib/relayerClient.ts` becomes:
```ts
import { RELAYER_URL } from "./network";
export {
  RelayerError,
  type RelayerStatus,
  type RelayerTxResponse,
  extractFuncAndAuth,
} from "@g2c/passkey-sdk";
import {
  submitSorobanTransaction as sdkSubmit,
  getRelayerTransaction as sdkGet,
  waitForConfirmation as sdkWait,
} from "@g2c/passkey-sdk";

export function relayerEnabled(): boolean {
  return RELAYER_URL.length > 0;
}
export const submitSorobanTransaction = (
  args: { func: string; auth: string[]; skipWait?: boolean },
  baseUrl: string = RELAYER_URL,
) => sdkSubmit(args, baseUrl);
export const getRelayerTransaction = (id: string, baseUrl: string = RELAYER_URL) => sdkGet(id, baseUrl);
export const waitForConfirmation = (
  id: string,
  baseUrl: string = RELAYER_URL,
  opts?: { intervalMs?: number; maxAttempts?: number },
) => sdkWait(id, baseUrl, opts);
```
(Adjust to the sdk's actual export style; keep `primaryPasskeySigner.ts` imports compiling unchanged.)
- [ ] **Step 4.3** Move the 12 client tests to the sdk package (its test runner — check how passkey-sdk runs tests: package.json scripts; if it has none, keep tests in frontend importing from the sdk). All vitest suites green: `cd packages/frontend && npx vitest run` (94+ tests) and the sdk's runner if separate. `npx astro build` green.
- [ ] **Step 4.4** Commit: `refactor(sdk): lift relayer client into passkey-sdk for dApp reuse (#72)`.

### Task 5: Spending-limit params module + delegate approval UI

**Files:** Create `packages/frontend/src/lib/spendingLimitParams.ts` + `.test.ts`; modify `packages/frontend/src/pages/security/delegate/index.astro`.

- [ ] **Step 5.1 (TDD)** `spendingLimitParams.test.ts`: encode `{xlm: "5", period: "day"}` → ScVal map with symbol keys in order `["period_ledgers","spending_limit"]`, u32 17280, i128 50_000_000; periods week→120960, 30d→518400; rejects ≤0, >9_999_999 XLM, malformed decimals; `stroopsFromXlm("1.2345678")` → 12345678n (7 dp max, reject more).
- [ ] **Step 5.2** Implement:
```ts
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

export type LimitPeriod = "day" | "week" | "30d";
export const PERIOD_LEDGERS: Record<LimitPeriod, number> = { day: 17280, week: 120960, "30d": 518400 };
export const PERIOD_LABEL: Record<LimitPeriod, string> = { day: "per day", week: "per week", "30d": "per 30 days" };

export function stroopsFromXlm(xlm: string): bigint { /* parse decimal, ≤7 dp, > 0 */ }

/** ScVal for OZ SpendingLimitAccountParams — #[contracttype] named structs
 *  encode as scvMap with symbol keys in lexicographic order. */
export function spendingLimitParamsScVal(stroops: bigint, periodLedgers: number): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("period_ledgers"), val: xdr.ScVal.scvU32(periodLedgers) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("spending_limit"), val: nativeToScVal(stroops, { type: "i128" }) }),
  ]);
}
```
- [ ] **Step 5.3** Delegate page: parse optional `limit` (XLM decimal string) + `limit_period` (`day|week|30d`, default `day`); render an editable row in the existing approval card (amount `<input>`, period `<select>`, a "No limit" checkbox checked when `limit` absent — match the page's existing markup/classes); validation errors block approve. On approve with a limit: `const policyAddr = await fetchRegistryAddress('spending-limit-policy');` and `policies: new Map([[policyAddr, spendingLimitParamsScVal(stroops, PERIOD_LEDGERS[period])]])` in the existing `add_context_rule` call (everything else unchanged). Registry failure → show blocking error, never install limitless silently.
- [ ] **Step 5.4** `npx vitest run` + `npx astro check` (2-error baseline) + `npx astro build` green. Commit: `feat(frontend): spending-limit controls in delegate approval (#72)`.

### Task 6: Security card — scope display + real revoke

**Files:** Modify `packages/frontend/src/components/SessionKeyCard.ts`, `packages/passkey-sdk/src/policyBlocks/scopedSessionKey.ts` (block fields + summarize), `packages/frontend/src/lib/policyChainFetch.ts` (limit read).

- [ ] **Step 6.1** Limit read: in policyChainFetch.ts add `fetchSpendingLimit(account, rule)` — if `rule.policies` contains the registry-resolved spending-limit-policy address, simulate-call the wrapper's `get_spending_limit({context_rule_id, smart_account})` via its generated bindings client (read-only, same pattern as `fetchPolicyState`); return `{stroops: bigint, periodLedgers: number} | null`.
- [ ] **Step 6.2** `ScopedSessionKeyBlock` gains optional `limitStroops?: bigint; limitPeriodLedgers?: number;` populated by the loader (find `loadPolicyBlocks`/the scopedSessionKey module's `fromRule` in passkey-sdk and thread it); `summarize()` appends `· limit X XLM per day/week/30 days` when present (map 17280/120960/518400 → labels; other values → "per N ledgers").
- [ ] **Step 6.3** SessionKeyCard: render target contract short-code linking to stellar.expert contract page, expiry as before, the limit line when present, and REPLACE the placeholder click handler with:
```ts
import { revokeSessionKey } from '../lib/sessionKeyActions';
// in the handler (keep the confirm()):
btn.disabled = true;
try {
  await revokeSessionKey(block.account, block.ruleId, block.targetContract);
  div.remove();
  toast({ msg: 'Session key revoked', icon: 'check' });
} catch (err) {
  btn.disabled = false;
  toast(`Couldn't revoke: ${(err as Error).message}`);
}
```
(Check `revokeSessionKey`'s exact signature + whether `block.account` exists on the block — recon says `revokeSessionKey(account, ruleId, target)`; the card may need `account` passed in from security/index.astro — thread it as a render arg if absent. Check the toast import used elsewhere in that page bundle; keep `is:global` style constraints in mind — new classes go into security/index.astro's `:global` block.)
- [ ] **Step 6.4** vitest + astro check/build green. Commit: `feat(frontend): session-key scope display + working revoke (#72)`.

### Task 7: dApp tip feature

**Files:** Modify `examples/status-message-dapp/src/lib/delegationHandover.ts`, `nidoSign.ts`, `src/components/StatusMessage.tsx`, dApp env util.

- [ ] **Step 7.1** `StartDelegationOptions` gains `limit?: string; limitPeriod?: "day" | "week" | "30d";` → appended as `limit`/`limit_period` URL params in `startDelegation` when present.
- [ ] **Step 7.2** Generalize session signing: extract from `signUpdateMessageInPage` a helper `signSessionCallInPage({account, targetContract, buildTx, approvalTitle})` (same flow: material → build+simulate → auth entry → rule lookup → digest → passkey sheet → inject). Add `tipAuthorInPage({account, author, xlm})`: builds a DIRECT `SAC.transfer(from=account, to=author, amount)` invoke via stellar-sdk (`Operation.invokeContractFunction({contract: Asset.native().contractId(networkPassphrase), function: "transfer", args: [accountAddr.toScVal(), authorAddr.toScVal(), nativeToScVal(stroops, {type:"i128"})]})`), recording-simulates (ghost or fee-payer source — mirror nidoSign's current sim source), then signs the auth entry with the session passkey scoped to the SAC.
- [ ] **Step 7.3** Submission via relayer: import the sdk relayer client; dApp env gains `PUBLIC_RELAYER_URL` (default `https://nido.fly.dev` for testnet builds — follow the dApp's env util pattern); `extractFuncAndAuth` + `submitSorobanTransaction` + `waitForConfirmation`; NO fee-payer keypair, NO friendbot in the tip path. Keep `signUpdateMessageInPage`'s existing self-submission untouched (separate concern; converting it is optional follow-up).
- [ ] **Step 7.4** UI in StatusMessage.tsx: next to a displayed author, "Tip 1 XLM" button; if no session material for the SAC target → "Enable tipping" button calling `startDelegation({targetContract: <SAC id>, duration: "7d", limit: "5", limitPeriod: "day", label: "Tipping"})`; success shows the explorer link; relayer/enforce rejection shows the error message verbatim-ish ("Tip rejected: …"). Match existing component style/state patterns.
- [ ] **Step 7.5** dApp builds + tests: `cd examples/status-message-dapp && npm run build` (check its package.json scripts; memory: build workspace pkgs first, tsconfig.app.json is the real config, local build crashes on allowHttp unless TESTNET env — see `status-message-dapp-local-build` memory). Commit: `feat(example): tip-the-author via limited session key, gasless (#72)`.

### Task 8: Proof + wrap-up

- [ ] **Step 8.1** Testnet proof (operator-assisted; relayer live at https://nido.fly.dev): drive the dApp flow (local dev server or preview) — enable tipping (5 XLM/day), tip 1 XLM → record hash; decode on-chain (fee-bump, channel source, session-key credential on the SAC transfer — adapt the PR-1 decode snippet); attempt a 6 XLM tip → record the rejection (relayer error code/simulation failure naming the policy). If UI-driving is impractical, a `scripts/tip-proof.mjs` mirroring relayer-proof.mjs with a synthetic P-256 session key is acceptable — but the rule must be installed through the REAL delegate page at least once.
- [ ] **Step 8.2** Full verification: `just build-contracts && just test`, frontend vitest + astro build, dApp build. Update PR #75 description (tick checklist, proof artifacts, screenshots if available). Remind: retarget PR #75 base to main before #73 merges.
- [ ] **Step 8.3** Final whole-branch review subagent (diff `feat/72-relayer-gas-abstraction..HEAD`), fix findings, mark ready for review after Willem's pass.

## Self-review notes

- Spec coverage: contract (T1), tests (T2), deploy/registry (T3), sdk lift (T4), delegate UI + params encoding (T5), security display/revoke (T6), dApp tip incl. relayer submission (T7), proofs (T8). Out-of-scope items from spec respected (no set_spending_limit UI, no recovery-card wiring).
- Known open verifications for implementers (explicitly assigned, not placeholders): OZ storage-key visibility for the getter (T1 — fallback specified), sdk-26 SAC testutils method name (T2), registry register-vs-update entry point (T3), passkey-sdk export/test conventions (T4), block/account threading for revoke (T6), dApp env util shape (T7).
- Type consistency: `spendingLimitParamsScVal(stroops, periodLedgers)` used in T5 matches its T5 definition; `revokeSessionKey(account, ruleId, target)` matches recon signature; `get_spending_limit({context_rule_id, smart_account})` matches the T1 wrapper.
