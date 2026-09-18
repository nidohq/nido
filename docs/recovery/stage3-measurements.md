# Perch/Nido recovery — end-to-end experiment measurements

**Status:** Measurements record. Proof generation time, proof size,
verification cost, transaction construction, fees, and restoration behavior
for the guardian/ZK/combined recovery controller (`contracts/recovery-controller`)
— measured against the real contracts and (where noted) the real adapted
circuit, on this development machine, explicitly labeled as such rather
than a "realistic replacement device."

**Builds on:** the transition model in `docs/recovery/TRANSITION_SPEC.md`
(PR [#204](https://github.com/nidohq/nido/pull/204)) and the
completion-mechanism recommendation in `docs/recovery/stage2-findings.md`
(PR [#205](https://github.com/nidohq/nido/pull/205) — Variant A, adopted
here with no blocker recorded).

## 1. What this measures

`contracts/recovery-controller` (shared controller, guardian-quorum +
ZK-verifier adapters, combined mode) and `contracts/recovery-verifier` (a
NEW, constructorless UltraHonk verifier) against
`circuits/zk_recovery_doc` (a NEW circuit, isolated from the pre-existing
`circuits/zk_recovery` — see "Known limits" in
`contracts/recovery-controller/src/lib.rs` and §7 below for why a sibling
circuit rather than an in-place edit).

## 2. Proof generation (ZK modes only — `ZkOnly`/`Combined`)

| Metric | Value | Notes |
| --- | --- | --- |
| Toolchain | nargo 1.0.0-beta.18, bb 3.0.0-nightly.20260102 (both native, no Docker fallback needed) | pinned, matches `circuits/zk_recovery/scripts/gen_artifacts.sh` |
| Machine | Apple M5 Max, 128 GB RAM (this development machine) | **NOT a "realistic replacement device"** — see note below |
| Proving-key computation | ~4 ms | one-time per VK, not per-proof |
| `bb write_vk` wall time | ~37 ms | |
| `bb prove` wall time | ~68 ms | depth-24 Merkle circuit, arity-15 `auth_hash` |
| Proof size | 6,976 bytes | byte-identical size to the pre-existing `zk_recovery` circuit's proofs — the field-swap changed witness semantics, not circuit topology |
| VK size | 1,888 bytes | |
| Public inputs size | 96 bytes (`root(32) \|\| nullifier(32) \|\| auth_hash(32)`) | same wire format as `zk_recovery` |

**Realistic replacement device note:** proof generation above was measured on
a high-end Apple Silicon desktop (M5 Max, 128 GB RAM) running this
experiment — not a phone or modest laptop a recovering user would actually
hold during a real lost-key event. This machine's `bb prove` wall time
(~68 ms) should NOT be read as representative of what a recovering user
would experience; mobile/laptop UltraHonk proving numbers are a genuinely
open question this experiment does not answer. This is a named limit, not
an estimate presented as representative.

## 3. On-chain verification cost

| Metric | Value | Notes |
| --- | --- | --- |
| `verify_proof` CPU instructions (this experiment's `nido-recovery-verifier`) | 179,257,831 | `crates/zk-bench/tests/recovery_verifier_budget.rs`, real Wasm-metered (`contractimport!`, not native) |
| M1 `nido-zk-verifier` for comparison | ~159,000,000 (pre-existing, `crates/zk-bench/tests/budget.rs`) | same vendored UltraHonk verifier code, different VK/circuit — the ~20M delta is consistent with proof-shape/circuit-size effects, not a regression introduced by this experiment's verifier itself |
| Mainnet `tx_max_instructions` (protocol 27) | 400,000,000 | real per-transaction ceiling |
| Headroom under `verify_proof` alone | ~220,742,169 | leaves room for auth checks, root-ring check, Poseidon2 host hashing, and storage writes in the rest of an `initiate`/`submit_zk_proof` transaction — not independently measured here (see §4) |

No enforced GO/NO-GO gate is asserted for this number in this PR (unlike
M1's `MAX_VERIFY_CPU = 250_000_000` in `crates/zk-bench/tests/budget.rs`) —
this experiment is exploratory, not yet a production gate;
`crates/zk-bench/tests/recovery_verifier_budget.rs` prints the measurement
but does not assert a threshold.

## 4. Transaction construction and fees

Not independently measured in this PR beyond §3's `verify_proof`-only CPU
cost. A full per-mode (guardian-only / zk-only / combined) `initiate`/
`submit_guardian_approval`/`submit_zk_proof`/`cancel`/`apply_doc`-completion
transaction-size and simulated-resource-fee breakdown (mirroring M1's
`bench-zk-initiate`/`bench-zk-guard` whole-transaction gates in
`crates/integration-tests/tests/it/{initiate_cost,guard_cost}.rs`) is real,
bounded follow-up work this experiment did not reach — named here as an
explicit gap rather than a guessed number. The ZK proof payload itself
(6,976 bytes, §2) is the dominant contributor to `submit_zk_proof`'s
transaction size relative to `submit_guardian_approval`'s (a bare address +
two `BytesN<32>` + a `u64`), but the exact XDR/fee delta was not measured.

## 5. Restoration behavior

- **Inactive-account restore without the old admin key:** proven by
  `crates/integration-tests/tests/it/recovery_stage3_guardian_only.rs::restores_an_inactive_account_without_its_old_admin_key`.
  The account's ORIGINAL admin passkey is used exactly once — at initial
  `enroll` (self-authed, per the crate's design) — and never referenced
  again by the test. Every subsequent step (`begin_attempt` is
  permissionless; guardian approvals use the guardians' own signatures; the
  completing `apply_doc` call is authorized entirely by the recovery rule's
  `Policy::enforce`, requiring no account signature at all) succeeds without
  the original key signing anything further. This holds for all three
  modes by construction — completion is mode-independent Variant A code.
- **Compromise-recovery postcondition (baseline-with-replacement
  exactness):** `begin_attempt` requires `action == Compromise` to target
  EXACTLY `config.baseline_doc_hash` (`Error::BaselineMismatch` otherwise —
  proven by `contract::tests::compromise_action_must_target_the_enrolled_baseline`).
  The contract does not itself verify the target document's CONTENT is
  `baseline + replacements` (it has no doc-parsing access — see "Known
  limits" below); this is a client/evidence-provider responsibility, same
  trust boundary as the Variant A completion mechanism
  (`docs/recovery/stage2-findings.md`).

## 6. Enrollment-data availability

- Guardian-only: no ZK enrollment data at all — a hard requirement of this
  mode (no secret, no Merkle witness, no proof machinery). Guardian
  addresses are the only enrollment data, stored plaintext in
  `RecoveryConfig`.
- ZK modes: enrollment secret + Merkle witness availability is the
  recovering user's own responsibility to retain (this experiment does not
  address secret backup/escrow — out of scope, same as the pre-existing
  `circuits/zk_recovery` module's enrollment model).
- **Reviewable commitment, and why it isn't in the account's Perch doc:**
  investigated embedding `RecoveryConfig` in the account's own policy
  document and confirmed it's unreachable today, not merely unimplemented —
  perch's schema is `.strict()` (no extension fields), nido's own
  doc-lowering throws for the one principal shape that could plausibly
  carry it, and the deployed, pinned `perch-doc-compiler`'s wire-level
  `CompiledRule` type has no field for an arbitrary policy address at all
  (full reasoning: `contracts/recovery-controller/src/lib.rs`'s "Known
  limits"). `RecoveryController::config_hash(account) ->
  Option<BytesN<32>>` (`sha256(xdr(RecoveryConfig))`, on-chain,
  deterministic) is the substitute: a real, recomputable commitment to the
  full enrolled configuration, reviewable the same way `applied_doc_hash`
  is, just not literally inside the doc's own JSON. Surfaced via
  `packages/passkey-sdk/src/recoveryStage3/reads.ts::readConfigHash` and
  the `recover-v3` Status panel.

## 7. Explicit limits

`contracts/recovery-controller/src/lib.rs`'s crate doc comment is the
canonical, most detailed list ("Known limits" section) — read it directly.
Summary, plus measurement-specific notes:

- No `reconfigure` entry point (enrollment is one-shot).
- `replaced_credential_ids` is client-declared, not on-chain-verified
  against the target document's actual content.
- No "ordinary execution" freeze on `execute()` — only `apply_doc` and the
  signer/rule/policy-removal entry points are guarded.
- **Pre-existing, unclosed risk** (not introduced by this experiment): the
  smart account's `add_context_rule` "completion window" check admits an
  ordinarily-admin-authorized call to install an arbitrary rule whenever a
  `has_pending`-reporting controller says a recovery is pending under
  `Freeze` policy — see the crate doc comment for the full analysis.
- `PendingActivityPolicy::Restrict` is refused at `enroll`, not implemented.
- **Account wiring is a separate precondition from `enroll`, and is
  currently unreachable for every existing testnet account.** `enroll`
  only writes this controller's own storage; the ACCOUNT's own
  `recovery_controller` field must independently equal this controller
  before anything it stores matters (`Policy::enforce`/`has_pending` are
  never cross-called otherwise). Manual live testing against a real account
  caught this as a silent no-op; a live probe
  (`tests/e2e/testnet/recover-v3-wiring.testnet.spec.ts`) then confirmed
  it's not an edge case — every account the doc-only factory mints is
  ALREADY wired to the M1 `nido-zk-recovery` pool at construction
  (DEPLOYED.md's M2 genesis-insert behavior), so reaching this controller
  needs the account's own real 7-day `initiate_recovery_rule_removal` →
  `execute_recovery_rule_removal` migration first — no faster path exists,
  by design. `packages/passkey-sdk/src/recoveryStage3/accountWiring.ts`'s
  `checkAccountWiring` makes the mismatch explicit and `recover-v3` refuses
  Enroll until it's resolved, rather than writing orphaned config.
- **This PR's circuit isolation:** `circuits/zk_recovery_doc` is a NEW,
  separate circuit crate, not an in-place edit of the pre-existing
  `circuits/zk_recovery` (M1). The first approach attempted an in-place
  field-swap and was reverted after discovering it would break M1's own
  still-referenced integration tests (`zk_recovery_lifecycle.rs` and
  siblings, 33 tests total), which pin real `bb`-proved fixtures against
  the OLD `auth_hash` formula. Isolating the circuit (and
  `contracts/recovery-controller/src/zk.rs`'s host-side Poseidon2
  reconstruction, which duplicates rather than depends on
  `nido-zk-recovery::hash`) means this PR is fully additive: `circuits/zk_recovery/`
  and `contracts/zk-recovery/` are byte-for-byte unchanged, confirmed via
  `git diff` and by re-running M1's full test suite (33/33 +
  `multisig_recovery` 3/3) after the revert.
- **Combined-mode proving cost is not separately isolated** from
  guardian-quorum cost in §3/§4 above — in this experiment's design,
  guardian approvals and ZK proof verification are independent,
  parallel evidence-collection calls (`submit_guardian_approval` and
  `submit_zk_proof` are separate transactions), so `Combined` mode's total
  cost is additive across both, not a new joint measurement.
- Client/SDK proof generation shells out to the `nargo`/`bb` CLI toolchain
  via a Node script (no in-browser/mobile proving integration) — see the
  PR description's client section for what was built and its own limits.
