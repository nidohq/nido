# ZK Recovery M2 — Smart-Account Guard + Factory Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Do NOT work on `main` — this executes on `zk-recovery-m0` (or a branch off it).

**Goal:** Wire the M1 `contracts/zk-recovery` controller into every Nido account: the smart-account constructor installs the zero-signer recovery rule and enforces an in-code guard (block signer/rule mutations while a recovery is pending; protect the recovery rule behind an announce-then-execute delay), and the factory atomically inserts a genesis leaf + installs the controller on `create_account`. Plus fold in the pre-mainnet hardening (dep pinning, `--oracle_hash keccak` enforcement, vendored-verifier drift detection).

**Architecture:** The guard is smart-account WASM code, not a removable policy (a removable guard is stripped by a stolen passkey first). Every account gets, at construction, a uniform `ContextRule{CallContract(self), signers:[], policies:{controller}}` (so rule presence leaks nothing about enrollment) and stores the controller address + rule id. Mutating entry points cross-call `controller.get_pending(self)` and panic while a recovery is pending; the recovery rule itself can only be removed via a 7-day announce-then-execute. The factory passes the controller to the constructor and calls `pool.insert(account, commitment)` in the same tx; the deterministic C-address is unchanged (it derives from deployer+salt only).

**Tech Stack:** Rust, soroban-sdk 26.0.1, OZ stellar-accounts rev 637c53a, the M1 `nido-zk-recovery` contract, the factory's Stellar Registry resolution.

## Global Constraints

- **Branch:** `zk-recovery-m0` (or a branch off it). NEVER commit on `main`.
- **soroban-sdk** `= "26.0.1"` (`{workspace=true}`); **stellar-accounts** rev `637c53a8c4928fd0c71d330bd866f482c3454578`; target `wasm32v1-none`.
- **Deterministic C-address invariant:** `deployer(salt).deployed_address()` depends ONLY on (deployer, salt) — NOT constructor args or wasm hash. `factory::get_c_address` MUST keep returning the same address after the constructor-signature change. Any task that breaks this is wrong.
- **Guard rule (spec §3.2):** the recovery `ContextRule` is `CallContract(self)`, zero signers, one policy = the controller. While `controller.get_pending(self).is_some()`: `remove_signer`, `remove_context_rule` (any rule), `remove_policy`, `update_context_rule_valid_until` MUST panic (`RecoveryPendingBlocked`). Removal of the recovery rule specifically: announce-then-execute with a **7-day (604800s)** delay when no recovery is pending; hard-blocked while pending. `add_context_rule` stays allowed (completion needs it).
- **Timelock defaults (already in the controller config, user-ratified):** delay 14d, floor 7d, cancel cap 2, 24h cooldown, completion window 30d.
- **Completion mechanic (from M1, proven):** completion is `add_context_rule(Default, "recovered", None, [Signer::External(webauthn_verifier, new_pubkey)], {})` with `AuthPayload{signers:{}, context_rule_ids:[recovery_rule_id]}`; the controller's `enforce` gates it. The guard must NOT block this `add_context_rule`.
- **Legacy accounts** (already-deployed old wasm, no upgrade fn): cannot get the hard guard. Migration installs the recovery rule via stock `add_context_rule` + `insert_for` (visible, degraded mode: no pending-block guard). Documented, not silently equated with new accounts.
- **Enrollment invisibility:** the factory inserts a leaf for EVERY account (real commitment or a deterministic dummy `sha256("nido-zk-dummy"||salt) mod r`), and installs the recovery rule uniformly. Byte-identical tx shape across enrolled/dummy.
- **Domain field order** r = `21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- Spec §3 authoritative: `docs/superpowers/specs/2026-07-02-zk-recovery-design.md`. Controller interface: `contracts/zk-recovery/src/{controller.rs,pool.rs}`.

## File Structure

**Modified:**
- `contracts/smart-account/src/contract.rs` — constructor gains `recovery_controller`; installs recovery rule; stores controller+rule-id; guard overrides on the mutating entry points; announce-then-execute removal; `initiate_recovery_rule_removal`/`execute_recovery_rule_removal` entry points.
- `contracts/factory/src/contract.rs` — `create_account_v2(salt,key,commitment)`; legacy `create_account` derives dummy; `deploy_account_contract` passes controller + calls `pool.insert`; resolve `"zk-recovery"`.
- `circuits/zk_recovery/scripts/gen_artifacts.sh` — enforce `--oracle_hash keccak`.
- `contracts/zk-recovery/Cargo.toml`, root `Cargo.toml` / `Cargo.lock` — pin `soroban-poseidon` + Noir `poseidon` to commit SHAs.
- `DEPLOYED.md`, `justfile`.

**New:**
- `crates/integration-tests/tests/it/zk_recovery_e2e.rs` — full genesis-to-completion through real factory + account + controller.
- `scripts/check-vendor-drift.sh` — sha256 drift check for `contracts/vendor/`.

---

### Task 1: Pin floating dependencies (hardening, do first — de-risks everything downstream)

A silent Poseidon2 change in `soroban-poseidon` (tracked on `main`) or the Noir `poseidon` tag would break circuit↔contract hash parity catastrophically. Pin both to the commit currently in `Cargo.lock` / the working circuit.

**Files:** `contracts/zk-recovery/Cargo.toml`, `Cargo.lock`, `circuits/zk_recovery/Nargo.toml`, `crates/integration-tests/Cargo.toml`

- [ ] **Step 1: Find the resolved commits.** `grep -A3 'rs-soroban-poseidon' Cargo.lock` → note the `source = "git+...#<SHA>"`. For Noir: the `poseidon` dep is `tag = "v0.2.0"` (tags are immutable-by-convention but pin the exact rev if the registry supports it; otherwise keep the tag and document).
- [ ] **Step 2: Pin.** Change every `soroban-poseidon = { git=..., branch = "main" }` to `{ git=..., rev = "<SHA-from-lock>" }`. Run `cargo update -p soroban-poseidon --precise <SHA>` is a no-op if already there; confirm `Cargo.lock` unchanged in the resolved rev.
- [ ] **Step 3: Rebuild + full test.** `cargo build --workspace && cargo test -p nido-zk-recovery` → all pass (parity intact). This proves the pin resolves to the same working Poseidon2.
- [ ] **Step 4: Commit** — `chore(zk): pin soroban-poseidon + Noir poseidon to exact revs`.

---

### Task 2: Enforce `--oracle_hash keccak` + vendored-verifier drift detection (hardening)

**Files:** `circuits/zk_recovery/scripts/gen_artifacts.sh`, `circuits/zk_recovery/scripts/gen_lifecycle*_fixture.sh`, `scripts/check-vendor-drift.sh` (new), `justfile`

- [ ] **Step 1: Audit the bb invocations.** grep the gen scripts for `bb prove`/`bb write_vk`. The M1 fixtures already verify on-chain, which requires keccak-oracle proofs — so the flag is effectively already in force via `--verifier_target evm-no-zk`. Add an explicit `--oracle_hash keccak` to every `bb prove`/`bb write_vk` and re-run one fixture generation to confirm the artifacts are byte-identical (proving the flag was already the effective default; if they DIFFER, the on-chain verifier would have been mismatched — investigate before proceeding).
- [ ] **Step 2: Write the drift check.** `scripts/check-vendor-drift.sh`: compute `sha256` over `contracts/vendor/ultrahonk-soroban-verifier/src/**` and compare against a committed `contracts/vendor/CHECKSUMS.sha256`; exit non-zero on mismatch. Generate the checksum file.
- [ ] **Step 3: Wire `just check-vendor-drift`** and run it → passes against the current vendored tree.
- [ ] **Step 4: Commit** — `chore(zk): enforce keccak oracle in circuit build + vendor drift check`.

---

### Task 3: Smart-account constructor installs the recovery rule

**Files:** `contracts/smart-account/src/contract.rs`; test in-crate.

**Interfaces:**
- Produces: `__constructor(e, signers: Vec<Signer>, policies: Map<Address,Val>, recovery_controller: Address)`. After the Default rule, installs `ContextRule{CallContract(self), name:"zk-recovery", signers:[], policies:{recovery_controller: ZkRecoveryInstallParams{version:1}}}`; stores `RECOVERY_RULE_ID: u32` and `RECOVERY_CONTROLLER: Address` in instance storage. The install triggers the controller's `Policy::install` (which records the rule id on its side).
- Consumes: OZ `add_context_rule`, the controller's `ZkRecoveryInstallParams` (from `nido-zk-recovery` — import or reconstruct the `Val` install param).

- [ ] **Step 1: Failing test.** Deploy the smart account with a webauthn signer + a controller address (register a real `nido-zk-recovery` controller, or a stub implementing `Policy::install`). Assert after construction: exactly two context rules exist; the second is `CallContract(self)`, zero signers, one policy == the controller; and `RECOVERY_RULE_ID`/`RECOVERY_CONTROLLER` are stored and readable via new view methods `recovery_rule_id()->u32` / `recovery_controller()->Address`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** the constructor change + the two views. The install param: build `Map<Address,Val>` with `controller -> ZkRecoveryInstallParams{version:1}.into_val(e)` (mirror `add_multisig_recovery`'s policies-map construction at contract.rs:74-76). Reuse the M1 controller's install-param type.
- [ ] **Step 4: Green.** Also assert the deterministic address is unaffected: a `get_c_address`-style deployer address computed before vs after construction is unchanged (constructor args don't affect it).
- [ ] **Step 5: Commit** — `feat(zk): smart-account installs zero-signer recovery rule at construction`.

---

### Task 4: The guard — block mutations while pending + protect the recovery rule

**Files:** `contracts/smart-account/src/contract.rs`; tests in-crate + e2e.

**Interfaces:**
- Produces: guard behavior on `remove_signer`/`remove_context_rule`/`remove_policy`/`update_context_rule_valid_until`; new entry points `initiate_recovery_rule_removal()` and `execute_recovery_rule_removal()` (announce-then-execute, 7d). New errors `RecoveryPendingBlocked`, `RecoveryRuleProtected`, `RemovalNotAnnounced`, `RemovalDelayNotElapsed`.
- Consumes: `RECOVERY_CONTROLLER`/`RECOVERY_RULE_ID` (Task 3); a `ZkRecoveryClient::get_pending(account)->Option<...>` cross-call (generate/​import the controller client; `get_pending` is a view).

- [ ] **Step 1: Failing guard tests.**
  - `remove_signer` (and each of the four mutating ops) while `controller.get_pending(self).is_some()` → panics `RecoveryPendingBlocked`. (Set up: real controller with a pending recovery for this account — reuse the M1 fixture harness to initiate a real pending, or a stub controller whose `get_pending` returns `Some`.)
  - With NO pending, `remove_signer` on a NON-recovery rule succeeds (guard doesn't over-block).
  - `remove_context_rule(RECOVERY_RULE_ID)` directly → panics `RecoveryRuleProtected` (must go through announce-then-execute).
  - `add_context_rule` (the completion path) is NOT blocked by the guard even with a pending — it must stay allowed.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** In each of the four mutating trait methods, before delegating: `if ZkRecoveryClient::new(e, &recovery_controller(e)).get_pending(&e.current_contract_address()).is_some() { panic RecoveryPendingBlocked }`. In `remove_context_rule`: additionally `if id == recovery_rule_id(e) { panic RecoveryRuleProtected }`. Add `initiate_recovery_rule_removal` (require self-auth; store `RECOVERY_REMOVAL_AT = now + 604800`; reject if a recovery is pending) and `execute_recovery_rule_removal` (require self-auth; require announced + `now >= RECOVERY_REMOVAL_AT` + no pending; then actually remove the recovery rule + clear the stored ids). Note: the guard cross-call to `get_pending` adds one contract call to each mutating op — acceptable (a view, ~1M CPU; measure).
- [ ] **Step 4: Green** (all guard tests). Include a test that the full announce→wait 7d→execute path removes the rule, and that executing without announcing → `RemovalNotAnnounced`, and executing early → `RemovalDelayNotElapsed`.
- [ ] **Step 5: Commit** — `feat(zk): in-account guard (pending-block + announce-then-execute rule removal)`.

---

### Task 5: Factory `create_account_v2` + genesis leaf insert + legacy dummy

**Files:** `contracts/factory/src/contract.rs`; test in-crate.

**Interfaces:**
- Produces: `create_account_v2(e, salt, key: BytesN<65>, commitment: BytesN<32>) -> Address` (deploys account with controller, inserts real leaf); `create_account(e, salt, key)` kept, now derives `commitment = sha256("nido-zk-dummy" || salt) mod r` and routes through the same path (uniform). Both resolve `"zk-recovery"` from the registry and call `pool.insert(account, commitment)`.
- Consumes: `deploy_account_contract` (modified to pass controller + call insert), the controller's `insert(account, commitment)` (M1 pool, factory-authed).

- [ ] **Step 1: Failing test.** `create_account_v2(salt, key, commitment)` → returns the deterministic C-address (== `get_c_address(salt)`); the deployed account has the recovery rule installed with the resolved controller; the pool's `next_index` incremented and `current_root` changed; the inserted leaf == `wrap_leaf(account, commitment)`. Also: `create_account(salt, key)` (legacy) → same shape but with the deterministic dummy commitment.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** `deploy_account_contract` resolves `"zk-recovery"` (cached like `"verifier"`), passes `controller` as the 3rd constructor arg to `deploy_v2(hash, (&signers, &policies, &controller))`, then `ZkRecoveryClient::new(e,&controller).insert(&account, &commitment)` (factory is the pool's configured `factory` authority — the factory calls it, satisfying `config.factory.require_auth()` via invoker auth). `create_account` computes the dummy commitment. Add a `create_account_v2` entry point. **Verify `get_c_address` still matches** the deployed address after the constructor-arg change.
- [ ] **Step 4: Green.** Assert byte-shape uniformity: the ops emitted by `create_account` (dummy) and `create_account_v2` (real) differ only in the commitment bytes.
- [ ] **Step 5: Commit** — `feat(zk): factory create_account_v2 with genesis leaf + controller install`.

---

### Task 6: Migration path for existing accounts

**Files:** `contracts/smart-account/src/contract.rs` (a typed `enroll_zk_recovery` wrapper) OR document SDK-orchestrated stock calls; test in-crate.

**Interfaces:**
- Produces: `enroll_zk_recovery(e, recovery_controller: Address)` on the smart account — self-authed; installs the recovery rule via `add_context_rule` (stock) and stores the ids; then the SDK separately calls `pool.insert_for(account, commitment)`. Degraded mode: an already-deployed OLD-wasm account has no guard, but the completion mechanic (stock `add_context_rule`) still works.
- Consumes: Task 3's rule-install logic (factor it into a shared helper reused by both the constructor and `enroll_zk_recovery`).

- [ ] **Step 1: Failing test.** On a smart account deployed WITHOUT the recovery rule (simulate a legacy account, or a v2 account that skipped), call `enroll_zk_recovery(controller)` → the recovery rule now exists + ids stored; then `pool.insert_for(account, commitment)` succeeds (account-authed, visible); a subsequent real-proof `initiate_recovery` + completion works. (Reuse the M1 fixture; the account address must be the fixture's `[0x11;32]` for the proof to bind — deploy via `register_at`.)
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `enroll_zk_recovery` (shared install helper). Document the degraded-guard caveat in the doc comment.
- [ ] **Step 4: Green.**
- [ ] **Step 5: Commit** — `feat(zk): migration enroll_zk_recovery for existing accounts`.

---

### Task 7: Full end-to-end integration test (genesis → recovery → rotation)

**Files:** `crates/integration-tests/tests/it/zk_recovery_e2e.rs` (new); `crates/integration-tests/tests/it/main.rs`.

**Interfaces:** Consumes the whole stack: factory, smart-account, `nido-zk-recovery` controller, `nido-zk-verifier`, the fixture harness.

- [ ] **Step 1: Failing e2e test.** Deploy the controller at `[0x22;32]` + verifier; deploy an account at the fixture's `[0x11;32]` via the factory path (or `register_at` with the recovery rule installed pointing at the controller); genesis-insert the fixture leaf; assert `current_root == fixture.root`; `initiate_recovery` (real proof) → pending; advance ledger past `executable_after`; complete via the zero-signer `add_context_rule` → assert the account's Default rule now carries the new passkey signer, the old is removable, pending consumed, nullifier Spent. Then assert the guard: during the pending window, `remove_signer` on the account panics `RecoveryPendingBlocked`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Wire up** (mostly composition of prior tasks; add any missing glue).
- [ ] **Step 4: Green.** Add a dummy-leaf account variant proving enrollment status is indistinguishable at the tx-op level.
- [ ] **Step 5: Commit** — `test(zk): full genesis-to-recovery e2e + guard enforcement`.

---

### Task 8: DEPLOYED.md + cost re-measure

**Files:** `DEPLOYED.md`, `crates/integration-tests/tests/it/initiate_cost.rs` (extend), `justfile`.

- [ ] **Step 1:** Add a real-metering test for a guard-gated mutating op (`remove_signer` with the `get_pending` cross-call) → assert the guard cross-call overhead is < 10M CPU (the SDF policy-cross-call target). Record the number.
- [ ] **Step 2:** Update `DEPLOYED.md` with the guard-overhead number, the `create_account_v2` shape, and the M2 contract addresses (placeholders until deploy).
- [ ] **Step 3: Commit** — `test(zk): guard cross-call cost + M2 deploy notes`.

---

## Self-Review

- **Spec coverage:** §3.1 constructor rule install → T3; §3.2 guard (pending-block + announce-then-execute) → T4; §3.3 factory create_account_v2 + dummy → T5; migration → T6; enrollment invisibility (uniform rule + leaf) → T5/T7; hardening carry-forwards → T1/T2. The controller itself is M1 (done).
- **Placeholder scan:** the guard cross-call cost (T4/T8) and the exact `ZkRecoveryInstallParams` `Val` reconstruction (T3) are the two care-points — both named concretely, no "TBD".
- **Type consistency:** `recovery_controller`/`RECOVERY_RULE_ID`/`RECOVERY_CONTROLLER`, `create_account_v2(salt,key,commitment)`, `get_pending`, `wrap_leaf`, `enroll_zk_recovery` consistent across T3–T7 and the M1 controller interface.
- **Deterministic-address invariant** is called out in Global Constraints and re-asserted in T3 and T5 — the one thing the constructor-signature change could silently break.

## Carry-forward to M3

- Circuit-regen CI job (needs the keccak enforcement from T2).
- SDK `zkRecovery/` + browser prover + pool indexer + relayer (the client half).
- Vendored-verifier + circuit audit before mainnet.
