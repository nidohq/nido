# Security Invariants

The properties that must always hold, each with the test/bench evidence that
guards it. This is the checklist an auditor uses to confirm the system behaves as
claimed, and the regression net the team must keep green. IDs are stable
references (used from [THREAT_MODEL.md](./THREAT_MODEL.md)).

Test paths are under `crates/integration-tests/tests/it/` unless noted. Run the
whole set with `just test`; cost gates with `just bench-zk`, `just bench-zk-initiate`,
`just bench-zk-guard`.

## Factory & deployment

- **F1 — Deterministic address.** `create_account`/`create_account_v2` deploy at the
  address `get_c_address(salt)` predicts; the recovery-controller argument does not
  affect the address. Evidence: factory unit tests (`contracts/factory/src/contract.rs`).
- **F2 — Atomic deploy + genesis insert.** An account is never created without its
  genesis Merkle leaf, nor a leaf without its account; any insert failure reverts the
  whole tx. Evidence: `create_account_reverts_atomically_when_pool_factory_mismatched`.
- **F3 — Enrollment indistinguishability.** Real vs. deterministic-dummy commitments are
  indistinguishable on-chain, keeping the anonymity set uniform. Evidence:
  `dummy_and_real_enrollment_are_indistinguishable_on_chain`,
  `create_account_and_create_account_v2_are_uniform_except_commitment`.
- **F4 — Cross-crate param shape parity.** `ZkRecoveryInstallParams` (smart-account copy)
  round-trips against the real controller struct. Evidence: `drift.rs`.
- **F5 (planned, B2) — Registry pinning.** Factory reverts (`RegistryMismatch`) if the
  registry resolves `verifier`/`zk-recovery` to anything other than the admin-pinned
  address. _Test to be added with B2._

## Smart account & guard

- **S1 — Auth on every mutation.** `add/remove_context_rule`, `remove_signer`,
  `remove_policy`, `update_context_rule_valid_until`, `enroll_zk_recovery`, and `execute`
  all require the account's own auth. Evidence: `smart_account_auth.rs`,
  `smart_account_setup.rs`.
- **S2 — Recovery guard blocks eviction while pending.** With a live pending recovery,
  signer/rule/policy-mutating ops are blocked (`RecoveryPendingBlocked`) via the
  controller `has_pending` cross-call. Evidence: `zk_recovery_guard.rs`, smart-account
  unit tests. The cross-call is **fail-secure**: any controller error traps and blocks
  the mutation (documented at `contract.rs::has_live_pending`).
- **S3 — Recovery rule protection + announce-then-execute.** The recovery rule cannot be
  silently removed/modified (`RecoveryRuleProtected`); removal requires the
  announce-then-execute delay (`RECOVERY_REMOVAL_DELAY_SECS`). Evidence: smart-account
  unit tests.
- **S4 — No double-enroll.** `enroll_zk_recovery` panics `RecoveryAlreadyEnrolled` if a
  rule is already installed. Evidence: `zk_recovery_migration.rs`.

## ZK recovery state machine

- **R1 — Proof binds all mutation parameters.** `initiate/cancel/burn` recompute
  `auth_hash` from the call's own `(action, account, network_passphrase, controller,
  new_pubkey, nonce, timelock)` and verify the proof against it — a caller cannot swap any
  field without invalidating the proof. Evidence: tampered-field tests in
  `zk_recovery_lifecycle.rs`.
- **R2 — Nullifier no double-spend.** A nullifier moves Reserved→(released|Spent); Spent is
  permanent; check-then-set is atomic within one invocation. Evidence:
  `zk_recovery_lifecycle.rs`, `zk_recovery_completion.rs`. _Add explicit double-spend
  negative test (F-task)._
- **R3 — Monotonic nonce replay protection.** Every proof requires `nonce == stored+1`;
  nonce is bound into `auth_hash`. Evidence: `zk_recovery_lifecycle.rs`.
- **R4 — Timelock cannot be bypassed.** `initiate` requires `timelock_secs == cfg.delay_secs`
  exactly; completion blocked until `now >= executable_after`. Evidence:
  `zk_recovery_lifecycle.rs`, `zk_recovery_completion.rs`. **Mainnet params 14d/7d/30d must
  be deployed (blocker A1).**
- **R5 — Cross-network / cross-controller replay prevented.** `network_passphrase` and
  controller address are bound into `auth_hash`. Evidence: `zk_recovery_lifecycle.rs`. _Add
  explicit wrong-network negative test (F-task)._
- **R6 — Rate limit + cancel bounds.** ≤3 initiations / rolling 90d; cancel cap (2 mainnet)
  + 24h cooldown bound grief. Evidence: `zk_recovery_lifecycle.rs`.
- **R7 — Passkey alone cannot grief recovery.** `cancel_recovery` and `burn_nullifier` require
  BOTH account auth AND a fresh `action=2/3` proof of secret knowledge. Evidence:
  `zk_recovery_neuter.rs`, `zk_recovery_lifecycle.rs`.
- **R8 — Completion gated to exactly the pending key rotation.** `Policy::enforce` inspects
  the context and rejects anything other than the pending `add_context_rule`/signer set (OZ
  only validates the self-target, not fn/args). Evidence: `zk_recovery_completion.rs`,
  `zk_completion_spike.rs`.
- **R9 — Stolen-passkey neuter closed.** `AlreadyInstalled` guard + unconditional uninstall
  refusal prevent repointing/removing the recovery policy to disable recovery. Evidence:
  `zk_recovery_neuter.rs`.
- **R10 — Leaf is account-bound on-chain.** The stored leaf is `wrap_leaf(account, secret)`
  computed on-chain at insert (after auth), so a client cannot pre-wrap a leaf binding a
  victim account. Evidence: pool tests (`contracts/zk-recovery/src/pool.rs`),
  `zk_recovery_lifecycle.rs`.

## Circuit & cryptography

- **C1 — Circuit fully constrained.** All three public inputs (`root`, `nullifier`,
  `auth_hash`) are outputs of in-circuit Poseidon2 hashes; no under-constrained witness
  signals. Evidence: `circuits/zk_recovery/src/tests.nr`; build script asserts public-input
  count == 3.
- **C2 — Poseidon2 host/circuit parity.** On-chain Poseidon2 (arities 2/4/15) matches the
  circuit at every arity and domain constant used. Evidence: `zk_vectors.rs`, circuit
  `vector_parity_*` tests; identical domain constants in `contracts/zk-recovery/src/hash.rs`
  and `circuits/zk_recovery/src/main.nr`.
- **C3 — Merkle membership tight.** Depth-24 membership uses tight bit-range constraints and
  DOM_BIND-tagged leaves (no leaf/interior collision). Evidence: circuit tests; Merkle
  frontier tests in `contracts/zk-recovery/src/merkle.rs`.
- **C4 — Commitment canonicalization.** Non-canonical (≥ field order) leaves are rejected
  on-chain. Evidence: `pool.rs` canonicalization tests.
- **C5 — Transparent setup.** UltraHonk with keccak Fiat-Shamir (`--verifier_target
  evm-no-zk`) has no trusted setup / no toxic waste. Evidence: documented in
  `circuits/zk_recovery/scripts/gen_artifacts.sh` + SUPPLY_CHAIN.md.

## Proof verifier

- **V1 — VK immutable + bound.** The VK is set once at construction and hashed into the
  Fiat-Shamir transcript, so it cannot be swapped without invalidating all proofs. Evidence:
  `contract_verifier.rs`; `contracts/vendor/.../transcript.rs`.
- **V2 — All public inputs checked; exact size.** Verification binds and requires the exact
  `root||nullifier||auth_hash` (96 bytes). Evidence: `contract_verifier.rs`. _Add
  malformed/truncated-proof + wrong-size negative tests (F-task); un-exclude the vendored
  verifier's own tests from CI (F-task)._

## Policies

- **P1 — Spending-limit rolling window.** Meters SAC `transfer` over a rolling window.
  Evidence: `spending_limit_policy.rs`. _Add i128 overflow edge test (F-task)._
- **P2 — Multisig threshold + rotation.** Threshold enforced; rotation threshold policy.
  Evidence: `multisig_recovery.rs`, `default_rule_threshold.rs`.
- **P3 — Scoped session keys.** Context rules restrict contract/fn/limit/time window.
  Evidence: `scoped_session_key.rs`.

## Cost / DoS budgets (Stellar mainnet `tx_max_instructions = 400M`)

- **B1 — `verify_proof` ≤ 250M CPU** (measured ~159M). Gate: `just bench-zk`
  (`crates/zk-bench/tests/budget.rs`).
- **B2 — full `initiate_recovery` ≤ 350M CPU** (measured ~168M). Gate: `just bench-zk-initiate`
  (`initiate_cost.rs`).
- **B3 — guard cross-call ≤ 10M CPU** (measured ~1.17M). Gate: `just bench-zk-guard`
  (`guard_cost.rs`).

## Storage / liveness

- **T1 (to validate) — Recovery state survives the active window.** Pending + nullifier +
  rate-window entries must remain live across the full 14d timelock + 30d completion window
  under Soroban `max_ttl`, with fail-closed archival. **Empirical test to be added (E-task).**
