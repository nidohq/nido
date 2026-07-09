# ZK Recovery M1 — `contracts/zk-recovery` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `contracts/zk-recovery` — the global Poseidon2 Merkle commitment pool, timelocked recovery state machine, and OZ `Policy` completion authority — plus a real-proof integration test proving the full initiate→timelock→complete lifecycle against the M0 circuit.

**Architecture:** One merged Soroban contract (pool + controller + policy). Enrollment inserts an account-bound leaf (`stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)`, wrapped on-chain). `initiate_recovery` recomputes `auth_hash` from canonical args via the Poseidon2 host function, cross-calls the M0 `zk-verifier`, and stores a timelocked pending record. Completion is a permissionless `add_context_rule` on the account, authorized by this contract's `Policy::enforce` (which must itself gate `fn_name`/`args` — OZ does not). Depends only on M0 artifacts, which are done and green.

**Tech Stack:** Rust, soroban-sdk 26.0.1, OZ stellar-accounts rev 637c53a, `soroban-poseidon` (poseidon2_hash), the vendored `nido-zk-verifier`, the M0 `circuits/zk_recovery` proof pipeline.

## Global Constraints

- **soroban-sdk** `= "26.0.1"` via `{ workspace = true }`; **stellar-accounts** rev `637c53a8c4928fd0c71d330bd866f482c3454578`; build target `wasm32v1-none`.
- **Field** BN254 Fr, `r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- **Domain constants** (identical to circuit `circuits/zk_recovery/src/main.nr:6-9`): `DOM_LEAF=0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a`, `DOM_BIND=0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81`, `DOM_NULL=0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2`, `DOM_AUTH=0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906`.
- **Poseidon2 host call** exactly as proven in M0: `soroban_poseidon::poseidon2_hash::<4, BnScalar>(env, &inputs)`, each input `U256::from_be_bytes(...).rem_euclid(&modulus)`, `modulus = <BnScalar as Field>::modulus(env)`. Parity across Noir/host is NATIVE (M0 Task 2). Reference: `contracts/vendor/`-adjacent pattern in `../zk/rs-soroban-ultrahonk/tornado_classic/contracts/src/mixer.rs:48-60`.
- **Tree depth 24**; zero-hash chain `zero[0]=0`, `zero[i+1]=P2_2(zero[i],zero[i])`.
- **Public inputs** to `verify_proof`: `[root, nullifier, auth_hash]`, 96-byte BE concat.
- **auth_hash** = `P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo, ctrl_hi, ctrl_lo, pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce, timelock_secs)`. `action`: 1=initiate, 2=cancel. `split(b32)` = BE 16-byte halves. `npass = sha256(network_passphrase)`. Addresses enter as raw 32-byte contract IDs.
- **Timelock defaults (user-ratified):** delay 14 days, controller floor 7 days, cancel cap 2/initiation, 24h cancel cooldown, completion window 30 days after maturity. Rate limit 3 initiations / 90-day rolling window.
- **M1 HARD REQUIREMENT (from M0 spike, spec §3.1):** OZ `get_validated_context_by_id` validates only the rule's target `contract`, NOT `fn_name`/`args` (storage.rs:289-301). `Policy::enforce` MUST inspect the `Context` and permit ONLY `add_context_rule` carrying exactly the pending new-signer set. Otherwise the zero-signer recovery rule authorizes any self-call.
- Spec: `docs/superpowers/specs/2026-07-02-zk-recovery-design.md` (§3 authoritative).

---

## File Structure

**New:**
- `contracts/zk-recovery/Cargo.toml` — crate `nido-zk-recovery`, cdylib+rlib.
- `contracts/zk-recovery/src/lib.rs` — module wiring + re-exports.
- `contracts/zk-recovery/src/types.rs` — `PendingRecovery`, `NullifierState`, `RecoveryKey`, `RecoveryConfig`, error enum, events.
- `contracts/zk-recovery/src/hash.rs` — `p2(env, &[U256]) -> BytesN<32>`, `dom(env, hex) -> U256`, `split_addr`, `compute_auth_hash`, `wrap_leaf`, `compute_nullifier_expected` (host-side, for recompute/tests).
- `contracts/zk-recovery/src/merkle.rs` — depth-24 frontier + zero-hash chain + root ring (adapt `mixer.rs`).
- `contracts/zk-recovery/src/pool.rs` — `insert` / `insert_for` / root views.
- `contracts/zk-recovery/src/controller.rs` — `initiate_recovery` / `cancel_recovery` / `burn_nullifier` / `get_pending`.
- `contracts/zk-recovery/src/policy.rs` — OZ `Policy` impl (`enforce`/`install`/`uninstall`) with fn_name/args gating.
- `contracts/zk-recovery/tests/` — unit tests per module.
- `crates/integration-tests/tests/it/zk_recovery_lifecycle.rs` — full real-proof lifecycle.
- `crates/integration-tests/src/zk_fixture.rs` — fixture harness: fixed witness, `register_at` deploy at pinned addresses, real proof loader.
- `circuits/zk_recovery/fixtures/lifecycle/` — the M1 proof fixture generated for the pinned test witness (vk shared with M0).

**Modified:**
- `Cargo.toml` (workspace members: add `contracts/zk-recovery`).
- `justfile` (`gen-zk-lifecycle-fixture`).

---

### Task 1: Fixture harness — pin a reproducible lifecycle witness

The whole lifecycle test hinges on a proof whose public inputs (`root`, `nullifier`, `auth_hash`) the deployed contract reproduces. Because `auth_hash` binds the account address, controller address, and network passphrase, the proof must be generated for the EXACT values the test deploys — solved by pinning both contract addresses via `env.register_at` and pinning the passphrase.

**Files:**
- Create: `crates/integration-tests/src/zk_fixture.rs`, `circuits/zk_recovery/fixtures/lifecycle/{prover_inputs.json,proof,public_inputs}`
- Modify: `crates/integration-tests/src/lib.rs` (add `pub mod zk_fixture;`), `justfile`

**Interfaces:**
- Produces: `pub struct LifecycleFixture { account: [u8;32], controller: [u8;32], network_passphrase: &'static str, new_pubkey: [u8;65], nonce: u64, timelock_secs: u32, secret_hex, leaf_stored: [u8;32], root: [u8;32], nullifier: [u8;32], auth_hash: [u8;32], proof: Vec<u8>, public_inputs: Vec<u8> }` and `pub fn lifecycle_fixture(env: &Env) -> LifecycleFixture` (loads the committed proof + constants).
- Consumes: M0 `circuits/zk_recovery` toolchain; `env.register_at`.

- [ ] **Step 1: Define the pinned witness constants**

Choose fixed values (document each): `account = [0x11;32]`, `controller = [0x22;32]`, `network_passphrase = "Test SDF Network ; September 2015"`, `nonce = 1`, `timelock_secs = 1_209_600` (14 days), a fixed 65-byte P-256 `new_pubkey` (prefix `0x04` + a valid on-curve point — reuse the point from `circuits/zk_recovery/src/tests.nr` or generate one with `p256`), a fixed `secret` (< r). Single-leaf tree: leaf index 0, siblings = zero-hash chain, bits all 0.

- [ ] **Step 2: Generate the proof for this witness**

Add `just gen-zk-lifecycle-fixture`: a script that computes `inner=P2_2(DOM_LEAF,secret)`, `stored=P2_4(DOM_BIND, split(account), inner)`, `root=compute_root(stored, zeros, 0-bits)`, `nullifier=P2_4(DOM_NULL, split(account), secret)`, `auth_hash=P2_15(DOM_AUTH, 1, split(account), split(sha256(passphrase)), split(controller), 0x04, split(pk.x), split(pk.y), nonce, timelock_secs)` (via a small Rust or Noir helper reusing the M0 `_poseidon_vectors` generator), writes `Prover.toml`, runs `just build-circuits`-style `nargo execute` + `bb prove` (reuse `circuits/zk_recovery/scripts/gen_artifacts.sh` with these inputs), and copies `proof`+`public_inputs` into `circuits/zk_recovery/fixtures/lifecycle/`. The VK is the SAME as M0 (`circuits/zk_recovery/target/vk`).

Run: `cd /home/willem/c/s/nido && just gen-zk-lifecycle-fixture`
Expected: writes a `proof` (~7KB) and `public_inputs` (96B) whose first 32 bytes equal `root`, next 32 `nullifier`, last 32 `auth_hash`.

- [ ] **Step 3: Write the harness loader + an address-pinning assertion test**

`zk_fixture.rs` loads the committed fixture and exposes the constants. Add a test that `register_at([0x11;32])`-style deploys a throwaway contract and asserts the resolved `Address`'s contract-id round-trips to `[0x11;32]` (proving `register_at` pins the id the fixture's `auth_hash` binds).

Run: `cargo test -p nido-integration-tests --test it fixture_addresses_pin -- --nocapture`
Expected: PASS — deployed account/controller contract-ids equal the fixture's `account`/`controller` bytes.

- [ ] **Step 4: Verify the fixture proof verifies under the M0 verifier**

Add a test registering `nido-zk-verifier` (M0 wasm) with the M0 vk, calling `verify_proof(fixture.public_inputs, fixture.proof)` under `reset_unlimited` — asserts `Ok`. This proves the regenerated lifecycle proof is valid before any controller logic exists.

Run: `cargo test -p nido-integration-tests --test it fixture_proof_verifies -- --nocapture`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/integration-tests/src/zk_fixture.rs crates/integration-tests/src/lib.rs \
        circuits/zk_recovery/fixtures/lifecycle justfile
git commit -m "test(zk): M1 lifecycle fixture harness (pinned witness + real proof)"
```

---

### Task 2: Crate scaffold, config, types, and host-hash module

**Files:**
- Create: `contracts/zk-recovery/Cargo.toml`, `src/lib.rs`, `src/types.rs`, `src/hash.rs`
- Modify: `Cargo.toml` (workspace members)

**Interfaces:**
- Produces: `dom(env,&str)->U256`, `p2(env,&[U256])->BytesN<32>`, `split_addr(env,&Address)->(U256,U256)`, `wrap_leaf(env, acct:&Address, inner:&BytesN<32>)->BytesN<32>`, `compute_auth_hash(env, action:u32, account:&Address, network_passphrase:&Bytes, controller:&Address, pubkey:&BytesN<65>, nonce:u64, timelock_secs:u32)->BytesN<32>`, `compute_nullifier(env, account, secret)` (test-only). Types `RecoveryConfig{factory,verifier,delay_secs,completion_window_secs,max_cancels,timelock_floor_secs}`, `PendingRecovery`, `NullifierState`, `RecoveryKey`, `RecoveryError`, events (spec §3.3).
- Consumes: `soroban_poseidon`, Global Constraints hash rules.

- [ ] **Step 1: Write `hash.rs` with a failing auth_hash parity test**

Implement `p2`/`dom`/`split_addr`/`wrap_leaf`/`compute_auth_hash` per Global Constraints. Test: for the Task-1 fixture's pinned inputs (account `[0x11;32]` via `register_at`, controller `[0x22;32]`, the fixed pubkey/nonce/timelock/passphrase), assert `compute_auth_hash(...) == fixture.auth_hash` and `wrap_leaf(account, inner) == fixture.leaf_stored` and `compute_nullifier(account, secret) == fixture.nullifier`.

```rust
#[test]
fn auth_hash_matches_fixture() {
    let env = Env::default();
    let fx = lifecycle_fixture(&env);
    let account = env.register_at(&addr_from(&env, &fx.account), /*stub*/ (), ());
    let controller = addr_from(&env, &fx.controller);
    let pass = Bytes::from_slice(&env, fx.network_passphrase.as_bytes());
    let pk = BytesN::from_array(&env, &fx.new_pubkey);
    let got = compute_auth_hash(&env, 1, &account, &pass, &controller, &pk, fx.nonce, fx.timelock_secs);
    assert_eq!(got, BytesN::from_array(&env, &fx.auth_hash));
}
```

- [ ] **Step 2: Run, expect fail** — `cargo test -p nido-zk-recovery auth_hash_matches_fixture` → FAIL (not implemented).

- [ ] **Step 3: Implement `hash.rs` + `types.rs` + crate scaffold** until it compiles and the parity test passes. `compute_auth_hash` assembles the 15 `U256` inputs in the exact order; `split_addr` extracts the 32-byte contract-id (via `Address::to_xdr` → ScAddress::Contract bytes, or `env`-provided id) and BE-splits; `npass` via `env.crypto().sha256(&network_passphrase)`.

- [ ] **Step 4: Run to green** — the parity test passes (host auth_hash == the circuit's, proving the contract will recompute a matching public input).

- [ ] **Step 5: Commit** — `feat(zk): zk-recovery crate scaffold + host hash/auth_hash parity`.

---

### Task 3: Merkle frontier + root ring

**Files:** Create `contracts/zk-recovery/src/merkle.rs`; test in-module.
**Interfaces:** Produces `insert_leaf(env, stored:&BytesN<32>)->u32` (updates frontier, pushes new root to 128-slot ring, extend_ttl(max)), `current_root(env)->BytesN<32>`, `is_known_root(env,&BytesN<32>)->bool`, `next_index(env)->u32`. Consumes `hash::p2`.

- [ ] **Step 1: Failing frontier-vs-reference test.** Insert 8 known `stored` leaves; assert `current_root` equals a reference incremental-Merkle root computed in-test (adapt `mixer.rs` `frontier_root_from_leaves`), and that each intermediate root is retained by `is_known_root`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** depth-24 frontier + zero-hash chain (single persistent `Vec` frontier, `RingHead`+`RootRing` 128), following `mixer.rs:62-72,109-160`.
- [ ] **Step 4: Green.** Also assert a root evicted after 128 inserts is no longer `is_known_root`.
- [ ] **Step 5: Commit** — `feat(zk): depth-24 frontier + 128-root ring`.

---

### Task 4: Pool inserts with on-chain account binding

**Files:** Create `contracts/zk-recovery/src/pool.rs`; test in-module.
**Interfaces:** Produces `insert(env, commitment:BytesN<32>)->u32` (requires `config.factory` invoker auth; wraps `stored=wrap_leaf(factory-supplied account?)`— NO: genesis binds the just-created account, see below), `insert_for(env, account:Address, commitment:BytesN<32>)->u32` (`account.require_auth()`; `stored=wrap_leaf(account, commitment)`), rejecting `commitment` (as U256) `>= r`. Consumes `merkle::insert_leaf`, `hash::wrap_leaf`.

Note on genesis: the factory calls `insert(commitment)` but the leaf must bind the NEW account. Since the factory creates the account in the same tx and knows its address, `insert` takes the account too: `insert(env, account: Address, commitment)` with `config.factory.require_auth()`. Document that only the factory may assert an arbitrary account binding (it is the genesis authority); `insert_for` requires the account's own auth.

- [ ] **Step 1: Failing test** — `insert_for(account, commitment)` then assert `current_root` changed and the stored leaf equals `wrap_leaf(account, commitment)`; a second test asserts `commitment >= r` panics `NonCanonicalCommitment`; a third asserts `insert` requires factory auth (unauthorized caller panics).
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** both entry points with the wrap + canonical check + auth.
- [ ] **Step 4: Green** (use `mock_all_auths` / `require_auth` assertions as in `multisig_recovery.rs`).
- [ ] **Step 5: Commit** — `feat(zk): account-bound pool inserts (factory + migration)`.

---

### Task 5: `initiate_recovery` (proof verify + timelock pending)

**Files:** Create `contracts/zk-recovery/src/controller.rs`; test in-module + a slice in the lifecycle test.
**Interfaces:** Produces `initiate_recovery(env, account:Address, new_pubkey:BytesN<65>, nonce:u64, timelock_secs:u32, root:BytesN<32>, nullifier:BytesN<32>, proof:Bytes)->u64` (returns `executable_after`). Consumes `hash::compute_auth_hash`, `merkle::is_known_root`, `verify_proof` cross-call (config.verifier), `types::PendingRecovery`.

- [ ] **Step 1: Failing happy-path test (uses Task-1 fixture).** Deploy verifier(`register_at`? no — verifier address stored in config), pool/controller at the fixture's `controller` address, insert the fixture's `stored` leaf so `root` is known, then `initiate_recovery(account=fixture.account, new_pubkey, nonce=1, timelock_secs, root=fixture.root, nullifier=fixture.nullifier, proof=fixture.proof)` → assert returns `now + delay`, `get_pending(account).is_some()`, and a `RecoveryInitiated` event emitted. Because the fixture's `auth_hash` was generated for these exact addresses/values, the contract's recompute matches the proof's public input.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** the ordered checks (spec §3.3): no live pending; `is_known_root(root)`; nullifier not Reserved/Spent; `nonce == stored_nonce+1` then bump; `timelock_secs >= floor` and `== config-derived`; rate limit 3/90d; `compute_auth_hash(...)`; assemble `[root,nullifier,auth_hash]` and cross-call `verify_proof`; reserve nullifier; store pending; emit event.
- [ ] **Step 4: Green** for happy path, plus negative tests: unknown root → `UnknownRoot`; reused nullifier → `NullifierUsed`; wrong nonce → error; `timelock_secs < floor` → error; tampered `auth_hash` input (pass a different `new_pubkey`) → `verify_proof` fails (recomputed auth_hash ≠ proof's).
- [ ] **Step 5: Commit** — `feat(zk): initiate_recovery with proof verify + timelock`.

---

### Task 6: `cancel_recovery` + `burn_nullifier`

**Files:** Extend `controller.rs`; tests in-module.
**Interfaces:** Produces `cancel_recovery(env, account, nonce, root, nullifier, proof)` (`account.require_auth()` + fresh `action=2` proof + cap 2 + 24h cooldown; releases reservation), `burn_nullifier(env, account, nullifier)` (`account.require_auth()`; marks Spent), `get_pending`, `cancels_used`.

- [ ] **Step 1: Failing tests.** After an initiate, `cancel_recovery` (with a second fixture proof for `action=2`, or reuse a cancel-specific fixture) clears pending and leaves the nullifier un-Spent (re-initiate allowed). Cap test: a 3rd cancel → `CancelCapReached`. Cooldown test: two cancels < 24h apart → `CooldownActive`. `burn_nullifier` marks Spent so a later initiate with that nullifier → `NullifierUsed`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** (Generate an `action=2` cancel fixture via the Task-1 harness with `action=2`, pk/timelock zeroed per spec §2.4.)
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** — `feat(zk): cancel_recovery (capped, cooldown) + burn_nullifier`.

---

### Task 7: `Policy::enforce` completion — with fn_name/args gating (HARD REQUIREMENT)

**Files:** Create `contracts/zk-recovery/src/policy.rs`; the completion slice of the lifecycle test.
**Interfaces:** Produces OZ `Policy` impl: `enforce(env, context, authenticated_signers, context_rule, smart_account)`, `install`, `uninstall`. Consumes `get_pending`, `types`.

- [ ] **Step 1: Failing completion test (full lifecycle, real proof).** Using Task-1 fixture + Task-5 initiate, advance ledger past `executable_after` (`env.ledger().set(...)`), then invoke `account.add_context_rule(Default, "recovered", None, [Signer::External(webauthn_verifier, fixture.new_pubkey)], {})` with `AuthPayload{signers:{}, context_rule_ids:[recovery_rule_id]}` (the exact shape proven in `zk_completion_spike.rs`). Assert `do_check_auth` → `Ok`, the pending is consumed, nullifier now `Spent`, and `RecoveryCompleted` emitted.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement `enforce`.** It MUST: `smart_account.require_auth()`; assert `context_rule.id == Installed(smart_account)`; a pending exists with `now >= executable_after && now < expires_at`; **decode `context` and require it is `Context::Contract` with `fn_name == "add_context_rule"` AND `args` whose new-signers vector equals `pending.new_pubkey`'s `Signer::External` set** (the M1 hard requirement — reject otherwise with `ContextMismatch`); then consume: nullifier → Spent, delete pending, emit `RecoveryCompleted`. `install` records `Installed(account)=rule.id` (assert zero signers + `CallContract(self)`); `uninstall` clears it.
- [ ] **Step 4: Green,** plus two security negatives: (a) a `context` for `remove_signer` (not `add_context_rule`) → `enforce` panics `ContextMismatch` (proves the fn_name/args gate); (b) completion before `executable_after` → `TimelockNotElapsed`.
- [ ] **Step 5: Commit** — `feat(zk): Policy completion with fn_name/args gating + full lifecycle`.

---

### Task 8: Deploy shape + live testnet cost confirmation

**Files:** Create `crates/zk-bench/tests/initiate_cost.rs` (or extend); Modify `DEPLOYED.md`, `justfile`.
**Interfaces:** Consumes the full contract + fixture.

- [ ] **Step 1: Failing real-metering test** measuring a full `initiate_recovery` (insert + recompute + verify_proof + reserve + store) under real metering, asserting ≤ 350M CPU (leaves margin under the 400M `tx_max_instructions`). This is the deferred M0 measurement (spec §2.6).
- [ ] **Step 2: Run** — record the real number.
- [ ] **Step 3: If ≤350M,** wire `just bench-zk-initiate`; document the number in `DEPLOYED.md` (pending real deploy addresses). If `> 350M`, STOP and report (aggregation/split decision).
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** — `test(zk): full initiate_recovery cost gate + deploy notes`.

---

## Self-Review

- **Spec coverage:** §2.2 leaf wrap → T4; §2.3 nullifier lifecycle → T5/T6; §2.4 auth_hash → T2; §3.1 completion + fn_name/args → T7; §3.3 interface/events/errors → T2/T5/T6; §3.4 storage/rent → T3/T4 (extend_ttl); budget confirmation → T8. Guard (account-code) and factory changes are M2, not here — correctly out of scope.
- **Placeholder scan:** the cancel `action=2` fixture (T6) and the exact `split_addr` contract-id extraction (T2 step 3) are the two spots needing care — both named with the concrete approach, no "TBD".
- **Type consistency:** `compute_auth_hash` signature, `[root,nullifier,auth_hash]` order, `PendingRecovery`/`NullifierState`/`RecoveryKey` names, `initiate_recovery`/`cancel_recovery` signatures consistent across T2/T5/T6/T7 and the spec §3.3.
- **Fixture coupling** (the main risk) is isolated in T1 and reused by every proof-consuming task via `register_at` address pinning — the one architectural decision that makes real-proof integration tests reproducible.

## Carry-forward

- Early in M1, add vendored-verifier drift detection (M0 final-review finding b): a CI checksum of `contracts/vendor/` against the upstream rev.
- Pin floating deps (`soroban-poseidon` branch=main, Noir `poseidon` v0.2.0) to commit SHAs.
