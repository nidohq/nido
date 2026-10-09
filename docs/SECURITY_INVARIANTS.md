# Security invariants

The properties that must hold, each with the test that pins it. An auditor
uses this to check the system does what it claims; the team keeps it green.
IDs are stable and referenced from [THREAT_MODEL.md](./THREAT_MODEL.md).

Recovery properties are Perch's. Where a recovery entry comes from a Perch
spec decision or section, it names it
([`vendor/perch/docs/recovery/spec.md`](../vendor/perch/docs/recovery/spec.md));
Perch's own suites pin them against Perch's code
([implementation.md](../vendor/perch/docs/recovery/implementation.md)). The
evidence listed here is Nido's: the same properties, on Nido's factory,
verifier, and passkeys.

**How the evidence runs.** Integration tests live in
`crates/integration-tests/tests/it/<file>.rs` and run with `just test`. In the
Perch suites (`account.rs`, `onboarding.rs`, `recovery_*.rs`, `costs.rs`)
every contract runs from wasm under enforcing authorization, and every Perch
contract is the exact wasm of Perch's testnet deployment, fetched by the
manifest's hashes (`just perch-infra`):
`set_auths` with hand-built entries, because `mock_all_auths` never runs a
custom account's `__check_auth`. Keys are P-256 passkeys signing exactly what
a browser assertion signs. Guardians are Nido accounts approving through a
rule their own document scopes to the controller. ZK proofs are real
zero-knowledge UltraHonk proofs of Perch's release circuit (depth 32),
verified by the adapter's embedded verifier, replayed from `fixtures/zk/` and
re-proved in CI ("Reproduce the real-proof fixtures"). Nothing on their
authorization or verification path is mocked.

The other suites are narrower. The factory unit tests use `mock_all_auths`
with a stub verifier and a mock registry; the pre-Perch policy tests use
`mock_all_auths`.

## Factory (`contracts/factory/src/contract.rs` unit tests)

- **F1. Deterministic address.** `create_account(salt, key)` deploys a
  `perch-account` at `get_c_address(salt)`, whose only rule is `key` as admin
  scoped to the account itself. `get_c_address_uses_random_salt`,
  `create_account_deploys_a_perch_account_with_the_passkey_admin_rule`.
- **F2. One account per salt.** A second `create_account` with the same salt
  is refused, so replaying a salt can't reset or take over an account.
  `create_account_twice_with_the_same_salt_is_rejected`.
- **F3. The embedded account code is what deploys.** The factory deploys by
  the hash of its embedded wasm, and an upgrade clears the cached hash so new
  accounts get the new code. `account_wasm_hash_equals_uploaded_wasm_hash`,
  `upgrade_clears_account_wasm_hash_cache`,
  `refresh_account_wasm_hash_repairs_stale_cache`.
- **F4. Admin actions need the admin.** `set_admin_requires_current_admin_auth`,
  `upgrade_requires_admin_auth`, `set_registry_pins_requires_admin_auth`.
- **F5. A pinned verifier never consults the registry.** Once pinned, a
  repointed or broken registry can neither reroute nor block account creation.
  `pinned_resolve_never_consults_registry`.

## WebAuthn verifier (`contract_verifier.rs`)

Perch's `perch-webauthn-verifier`, the deployed wasm, called through its own
`verify` entry point with Nido's assertions.

- **V1. Only a valid assertion over the exact challenge, by the exact key,
  verifies; high-S signatures are refused.** `verify_webauthn_assertion_on_chain`,
  `reject_wrong_challenge_on_chain`, `reject_wrong_key_on_chain`,
  `reject_high_s_malleated_signature_on_chain`.
- **V2. The factory names that verifier.** Every account the factory mints
  has one admin signer, checked by the pinned verifier. Pinned in the tests
  by `world()` and on testnet by `scripts/deploy-factory.sh`, which reads the
  pin back.

## Account and documents (`account.rs`)

- **A1. `apply_doc` is the only rule write path, and a document replaces the
  whole rule set.** `the_first_document_signed_by_the_passkey_is_installed_and_readable`,
  `each_document_replaces_the_whole_rule_set`.
- **A2. Only the admin rule changes the document.**
  `a_passkey_outside_the_admin_rule_cannot_change_the_document`.
- **A3. No bricking.** A document without a self-admin rule is refused.
  `a_document_without_a_self_admin_rule_is_refused`.
- **A4. Network binding.** A document for another network is refused.
  `a_document_for_another_network_is_refused`.
- **A5. Caps compile to Perch's spending limit beside the interpreter.**
  `a_capped_rule_installs_the_spending_limit_beside_the_interpreter`.
- **A6. Reserved hook names are never authorized or executed** (spec D12,
  §15). `reserved_hook_names_are_never_authorized_or_executed`.
- **A7. Ordinary activity runs through document rules, directly and through
  `execute`.** `ordinary_activity_runs_through_document_rules_and_execute`.
- **A8. A document prepared at an older revision never lands.** An
  `apply_doc` naming the revision it was prepared at is refused with
  `StaleRevision` once another apply has moved the account, and leaves the
  revision; every successful apply advances it by one.
  `a_document_prepared_at_an_older_revision_is_refused`. The wallet names
  the revision each document was composed from: owner applies go through
  perch-js's `applyDocument` (`applyDocWithPasskey` in
  `packages/frontend/src/lib/primaryPasskeySigner.ts`), and a dApp request
  carries it as `expectedRevision` (`docRequest.test.ts`).

## Onboarding (`onboarding.rs`)

- **O1. Recovery enrolls in the first `apply_doc`.**
  `the_first_document_enrolls_recovery_in_one_apply_doc`.
- **O2. A failed pool insertion reverts the whole `apply_doc`.** Against a
  pool that refuses every insertion, the account is left exactly as it was.
  `a_failed_pool_insertion_reverts_the_whole_apply_doc`.
- **O3. Enrollment ids are fresh and never reused** (spec D10).
  `zk_enrollments_are_fresh_and_never_reused`.

## Recovery

- **R1. An attempt without evidence blocks nothing; the first authorized
  attempt wins** (D2, §6.3, §6.4). `recovery_rules.rs::evidence_free_attempts_block_nothing_and_the_first_authorized_wins`.
- **R2. Evidence counts for exactly one statement.** A proof never counts for
  another attempt, account, or action; guardian approvals and replacement
  sets are validated (D13, §4).
  `recovery_rules.rs::a_proof_never_counts_for_another_attempt_account_or_action`,
  `recovery_rules.rs::replacements_and_approvals_are_validated`.
- **R3. Only the derived target completes, only after the delay.** For all
  six profile/mode combinations: a collecting attempt blocks nothing; only the
  on-chain derived target completes and only after the timelock; completion
  revokes the replaced passkey, spends the nullifier, and enrolls the rotated
  credential (D6, D7, D9). `recovery_lifecycle.rs::{loss,protected}_{guardian_only,zk_only,combined}`.
- **R4. The Protected freeze.** While an attempt is authorized, a `Protected`
  account refuses direct authorization and `execute`; a `Loss` account keeps
  both; both refuse policy writes in the window (D1, D3). Checked inside each
  `recovery_lifecycle.rs` case.
- **R5. Reconfiguration needs the right authority.** `Loss`: the owner.
  `Protected`: the owner plus the enrolled condition over a `Reconfigure`
  statement (both factors under `Combined`). Rotating a passkey is not a
  reconfiguration (D4, D8). `recovery_reconfigure.rs`, all five tests.
- **R6. Cancellation.** The `Loss` owner vetoes, uncapped; the `Protected`
  owner cannot. Guardian or ZK cancellation lifts the freeze; evidence-based
  cancellation is capped by `max-cancels` (D5).
  `recovery_rules.rs::a_loss_owner_vetoes_and_a_protected_owner_cannot`,
  `guardian_cancellation_lifts_the_freeze_and_is_capped`,
  `a_zk_cancellation_proof_lifts_the_freeze`.
- **R7. A stale lost-key source needs a fresh attempt** (§6.2, §7.2, T4).
  If the applied document changed since the attempt opened, the approval
  that would promote it succeeds and stores the attempt `Invalidated`
  (refusing would roll the invalidation back), and it takes no more
  evidence. `recovery_rules.rs::a_lost_key_attempt_whose_source_changed_needs_a_fresh_attempt`.
- **R8. Compromise recovery restores the enrolled baseline and revokes what
  the thief added** (D6, D7).
  `recovery_rules.rs::compromise_restores_the_baseline_and_revokes_what_the_thief_added`.

## Upgrades (`recovery_upgrades.rs`, `account.rs`)

- **U1. Seven days, owner only.** An upgrade runs only after 120,960 ledgers,
  installs exactly the scheduled wasm, and is owner-only, cancellable, and
  replaceable (D11). `account.rs::an_upgrade_waits_seven_days_and_installs_the_scheduled_wasm`,
  `account.rs::upgrades_are_owner_only_cancellable_and_replaceable`.
- **U2. A Protected upgrade needs the condition over that exact wasm.**
  `a_protected_upgrade_needs_the_guardian_quorum`,
  `a_protected_zk_upgrade_needs_a_proof_over_the_upgrade_statement`.
- **U3. Upgrades yield to recovery.** Blocked while an attempt is authorized,
  dropped by a completion, and stale after a reconfiguration: executing a
  stale request refuses with `StaleUpgrade`, and it can never run.
  `upgrades_are_blocked_in_the_window_and_dropped_by_a_completion`,
  `a_reconfiguration_makes_a_queued_upgrade_stale`.

## ZK (`recovery_rules.rs`, `crates/integration-tests/src/zk.rs`)

- **Z1. Fixture drift fails loudly.** Each committed proof records the
  statement digest, root, and nullifier it was proved for; a test whose
  statement changed fails with "rerun `just gen-zk-fixtures`", not an opaque
  `ProofRejected`. CI re-proves every fixture, each fresh proof verifies
  through the deployed adapter, and CI fails if any `fixture.json` changes.
  The proofs are zero-knowledge, so their bytes differ on every run.
- **Z2. Old roots stay valid; a full tree rolls over** (D15, §14).
  `a_proof_against_an_older_root_still_verifies`,
  `a_full_tree_rolls_over_and_its_last_member_still_recovers`.
- **Z3. Nullifiers.** Only a completion spends one, and nothing un-spends it
  (D9). The `recovery_lifecycle.rs` ZK cases show a completion spends it;
  `recovery_rules.rs::a_zk_cancellation_proof_lifts_the_freeze` and
  `recovery_reconfigure.rs::protected_zk_reconfiguration_is_its_own_proven_action`
  show a cancellation or reconfiguration proof leaves it unspent. Perch's
  controller also refuses a ZK lost-key attempt that declares no rotated
  enrollment; Nido's tests always declare one and don't exercise that
  refusal.
- **Z4. The wallet and the chain agree.** The SDK's statement encodings
  (perch-js's) match Perch's independent vectors and every statement Nido's
  Rust suites built through the controller, byte for byte. bb.js proves a
  lifecycle statement in the page's way, and its own verifier accepts both
  that proof and the native proof the adapter verified, for the same public
  inputs.
  `packages/passkey-sdk/src/perch/statement.test.ts`,
  `packages/passkey-sdk/src/perch/zk.test.ts` (CI: "SDK Perch parity").

## Storage

- **T1. Archived state is restored, not reset** (§3.6). After every recovery
  entry expires, its epoch and enrollments come back intact and a recovery
  completes with a proof against the archived root.
  `recovery_rules.rs::archived_recovery_state_is_restored_not_reset`.
- **T2. Renewal is permissionless.**
  `recovery_rules.rs::recovery_state_renewal_needs_no_authorization`. Restoring
  everything a recovery touches inside the recovery transaction exceeds the
  132,096-byte write limit (169,208 bytes when measured while writing the
  archival test; its doc comment records the limit), so restoration runs in
  separate transactions first (RUNBOOKS §6).

## Budgets (`costs.rs`)

- **B1. Every measured transaction stays under 75% of the instruction,
  memory, write-byte, and write-entry limits.** The suite asserts it per row.
  The highest row is the promoting `submit_zk` under `Combined`: 119.3M
  instructions, 29.8% of the 400M limit (the zero-knowledge verifier costs
  more than the non-ZK one did). Memory peaks at 13.7% of 40 MiB.
  `protected_combined_transactions_fit_the_budget`,
  `compromise_transactions_fit_the_budget`.

## Wallet

- **W1. No deployment, no guessing.** Built with `PUBLIC_PERCH_DEPLOYMENT=none`, every
  recovery page says recovery is not deployed and loads without script
  errors. `tests/e2e/ui/recovery-pages.spec.ts`.
- **W2. Guardian links are validated before display.** Malformed requests are
  refused. A reconfiguration link must carry the proposed settings, and they
  must hash to the `configHash` the request names; otherwise the page offers
  no Approve button. `packages/frontend/src/lib/recovery/model.test.ts`
  ("refuses malformed requests"), `guardianPage.ts` `describe()`.
- **W3. A guardian can't be shown one replacement and sign another.** An
  attempt link must carry the replacement set, it must hash to what the
  attempt bound on chain, and every new credential must be checked by the
  deployment's verifier; otherwise the page offers no Approve button.
  `model.test.ts` ("refuses an attempt link without, or with another,
  replacement set", "flags replacement credentials checked by another
  verifier"). The page wiring (`guardianPage.ts` `describe()`) has no
  automated test until the testnet tier runs.
- **W4. Recovery kits are parsed strictly.** `model.test.ts` ("accepts a
  well-formed kit and refuses anything else").
- **W5. The setup secret stays out of query strings.**
  `tests/e2e/ui/registration.spec.ts` ("a query-string setup secret is
  scrubbed from the URL").
- **W6. The wallet's deployment is Perch's manifest.** `perch.TESTNET` equals
  Perch's `deployments/testnet.json` plus Nido's factory, field by field.
  `packages/passkey-sdk/src/perch/deployment.test.ts`.
- **W7. A completion carries its own recovery-rule auth entry.** The
  completing `apply_doc(target, 0, Some(revision))` has address credentials
  for the account, a fresh nonce, and perch-js's signer-free `AuthPayload`
  for the recovery rule, selected (`selectRecoveryRule`) in the same snapshot
  the target was derived from; `revision` is that snapshot's. The wallet
  simulates it in enforcing mode (recording mode never runs the
  controller's `enforce`). `packages/passkey-sdk/src/perch/recovery.test.ts`.
- **W8. Every profile/mode combination recovers on testnet through the
  wallet.** Guardians approve from their own Nidos, the kit proves in the
  page, the delay passes, and the completion lands, against Perch's
  deployed release and Nido's factory. `tests/e2e/testnet/perch-recovery.testnet.spec.ts`
  (manual tier; last run 2026-10-08 against Perch's 836fdc9 deployment with
  the wallet on perch-js's consumer interface, all six plus the policy page,
  with the relayer-free harness, RUNBOOKS §1).
- **W9. A document over Perch's limits is refused before it's built.** The
  wallet checks the limits the account's own compiler reports (`limits()`,
  read through perch-js; today 8 declared signers, 11 rules, 8192 canonical
  bytes, and 20-byte rule names), never constants of its own. The policy
  and delegate forms refuse a 21-byte rule name, a ninth key, or a twelfth
  rule before submission. `buildApplyDocTx` and `applyDocument` say which
  limit a document breaks. The SDK test pins the messages against Perch's
  compiler source. Interpreter programs are bounded by perch-program's
  limits (256 ops, stack depth 128), which no Perch view reports; the SDK
  mirrors them and its test pins them to perch-program's source.
  `packages/passkey-sdk/src/policyDoc/caps.test.ts`,
  `packages/passkey-sdk/src/policyDoc/lower.test.ts`,
  `packages/frontend/src/lib/policy/docDraft.test.ts`.

- **W10. Rules are selected from the account's own record, never by an id
  scan.** OZ never reuses a rule id and a document gives a replaced rule a
  new one, so ids grow without bound (nidohq/nido#240). Signing, the
  recovery completion, and the policy and security pages read the
  installed rules from `configuration()` and select by name, scope, and key;
  the integration harness does the same. The signing digest and the
  `AuthPayload` are perch-js's, matched against Perch's Rust-written vectors.
  `packages/frontend/src/lib/policyChainParse.test.ts`,
  `packages/passkey-sdk/src/authVectors.test.ts`.

## Nido's pre-Perch policies

`nido-multisig-policy`, `nido-spending-limit-policy`, and
`nido-preauth-sweep-policy` keep their mechanics tests
(`multisig_recovery.rs`, `spending_limit_policy.rs`, `preauth_sweep_policy.rs`,
`scoped_session_key.rs`), run on the Perch account through the OZ library.
A Perch document can't attach them, so no fresh account uses them.
