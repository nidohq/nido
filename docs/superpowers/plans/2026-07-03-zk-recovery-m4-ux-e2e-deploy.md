# ZK Recovery M4 — UX + Playwright + Testnet Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the user-facing half of ZK account recovery — the creation "never get locked out" enrollment step, the `#zk` recovery ceremony, the pending-recovery banner — plus a real testnet deploy of `zk-verifier` + `zk-recovery`, Playwright fast + testnet lanes, and CI cost/reproducibility gates.

**Architecture:** Astro-islands pages (fixed-id sections) call a new `zkRecoveryActions.ts` that wraps the M3 SDK (`@nidohq/passkey-sdk` `zkRecovery/*`) + the frontend `prove()` worker + `poolSync`, submitting through the existing `relayerClient`. Contract addresses are resolved at runtime from the Stellar Registry (`unverified/zk-recovery`, `unverified/zk-verifier`) — no env/code change once the names are registered. Testnet instance is deployed with a SHORT timelock floor so e2e can drive the full lifecycle (mainnet keeps 7d/14d).

**Tech Stack:** Astro + TypeScript islands, `@nidohq/passkey-sdk` (M3 zkRecovery), `packages/frontend/src/lib/zk/prover.ts`, `@playwright/test`, stellar-cli 26 registry deploy.

## Global Constraints

- **Branch `zk-recovery-m4`**, stacked on `zk-recovery-m3` (PR base = `zk-recovery-m3`). Never touch main.
- **Registry** id `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S`; names published under `unverified/` prefix. Deploy identity: `ci-publisher-testnet` (funded, `GAGOFCVJTDXEBSBQWGRWE55IH4OUVNGHM6Y75WUCK5KMDVBHAYSYRRL7`). Network `testnet`, passphrase `Test SDF Network ; September 2015`.
- **zk-verifier `__constructor(vk_bytes: Bytes)`** — vk_bytes = the exact 1888-byte `circuits/zk_recovery/target/vk`. Record its sha256 in DEPLOYED.md.
- **zk-recovery `__constructor(factory: Address, verifier: Address, delay_secs: u64, completion_window_secs: u64, max_cancels: u32, timelock_floor_secs: u64, network_passphrase: Bytes, webauthn_verifier: Address)`.** Testnet-e2e params: `delay_secs=60`, `completion_window_secs=604800` (7d), `max_cancels=2`, `timelock_floor_secs=0` (lets e2e pick a tiny per-call timelock). Document these as TESTNET-ONLY (mainnet: delay 14d, floor 7d).
- **Address injection = registry only.** After deploy, register `zk-recovery`/`zk-verifier`; the factory's `create_account_v2` and the UI both resolve them at runtime via `policyChainFetch.ts::fetchRegistryAddress`. No `PUBLIC_*` address env var.
- **Fixed-id section convention** on Astro pages (`<section id="…">`, visibility via `.hidden`); mirror `new-account/index.astro` + `security/recover/index.astro`.
- **No secrets in localStorage or logs.** Overlay staging holds only the new-passkey pubkey + timing (SDK `stageRecovery`). BIP-39 words / wallet sigs never persisted.
- **Uniform tx shape at creation** — seed / wallet / skip all call `create_account_v2(salt, key, commitment)` with a real-or-dummy commitment; the on-chain tx shape is identical (M2 guarantee). Skip uses SDK `dummyCommitment(salt)`.
- Prover `prove(circuitName, inputs)` is async (worker); the SDK recovery tx builders are synchronous and take the resulting `proof` blob.

---

## Task 1: Testnet deploy of zk-verifier + zk-recovery (DEPLOY — outward-facing)

**Files:** Create `scripts/deploy-zk-recovery.sh`; modify `DEPLOYED.md` (fill the M4 placeholder table), `justfile` (add `publish-zk-recovery alias network="testnet"`).

**This task performs a REAL testnet deploy.** The controller runs it directly (not a fresh implementer) or supervises each network write.

- [ ] **Step 1: Build contracts** — `just build-contracts` (produces `target/wasm32v1-none/contract/nido_zk_verifier.wasm` + `nido_zk_recovery.wasm`).
- [ ] **Step 2: Write `scripts/deploy-zk-recovery.sh`** (mirror `scripts/deploy-policy-builder-v1.sh`), parameterized `ALIAS`/`NETWORK`, exporting `STELLAR_NETWORK`. Sequence:
  - Resolve `FACTORY=$(stellar registry fetch-contract-id factory --source-account $ALIAS)`, `WEBAUTHN=$(stellar registry fetch-contract-id verifier --source-account $ALIAS)` (the webauthn verifier the accounts already use — confirm the registry name; DEPLOYED.md calls it `verifier`).
  - `stellar registry publish --wasm nido_zk_verifier.wasm --wasm-name zk-verifier --binver <ver> --source-account $ALIAS`
  - Deploy zk-verifier with constructor: `stellar contract deploy --wasm nido_zk_verifier.wasm --source-account $ALIAS -- --vk_bytes <hex-of-vk-file>` → capture `ZKVERIFIER` C-address. (vk bytes passed as a file/hex; use `--vk_bytes-file-path` if the CLI supports it, else hex.)
  - `stellar registry publish --wasm nido_zk_recovery.wasm --wasm-name zk-recovery --binver <ver> --source-account $ALIAS`
  - Deploy zk-recovery with constructor args (factory, ZKVERIFIER, 60, 604800, 2, 0, network_passphrase bytes, WEBAUTHN) → capture `ZKRECOVERY`.
  - Register both names: `stellar registry register-contract --contract-name zk-verifier --contract-address $ZKVERIFIER --owner $ALIAS --source-account $ALIAS` (and zk-recovery).
  - Echo the two addresses + the vk sha256 + circuit json sha256.
- [ ] **Step 3: RUN it** — `just publish-zk-recovery ci-publisher-testnet testnet`. Verify each step's on-chain result (`stellar registry fetch-contract-id zk-recovery`).
- [ ] **Step 4: Sanity-check on-chain** — `stellar contract invoke --id $ZKRECOVERY -- current_root` returns the empty-tree root; `is_known_root` works. `stellar contract invoke --id $ZKVERIFIER` exists.
- [ ] **Step 5: Fill DEPLOYED.md** — real addresses in the M4 table, vk sha256, circuit json sha256, the testnet-only param note. Commit `deploy(zk): testnet zk-verifier + zk-recovery + DEPLOYED.md`.

**Note:** the factory currently registered may be a v1 that lacks `create_account_v2`/genesis-insert. If `create_account_v2` isn't on the live factory, either the factory needs a v2 repoint (out of M4 scope — flag) OR the UX enrollment falls back to the migration path (`enroll_zk_recovery` + `insert_for`) post-create. Determine which at deploy time and record it.

---

## Task 2: `zkRecoveryActions.ts` — frontend action layer

**Files:** Create `packages/frontend/src/lib/zkRecoveryActions.ts` + `zkRecoveryActions.test.ts`. Reference `packages/frontend/src/lib/recoveryActions.ts` (the mirror), `policyChainFetch.ts` (`fetchRegistryAddress`), `relayerClient.ts`, SDK `zkRecovery/*`, `lib/zk/prover.ts`.

**Interfaces (produce):**
- `enrollAtCreation(secret): Uint8Array` — thin wrapper → `commitmentForCreation(secret)` (used by the creation flow to get the `commitment` arg).
- `buildMigrationEnrollTx(account, secret): Promise<TxBuild>` — `insert_for` via SDK, for post-hoc enrollment.
- `syncPoolAndLocate(account, myStoredLeaf): Promise<{ index, siblings, bits, root } | null>` — fetch leaves from the pool-indexer (`PUBLIC_POOL_INDEXER_URL ?? default`), `mergeLeaves`, `verifyAgainstOnChainRoot` against on-chain `current_root` (resolve `zk-recovery` addr via registry), `locateLeaf`.
- `initiateZkRecovery({ account, mnemonicOrSig, method, newPubkey65 }): Promise<{ txHash, executableAfter }>` — derive secret, sync+locate leaf, assemble circuit inputs, `prove('zk_recovery', inputs)`, `buildInitiateRecovery(...)`, submit via relayer, `stageRecovery(...)`.
- `cancelZkRecovery({ account, ... }): Promise<string>` and `completeZkRecovery({ account, recoveryRuleId, newPubkey65, webauthnVerifierId }): Promise<string>` and `burnZkNullifier(...)`.
- `getZkPending(account): Promise<{ executableAfter, expiresAt } | null>` — read controller `get_pending`/`has_pending`.

**Constraints:** cancel/revoke build the circuit inputs with `action=2`/`3`, `timelockSecs=0`, `newPubkey65=null` (auth_hash zeroes pk fields) — the M3 carry-forward. Submit through `relayerClient` when `relayerEnabled()`, else self-submit. Stage only non-secret data.

- [ ] Test with mocked prover + mocked relayer + mocked registry/RPC: `initiateZkRecovery` assembles the right circuit inputs and calls the builder with the proof; `syncPoolAndLocate` rejects when rebuilt root ≠ on-chain root (trust-free); staging holds no secret. TDD, commit.

---

## Task 3: Creation flow — "Never get locked out" enrollment step

**Files:** Modify `packages/frontend/src/pages/new-account/index.astro`. Reference its fixed-id sections (`#passkey-section`, `#deploy-section`), `deploy()` (currently `create_account`).

- Add a `#recovery-enroll-section` (between passkey and deploy, or a card within): three choices — **Seed phrase** (generate a BIP-39 mnemonic via `@scure/bip39`, show it once, `deriveSecretM1`), **Wallet** (Stellar Wallets Kit `signMessage` on `m2Message(account, passphrase)`, `deriveSecretM2`), **Skip** (dummy). All three yield a `commitment: Uint8Array`.
- Switch `deploy()` to `create_account_v2(salt, key, commitment)` (if the live factory supports it — else create then `enroll_zk_recovery`+`insert_for` per Task 1's finding). Uniform tx shape.
- After deploy, show a recovery-card screen: which method was enrolled, "your seed is your backup — store it" copy (seed shown separately, never with the C-address).
- **Constraint:** the enrollment UI must produce a byte-identical tx shape across all three choices (only the commitment bytes differ) — this is the on-chain-invisibility guarantee. Do not branch the tx by method.

- [ ] Fast-lane Playwright coverage of the three choices' DOM states (Task 5). Manual/testnet exercise in Task 6. Commit.

---

## Task 4: Recovery ceremony `#zk` mode + pending banner + migration card

**Files:** Modify `packages/frontend/src/pages/security/recover/index.astro` (add a `zk` dispatch branch + `<section id="zk-mode">`), `packages/frontend/src/pages/security/index.astro` (pending banner + migration card).

- **`#zk-mode`** (triggered by `?zk=1` query or a mode toggle): fresh passkey (`navigator.credentials.create`, capture 65-byte pubkey) → secret entry (BIP-39 autocomplete OR wallet sign) → pool sync + leaf locate (progress) → `prove()` with progress → relayer-submitted `initiateZkRecovery` → timelock countdown (localStorage staging via SDK overlay; "don't clear site data" warning re the staged new-key pubkey) → `completeZkRecovery` when matured → cleanup. Section ids: `#zk-new-key`, `#zk-secret`, `#zk-sync`, `#zk-prove`, `#zk-initiate`, `#zk-countdown`, `#zk-complete`, `#zk-status`.
- **Pending banner** on `security/index.astro` (+ home if trivial): driven by `getZkPending(account)` — red banner with executable-after countdown + a Cancel button (fresh passkey + `action=2` cancel proof via `cancelZkRecovery`).
- **Migration card** on `security/index.astro`: for existing accounts, a visible `enroll_zk_recovery` + `insert_for` flow (honest "this is publicly visible" copy).

- [ ] Fast-lane Playwright of the DOM state machine + staging resume + cancel banner (Task 5). Commit.

---

## Task 5: Playwright FAST lane (stubbed prover + mocked pool)

**Files:** Create `tests/e2e/ui/zk-recovery.spec.ts` (tagged `@fast`). Reference `tests/e2e/ui/*.spec.ts`, `tests/support/fixtures.ts` (WebAuthn shim, `useIdentity`), `tests/support/server.mjs`.

- Stub `prove()` (inject `window.__ZK_PROVER_STUB__` returning a canned blob) and mock the pool-indexer fetch (route interception) + on-chain reads so no network/proving is needed.
- Cover: creation enrollment three-choice DOM; `#zk-mode` step machine (new-key → secret → sync → prove(stub) → initiate(mock submit) → countdown); staging resume after reload; pending banner shows + cancel path; the uniform-tx-shape assertion (all three creation choices build the same op shape, only commitment differs).
- [ ] Runs under `just test-e2e` (`--grep @fast`). Green. Commit.

---

## Task 6: Playwright TESTNET lane — real zk recovery e2e

**Files:** Create `tests/e2e/testnet/zk-recovery.testnet.spec.ts` (tagged `@testnet`). Also FIX the stale ids in `tests/e2e/testnet/recovery.testnet.spec.ts` (§8 grounding: it drives paste-back ids `#om-paste`/`#om-add-sig`/`#fm-blob` the relay-based page no longer exposes) — either update to the relay ids or mark clearly quarantined; do the minimal correct fix.

- Real chain (testnet), real deployed zk-recovery (Task 1, short timelock floor). Ceremony: create+enroll an account (seed method) → simulate loss → fresh passkey → derive same secret → pool sync → REAL browser `prove()` → initiate → wait `timelock_secs` (use a tiny value, e.g. 60s, allowed by floor=0) → complete → assert on-chain the new passkey signs.
- If live browser proving (bb.js WASM) can't run in this Playwright env, mark the proving assertion `test.fixme` with a clear reason and keep the rest (enroll + initiate with a pre-generated fixture proof) — document honestly.
- [ ] Wire under `just test-e2e-testnet` / `test-testnet.yml` (workflow_dispatch). Attempt a real run; record the result (pass / proving-blocked) in the PR. Commit.

---

## Task 7: CI gates — bench-zk + circuit-artifact reproducibility

**Files:** Modify `.github/workflows/test.yml`.

- Add a `bench-zk` step/job invoking `just bench-zk` + `just bench-zk-initiate` + `just bench-zk-guard` (the cost gates; they run off committed fixtures, no bb/Noir needed) so a budget regression fails CI as a named gate, not buried in `cargo test --workspace`.
- Add a circuit-artifact reproducibility check: a job (gated behind the pinned nargo/bb toolchain OR the repo Dockerfile) that runs `just gen-zk-fixtures` and `git diff --exit-code crates/integration-tests/fixtures/zk/manifest.json` — if the toolchain isn't available in CI, wire it as `workflow_dispatch` + document, don't fake it.
- [ ] YAML valid; the bench step passes on the committed fixtures. Commit.

---

## Task 8: Wallet-determinism matrix (HUMAN-GATED — prepare only)

**Files:** Create/complete `tests/spikes/wallet-determinism.md`.

- A ready-to-run checklist for a human tester: for each of Freighter / xBull / Albedo / Lobstr / Hana / Rabet — sign `m2Message(account, passphrase)` twice, assert byte-identical `sig64`, and verify `deriveSecretM2` reproduces the same secret; record pass/fail + wallet version.
- This CANNOT be automated (needs real extensions). Prepare the doc + a helper page/script; mark it as awaiting a human run.
- [ ] Commit the checklist; note in the PR it's pending a human ceremony.

---

## Self-Review notes (author)

- Human-gated boundaries stated explicitly: real wallet-determinism matrix (Task 8), and live browser proving in the testnet lane IF the WASM prover won't run headless (Task 6 fallback). Everything else is autonomously buildable + testable.
- The deploy (Task 1) is outward-facing and user-approved (deploy-now with ci-publisher-testnet). Testnet-only short-timelock params documented; mainnet params unchanged in the spec.
- Registry-resolution means no address hardcoding — the UX works the moment the names are registered.
- Open risk to flag in PR: the live factory may be a pre-v2 without `create_account_v2` — Task 1 determines whether creation-time enrollment works or falls back to migration.
