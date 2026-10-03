# Mainnet readiness

Go/no-go checklist. Every box is checked before mainnet. Perch's epic #99
leaves mainnet rollout out of its own scope, so a mainnet Perch deployment is
a prerequisite on top of everything here.

## A. Blockers

- [ ] **A1. Perch published and verified.** Done on testnet: Perch's release
  manifest records every contract by hash, `just perch-infra` fetches exactly
  those bytes, the factory embeds the manifest's `perch-account`, and
  `perch.TESTNET` is checked against the manifest. Left: Perch merges and
  publishes the release (crates, npm packages, `perch-contracts` bindings),
  Nido's pins move from the submodule to those, and a mainnet manifest
  exists. A `PUBLIC_PERCH_DEPLOYMENT` override is not yet checked against
  Perch's hashes (THREAT_MODEL 9).
- [x] **A2. Setup secret out of query strings.** The salt travels in the URL
  fragment and legacy query links are scrubbed on load (W5).
- [ ] **A3. Relayer keys in KMS/HSM.** Sponsor and channel keys no longer sit
  on disk; testnet keys rotated out.
- [ ] **A4. Mainnet registry and pins.** A Nido-owned registry instance
  (`scripts/deploy-registry.sh`, rehearsed on testnet), the factory's
  `REGISTRY` constant and client fallbacks pointed at it, and
  `set_registry_pins(<verifier>)` called.
- [ ] **A5. Audit findings resolved** for Nido and for Perch, with the freeze
  commits recorded in AUDIT_SCOPE.md.

## B. Governance

- [ ] **B1. Factory admin behind a multisig with a visible upgrade delay**
  (THREAT_MODEL 8), or the factory pins its verifier at build time. The
  passkey verifier itself is now Perch's, with no admin (THREAT_MODEL 7).
- [ ] **B2. Name-registry, policy, and registry-owner keys behind the
  multisig**, with alerts on any registry address change.

## C. Reproducible builds

- [ ] **C1. `stellar-cli` and `stellar-scaffold-cli` pinned** and the
  versions behind each deployed wasm recorded (they write themselves into the
  wasm metadata).
- [ ] **C2. One command rebuilds Nido's deployed wasm** and diffs the hashes
  against DEPLOYED.md. Perch's wasm is checked against the manifest's hashes
  (`just perch-infra`).
- [x] **C3. Proof fixtures reproduce in CI** byte for byte with Perch's
  checksum-pinned toolchain.

## D. Recovery operations

- [ ] **D1. The wallet restores archived recovery state** before a recovery
  transaction (RUNBOOKS §6). Today it only works while the state is live.
- [ ] **D2. Protected requires a baseline**, or the wallet makes the risk
  explicit (#220).
- [ ] **D3. Recovery state renewal runs on a schedule** (the permissionless
  `renew` calls, RUNBOOKS §6), or users are told how to renew.
- [~] **D4. The testnet suite passes against Perch's testnet release.** All
  six profile/mode combinations and the policy page's `apply_doc` pass
  through the wallet on testnet with real proofs and passkey signatures
  (2026-10-03, one clean run of seven specs, 20.5 minutes). Accounts were
  created with the relayer-free harness (`NIDO_E2E_DIRECT_DEPLOY=1`) because
  the hosted relayer refused onboarding ("Too many transactions queued").
  Left: the same run through relayer-sponsored onboarding.
- [ ] **D5. Non-ZK proofs assessed.** The ZK review answers whether a
  published proof leaks anything about the secret (THREAT_MODEL 13); if it
  might, the wallet prompts for a new kit after any proof whose attempt
  doesn't complete.
- [ ] **D6. Product calls made:** retire or port Nido's pre-Perch policies;
  retire `infra/recovery-relay`.
- [ ] **D7. The hosted relayer's onboarding queue.** It refused every
  account setup on 2026-10-03 while its health check passed; find out why
  before relying on it (RUNBOOKS §5).

## E. Hardening

- [ ] **E1. CSP enforced.** Promote the report-only CSP in
  `frontend/worker-proxy-nido/index.js` and `packages/frontend/public/_headers`
  after a clean report stream. `connect-src` must allow the RPC, the relayer,
  and the proving reference string's host.
- [ ] **E2. Stored credential material encrypted and expiring.**
- [ ] **E3. `status-message` excluded from mainnet.**
- [ ] **E4. The proving reference string self-hosted** with a checked hash
  instead of downloaded from `crs.aztec.network`.
- [x] **E5. The legacy query-parameter sign path validates the callback
  origin** (`signing/signRequest.ts`, `signRequest.test.ts`).
- [x] **E6. Relayer fairness and metrics:** per-IP bucket, Prometheus,
  alerts (RUNBOOKS §5).

## F. Tests

- [x] **F1. Enforcing-auth integration tests with real proofs** for every
  profile/mode combination, reconfiguration, cancellation, upgrades,
  archival, and budgets (SECURITY_INVARIANTS).
- [ ] **F2. The testnet Playwright lane gated in CI.**
- [ ] **F3. Property or fuzz tests** for the SDK's encodings and WebAuthn
  parsing.

## Cutover sequence

1. Everything above green on the frozen, audited commits.
2. Perch's mainnet deployment exists and its manifest verifies (A1).
3. Deploy the registry instance (A4) and, if needed, the WebAuthn verifier,
   with multisig admins (B1).
4. Build the factory around the published account wasm, deploy it, upload the
   account wasm, pin the verifier, register the factory (RUNBOOKS §2.2).
5. Relayer on KMS (A3), alerts live, incident drill run.
6. Front end built with the mainnet manifest; smoke-test onboarding and one
   full recovery.
7. Record everything in DEPLOYED.md.
