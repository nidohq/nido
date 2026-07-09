# ZK Account Recovery — M1–M4 Outline

> Input to a future `writing-plans` run, one milestone at a time. M0 is complete and green (see `2026-07-02-zk-recovery-m0-gate.md` and spec §2.6). Each milestone below should be expanded into a full bite-sized TDD plan before execution.

## M0 status (done)

Branch `zk-recovery-m0`. All four feasibility gates passed:
- Poseidon2 parity native at arity 2/4/15.
- `verify_proof` = 159M CPU ≤ 250M gate (real tx cap 400M).
- Zero-signer `AuthPayload` + Policy completion works vs OZ 637c53a.
- SEP-53 derivation deterministic + verifiable (synthetic); live-wallet matrix human-gated.

Reusable artifacts M1+ builds on: `contracts/zk-verifier` (deployed-shape verifier), `contracts/vendor/ultrahonk-soroban-verifier`, `circuits/zk_recovery/` (+ committed vk/proof/public_inputs fixtures), `crates/zk-bench` (budget CI gate), `tests/vectors/zk-recovery/vectors.json` (cross-language parity), `crates/integration-tests/tests/it/zk_completion_spike.rs` (the exact working AuthPayload/Context shape), `tests/spikes/sep53-verify.mjs`.

## M1 — `contracts/zk-recovery` (pool + controller + policy)

Pattern sources: `../zk/rs-soroban-ultrahonk/tornado_classic/contracts/src/mixer.rs` (frontier/root/nullifier), `contracts/multisig-policy/src/contract.rs` (OZ Policy shape), `crates/integration-tests/tests/it/zk_completion_spike.rs` (the proven completion auth shape).

Tasks (title granularity):
- Merkle frontier at depth 24 + 128-slot historic-root ring (adapt `mixer.rs`; extend_ttl(max) on write). Reuse the frontier code verbatim where possible — parity already proven.
- `insert` (factory-only invoker auth) + `insert_for` (account-authed) with the **on-chain `DOM_BIND` wrap** (`stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)`), rejecting `inner ≥ r`.
- Nullifier map `{Reserved(Address), Spent}` + per-account nonce & cancel counters.
- `initiate_recovery`: recompute `auth_hash` via host Poseidon2 from canonical args, check root-ring/nullifier/nonce/timelock-floor/no-live-pending/rate-limit, cross-call `zk-verifier.verify_proof`, reserve, store pending, emit `RecoveryInitiated`. **Confirm full-tx cost via live testnet simulate ≤ 400M (the deferred M0 measurement).**
- `cancel_recovery` (account passkey + fresh `action=2` proof, cap 2, 24h cooldown) + `burn_nullifier` (account-authed).
- OZ `Policy` impl `enforce` — **MUST inspect `context.fn_name`/`args`** and permit only `add_context_rule` with the pending new-signer set (M0 hard requirement); consume pending atomically. `install`/`uninstall`.
- Events + error enum; Rust integration tests with the checked-in proof fixtures: full lifecycle + differentials (wrong/unknown/stale root, reused nullifier, each public input tampered, premature/expired complete, cancel cap + cooldown, wrap-binding bypass, nonce replay, `inner ≥ r`).
- Deploy `zk-verifier` with our real VK; publish both to the Stellar Registry; `DEPLOYED.md`.

## M2 — smart-account + factory

Pattern sources: `contracts/smart-account/src/contract.rs`, `contracts/factory/src/contract.rs`.

- Smart-account constructor takes `recovery_controller`, installs the zero-signer `CallContract(self)` recovery rule uniformly; store rule id + controller.
- Guard in account code: recovery-rule removal announce-then-execute (7d idle, blocked when pending); `remove_signer`/rule/policy/`update_valid_until` blocked while `controller.get_pending(self).is_some()`.
- Factory `create_account_v2(salt, key, commitment)` → deploy (pass controller from registry) + `pool.insert(commitment)` atomic; legacy `create_account` derives deterministic dummy `sha256("nido-zk-dummy"||salt) mod r`; confirm deterministic C-address unchanged.
- Migration path for existing accounts (`insert_for` + rule install, degraded guard).
- Integration tests: full initiate→cancel-cap→complete lifecycle, guard blocks, legacy-account completion, dummy-leaf uniformity.

## M3 — SDK + prover + indexer + relayer

Pattern sources: `packages/passkey-sdk/src/policyBlocks/multisigRotation.ts` (TxBuild/dual-SDK hazard), `../zk/soroban-zk-demo/src/services/NoirService.ts` (proving), `infra/recovery-relay` (indexer shape), `infra/relayer`.

- SDK `packages/passkey-sdk/src/zkRecovery/`: `field`, `poseidon` (`@zkpassport/poseidon2`, gated by `vectors.json`), `derivation` (M1 `@scure/bip39` + M2 SEP-53 — reuse `tests/spikes/sep53-verify.mjs` logic), `merkle` (depth-24, zeros match contract), `authHash`, `enrollment`, `recovery` (tx builders via new `@nidohq/zk-recovery` bindings), `poolSync`, `overlay`.
- Prover worker `packages/frontend/src/lib/zk/` porting NoirService; artifacts + manifest sha256 check; single-threaded fallback.
- `infra/pool-indexer/` (CF Worker): `getEvents` → append-only leaves; client rebuilds root and checks against on-chain `current_root` (trust-free).
- Relayer channels-plugin: host-function allowlist, pre-simulation drop, per-IP rate limit.
- Vitest: derivation vectors, proof-blob golden bytes, poolSync gaps/dupes/reorder, staging.

## M4 — UX + e2e + deploy

Pattern sources: `packages/frontend/src/pages/{new-account,security/recover}/index.astro`, `packages/frontend/src/lib/recoveryActions.ts`, `tests/e2e/testnet/recovery.testnet.spec.ts`.

- Creation "Never get locked out" step (seed / wallet / skip, uniform tx shape) + recovery-card screen.
- Migration card; recovery `#zk-*` mode (fresh passkey → secret → pool sync → prove → initiate → timelock staging → complete → cleanup); pending-recovery cancel banner.
- Complete the live wallet-determinism matrix (`tests/spikes/wallet-determinism.md`) with a human tester.
- Playwright: fast lane (stubbed prover + mocked pool) + quarantined testnet lane with real browser proving.
- Testnet deploy, `DEPLOYED.md`, `just bench-zk` wired as required CI, circuit-artifact reproducibility CI diff.

## Carry-forward risks into M1+

- Full `initiate_recovery` tx cost vs 400M — measure on live testnet early in M1 (M0 measured `verify_proof` alone at 159M).
- Controller `enforce` fn_name/args gating (M0 hard requirement) — the single most security-critical line in M1.
- Floating dep pins (`soroban-poseidon` branch=main, `poseidon` tag v0.2.0) — pin to commit SHAs before mainnet.
- Vendored verifier is unaudited/third-party — audit before mainnet.
