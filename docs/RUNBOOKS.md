# Operational Runbooks

Deploy, upgrade, key-rotation, and incident-response procedures for mainnet.
References existing tooling; fill in the multisig/KMS specifics as B1/A4 land.

## 1. Contract deployment (manual, post-audit)

Contract deploys are **manual and gated on audit sign-off** — never automated in CI
(only the frontend + workers deploy from CI). Standard flow:

1. **Approval:** an audit-approved commit + a signed-off change ticket. Record the git
   commit being deployed.
2. **Build reproducibly:** `just build-contracts` on the pinned toolchain (C2). Record the
   `stellar-cli` version and each wasm sha256.
3. **Deploy:** for the factory + smart-account use the deploy scripts
   (`scripts/deploy-zk-recovery.mjs`, `scripts/deploy-policy-builder-v1.sh` pattern). The
   scaffold-built ZK contracts must be deployed via the JS SDK (the `stellar` CLI fails with
   `Missing Entry Context` on their multi-`Address` constructors — see `DEPLOYED.md`).
4. **Verify address + hash:** confirm the deployed C-address and that the on-chain wasm hash
   matches the embedded/expected hash before creating any account.
5. **Preflight params:** run the config-assert script (A1/B2 tooling) — the live
   `delay/floor/window/passphrase/verifier` must match the mainnet spec.
6. **Register:** repoint the registry name (multisig-approved, §2).
7. **Smoke test:** invoke a read (`next_index`, `current_root`) + a full onboarding +
   recovery lifecycle against mainnet RPC.
8. **Record:** update `DEPLOYED.md` with addresses, params, wasm/VK/circuit hashes, deployer,
   and commit.

## 2. Registry repoint & upgrade governance (multisig)

The registry name → address mapping and the factory `set_recovery_pool`/`upgrade`/`set_admin`
knobs are the highest-leverage controls — a repoint silently changes the contract users trust.

- **Keys under multisig.** The registry-owner key, the factory admin, and each contract admin
  (post-B1) are multisig, not a single key.
- **Upgrade timelock.** `upgrade()` is timelocked so users can exit before it lands. Announce
  upgrades publicly with the new wasm hash + diff before the timelock elapses.
- **Change process:** GitHub issue + review → multisig proposal → timelock → execute → verify
  the new address/hash → update `DEPLOYED.md`. Every registry/admin change is monitored and
  alerts on unexpected address changes.
- **Pinning (pin bypass):** once the factory's `verifier`/`zk-recovery` pins are set
  (`set_registry_pins`), `resolve` returns the pinned address **directly and never consults the
  registry** — so a registry repoint can neither redirect **nor block** new-account creation, and
  the factory raises no error (there is **no** `RegistryMismatch`). Detection of a hostile repoint
  therefore relies on the external registry address-change monitor (above), not a factory-level
  revert. Pins change only via the admin multisig.

## 3. Key rotation

- **Deploy identity (`ci-publisher`):** rotate annually and after any team change. Store in
  the shared vault (1Password). Never in CI secrets for contract deploys.
- **Relayer sponsor + channel keys (A4):** managed by KMS/HSM. Rotation = provision new KMS
  key → update relayer signer config → re-fund → retire old key. Test rotation in staging.
- **Multisig signers:** documented roster; rotate a signer via the multisig itself; keep a
  quorum available at all times.

## 4. Relayer incident response

The relayer (`infra/relayer`, Fly.io) sponsors/submits txs. It cannot forge account auth, so
worst case is **censorship** or **sponsor-budget drain**, not theft.

- **Monitoring (to enable, E-task):** `METRICS_ENABLED=true`; alerts on health-check failures
  (3+ consecutive), fee-limit ≥80%, channel-pool unregistered, tx error rate >5%.
- **Outage:** redeploy via `deploy-relayer.yml` (GH action, loads Fly token from 1Password).
  Health endpoint: `https://nido.fly.dev/api/v1/health`. If down >30 min, notify affected users.
- **Budget exhaustion:** the OZ Channels plugin `FEE_LIMIT` caps daily spend (currently a
  single global bucket — replace with per-client fairness, E-task). On depletion, investigate
  the spend pattern before raising the limit; a single client exhausting it is the DoS this
  guards against.
- **Suspected key compromise:** rotate immediately (§3), redeploy, re-fund, and audit recent
  sponsored txs. Keys in KMS (A4) cannot be exfiltrated from the host.

## 5. ZK circuit / VK change

Changing the circuit (e.g. a new `log_n`) means a **new** `zk-verifier` (VK is immutable) and a
regenerated proof set:
1. Change circuit; bump `REQUIRED_NARGO_VERSION`/`REQUIRED_BB_VERSION` if the toolchain moves.
2. `just gen-zk-fixtures` on the pinned toolchain; the `zk-circuit-repro` CI job (Actions tab)
   confirms reproducibility.
3. Deploy a new `zk-verifier` with the new VK; register it; point the recovery pool at it.
4. Record new circuit/VK hashes in `DEPLOYED.md` + `manifest.json`.
