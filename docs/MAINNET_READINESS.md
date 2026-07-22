# Mainnet Readiness — Go / No-Go Checklist

Every box must be checked before mainnet launch. Grouped by the workstreams in the
audit-readiness plan. "Blocker" = launch cannot proceed without it.

## A. Hard blockers

- [ ] **A1 — ZK recovery params (BLOCKER).** Fresh mainnet pool deployed with
  `delay_secs=1_209_600` (14d), `timelock_floor_secs=604_800` (7d),
  `completion_window_secs=2_592_000` (30d). Params are immutable at construction; the
  testnet pool uses 60s/0/604800 and cannot be reused. Verified by the preflight script
  reading the live `config` (B2/A tooling).
- [ ] **A1 — Mainnet circuit VK regenerated.** VK/proof fixtures regenerated under the
  pinned toolchain against the **mainnet network passphrase** and 14d timelock (both are
  bound into `auth_hash`); testnet proofs/VK do not carry over. Hashes recorded in
  `DEPLOYED.md`.
- [ ] **A2 — `G_temp` secret off URL query params (BLOCKER).** Onboarding no longer passes
  the funding secret via `?key=`; it uses a non-logged channel (hash fragment /
  sessionStorage) cleared after deploy. Verified: never in history/referrer/worker logs.
- [ ] **A3 — Mainnet registry wired.** Factory `REGISTRY` constant + all client fallbacks
  (`passkey-sdk/src/registry.ts`, `frontend/src/lib/policyChainFetch.ts`) point at the
  chosen mainnet registry; rebuilt + tested against mainnet RPC.
- [ ] **A4 — Relayer keys in KMS/HSM (BLOCKER).** Sponsor + channel keys no longer live as
  on-disk keystores; migrated to a KMS/HSM signer; testnet keys rotated out.

## B. Architecture freeze (before audit)

- [x] **B1 (code) — admin + upgrade() implemented across the contract set** (issue #26):
  `smart-account` (self-authed, **blocked while a recovery is pending**), `factory`,
  `zk-verifier` (VK stays immutable), `zk-recovery`, `webauthn-verifier`, `multisig-policy`,
  `spending-limit-policy`, `name-registry` — each with `admin`/`set_admin`/`upgrade`, the admin
  set via `__constructor(admin: Address)`. Fresh deploys pass `--admin` (see
  `scripts/deploy-policy-builder-v1.sh`, `scripts/deploy-zk-recovery.mjs`).
- [ ] **B1 (governance) — admin behind a multisig, `upgrade` behind a timelock.** The mainnet
  `--admin` must be a multisig C-address (not the deploying key), ideally with an upgrade
  timelock so users can exit before an upgrade lands. `zk-verifier` VK intentionally immutable
  (a circuit change still means a fresh verifier deploy + re-register, never an in-place VK swap).
- [ ] **B2 — Registry address pinning.** Factory reverts `RegistryMismatch` if the registry
  resolves to a non-pinned verifier/zk-recovery address; registry + `set_recovery_pool`
  keys under multisig; change-monitoring/alerts in place.

## C. Reproducible builds & provenance

- [ ] **C1 — bb pinned + guarded** (done; verify `manifest.json` shows `bbRequired`).
- [ ] **C2 — Rust toolchain + `stellar-cli` pinned**; every deployed wasm hash re-derivable.
- [ ] **C2 — Reproducibility attestation.** One command rebuilds all deployed wasms + circuit
  VK and diffs against `DEPLOYED.md`/`manifest.json`; result is byte-identical.
- [ ] **C3 — Vendor provenance recorded** + drift check extended to the vendor `Cargo.toml`.

## D. Audit-prep documents

- [x] AUDIT_SCOPE.md, THREAT_MODEL.md, SECURITY_INVARIANTS.md, SUPPLY_CHAIN.md,
  MAINNET_READINESS.md, RUNBOOKS.md drafted.
- [ ] Freeze commit recorded in AUDIT_SCOPE.md.
- [ ] OZ repinned to a tagged release, or risk documented + accepted.

## E. Security hardening

- [ ] Strict CSP + security headers (frame/content-type/referrer) live at Pages + worker proxy.
- [ ] Legacy query-param sign path validates callback/return origin (no signature exfiltration).
- [ ] `expirationOffset`/`relayerEnabled` centralized with a parity test.
- [ ] localStorage credential material encrypted + expiring.
- [ ] Relayer per-client fee fairness; metrics + alerts; incident-response playbook.
- [ ] Vendored verifier returns structured errors on malformed/truncated proofs.
- [ ] Storage TTL/archival empirically validated across the 44-day active window (invariant T1).
- [ ] `status-message` demo typo fixed + redeployed, or explicitly excluded from mainnet.

## F. Test coverage

- [ ] Vendored UltraHonk verifier tests un-excluded from CI (fixtures vendored).
- [ ] Negative tests: forged proof, double-spend nullifier, wrong-network, timelock-not-elapsed,
  unauthorized mutation, malformed proof, `execute` abuse, salt reuse, i128 overflow.
- [ ] Property/fuzz tests for Merkle/Poseidon/low-S.
- [ ] Testnet e2e Playwright lane un-quarantined (or CI-gated).
- [ ] Full recovery-lifecycle test running under mainnet params.

## Cutover sequence (release day)

1. Confirm B/C/D/E/F all green on the frozen, audited commit; audit findings applied.
2. Deploy contracts fresh with mainnet params (A1) + mainnet registry (A3); multisig admin (B1).
3. Regenerate + register mainnet VK (A1); wire zk-verifier/zk-recovery in the mainnet registry.
4. Run the **preflight config-assert script** → must pass before any user account is created.
5. Relayer on KMS (A4); alerts firing; run the incident-response drill.
6. Frontend on mainnet config (A2/A3); smoke-test onboarding + a full recovery lifecycle.
7. Update `DEPLOYED.md` with mainnet addresses, params, wasm/VK/circuit hashes.
