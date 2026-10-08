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
- [x] **C3. Proof fixtures reproduce in CI** with Perch's checksum-pinned
  toolchain: every re-proof verifies and no `fixture.json` changes (the
  proofs are zero-knowledge, so their bytes do).

## D. Recovery operations

- [ ] **D1. The wallet restores archived recovery state** before a recovery
  transaction (RUNBOOKS §6). Today it only works while the state is live.
- [ ] **D2. Protected requires a baseline**, or the wallet makes the risk
  explicit (#220).
- [ ] **D3. Recovery state renewal runs on a schedule** (the permissionless
  `renew` calls, RUNBOOKS §6), or users are told how to renew.
- [~] **D4. The testnet suite passes against Perch's testnet release.** All
  six profile/mode combinations and the policy page's `apply_doc` pass
  through the wallet on testnet with real proofs and passkey signatures,
  against Perch's 836fdc9 deployment (2026-10-07, one clean run of seven
  specs, 20.4 minutes), as they did against its 17f2c9c deployment earlier
  that day. The first run on 836fdc9 lost one completion to a wallet bug,
  since fixed: reading the chain tip decoded other people's protocol 27
  credentials (SUPPLY_CHAIN.md, npm). Accounts were created with the
  relayer-free harness
  (`NIDO_E2E_DIRECT_DEPLOY=1`): through the hosted relayer on 17f2c9c, the
  policy page and the two ZK-only combinations passed, and the other five
  were refused at onboarding ("Too many transactions queued"). Left: a full
  run through relayer-sponsored onboarding.
- [ ] **D5. The ZK verifier delta audited.** Proofs are zero-knowledge now,
  so they hide the secret, but Perch's `UltraKeccakZKFlavor` delta on the
  audited verifier is not audited yet (THREAT_MODEL 13); Perch lists that
  audit as a release criterion.
- [ ] **D6. Product calls made:** retire or port Nido's pre-Perch policies
  (#237); delete the recovery relay's deployed worker and KV namespace (its
  code is gone, #233).
- [ ] **D7. The hosted relayer's onboarding queue.** It refused every
  account setup on 2026-10-03, and five of seven on 2026-10-07 after
  accepting the first few, while its health check passed; find out why
  before relying on it (RUNBOOKS §5). Tracked in #236 (channels held under
  `skipWait`) and #235 (upgrading the relayer and its Channels plugin).
- [ ] **D8. The wallet on Perch's consumer interface**
  (stellar-registry/perch#108). The account refuses a document prepared at
  an older revision when the apply names it (A8), but the wallet's applies
  name none, so two edits prepared at once end with the later one
  overwriting the earlier. The same step reads account state through one
  snapshot, selects rules by name rather than scanning ids, and builds
  authorization payloads with perch-js. stellar-registry/perch#110's body
  lists every call site.

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
3. Deploy the registry instance (A4), its owner the multisig (B2). Nido
   deploys no WebAuthn verifier: accounts use Perch's, which is
   constructorless and has no admin, at the address the verified manifest
   gives (step 2).
4. Build the factory around the published account wasm, deploy it, upload the
   account wasm, pin the manifest's verifier (`set_registry_pins`), hand the
   factory to the multisig (B1), and register it (RUNBOOKS §2.2).
5. Relayer on KMS (A3), alerts live, incident drill run.
6. Front end built with the mainnet manifest; smoke-test onboarding and one
   full recovery.
7. Record everything in DEPLOYED.md.
