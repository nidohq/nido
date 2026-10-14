# Mainnet readiness

The gates between this revision and a mainnet launch, grouped by when each
must close: before the audit handoff, during the audit, and after it but
before mainnet. Shipped behaviour, open product questions, and optional
post-audit work are listed separately and are not gates. Checklist IDs are
stable and cited from the other audit documents; `[x]` is met, `[~]` partly
met, `[ ]` open.

Perch's specification puts mainnet rollout outside its own scope
([Perch recovery spec §1](https://github.com/stellar-registry/perch/blob/391477ff22edd64a2da326eb9a92a92813b8e65d/docs/recovery/spec.md#1-scope-and-vocabulary)
(`vendor/perch/docs/recovery/spec.md`)), so a mainnet Perch deployment is a
prerequisite on top of everything here (A1).

## 1. Audit-entry gates (before handoff)

- [ ] **G1. Audit manifest recorded** in [AUDIT_SCOPE.md](./AUDIT_SCOPE.md):
  full Nido and Perch source SHAs, the deployed build SHAs and wasm hashes,
  toolchains, package versions and integrities, and the audit date. No
  moving branch is the audit identity.
- [ ] **G2. Current limits stated and links reachable.** THREAT_MODEL's
  limits (L1-L6), the [STRIDE register](./STRIDE_THREAT_MODEL.md), and
  [DEFERRED.md](./DEFERRED.md) describe this revision, and every link into
  Perch is commit-pinned.
- [ ] **G3. The evidence index is reproducible.** Every suite
  SECURITY_INVARIANTS cites runs in a required CI job. The wallet's vitest
  suites and the SDK's outside `src/perch/` ("Unit (local)") run in none.
- [x] **C3. Proof fixtures reproduce in CI** with Perch's checksum-pinned
  toolchain: every re-proof verifies and no `fixture.json` changes (the
  proofs are zero-knowledge, so their bytes do) (SECURITY_INVARIANTS Z1).
- [x] **F1. Enforcing-auth integration tests with real proofs** for every
  profile/mode combination, reconfiguration, cancellation, upgrades,
  archival, and budgets (SECURITY_INVARIANTS).

## 2. During the audit, before sign-off

The audit covers the scope in [AUDIT_SCOPE.md](./AUDIT_SCOPE.md), including
the ZK verifier delta, the OZ fork's changes, factory authority
(THREAT_MODEL 8), the setup race (THREAT_MODEL 5, 10), and the integration
between Nido and Perch.

- [ ] **D5. The ZK verifier delta audited.** Proofs are zero-knowledge, so
  they hide the secret, but Perch's `UltraKeccakZKFlavor` delta on the
  audited verifier is not audited (THREAT_MODEL 13); Perch lists that audit
  as a release criterion.
- [ ] **A5. Audit findings resolved** for Nido and for Perch, with the
  resolving revisions in the audit manifest in AUDIT_SCOPE.md. A fix that
  changes contracts or signing behaviour is reviewed again at a new recorded
  baseline.

## 3. Launch gates (after the audit, before mainnet)

Every box here is checked before mainnet.

### Perch deployment and pins

- [ ] **A1. Perch's mainnet deployment published and verified.** A mainnet
  manifest records every Perch contract by hash and address and passes
  Perch's `verify-deployment.sh`; the factory embeds its `perch-account`;
  and the wallet's deployment is checked against it, a
  `PUBLIC_PERCH_DEPLOYMENT` override included (THREAT_MODEL 9). On testnet
  all of this holds except the override check: `just perch-infra` fetches
  exactly the manifest's bytes and `perch.TESTNET` is checked against the
  manifest (SECURITY_INVARIANTS W6). Moving Nido's remaining submodule pins to published Perch
  packages is [deferred](./DEFERRED.md#npm-publishing-of-perch-zk-and-the-contract-clients);
  such a move needs proof that the consumed code and artifacts are
  unchanged, which a version bump is not.
- [ ] **A4. Mainnet registry and pins.** A Nido-owned registry instance
  (`scripts/deploy-registry.sh`, rehearsed on testnet), the factory's
  `REGISTRY` constant and client fallbacks pointed at it, and
  `set_registry_pins(<verifier>)` called.

### Governance and keys

- [ ] **B1. Factory upgrade authority governed.** The factory admin is a
  multisig with an upgrade delay users can see, or the factory has no upgrade
  authority at all (THREAT_MODEL 8). Pinning the verifier, at build time or
  with `set_registry_pins`, does not meet B1: the admin's `upgrade` replaces
  the whole factory wasm, including the account code it embeds and the pin,
  and the admin can call `set_registry_pins` again. The passkey verifier
  itself is Perch's, with no admin (THREAT_MODEL 7).
  Note: the factory's `upgrade`/`set_registry_pins` are immediate on-chain
  (no timelock), so the delay is an off-chain multisig property only — an
  account created during a pending upgrade gets whatever code and pin are live,
  and the wallet does not currently verify the deployed account's wasm hash or
  rule-0 verifier against the manifest (AUDIT_SCOPE Q1). Meeting this gate
  means an on-chain schedule/execute delay in the factory **or** a
  post-`create_account` wallet check of the deployed output.
- [ ] **B2. Name-registry, policy, and registry-owner keys behind the
  multisig**, with alerts on any registry address change.
- [ ] **A3. Relayer keys in KMS/HSM.** Sponsor and channel keys are held in
  KMS/HSM, not on disk, and the testnet keys are rotated out.

### Account setup

- [ ] **A6. An account being set up cannot be claimed by someone else.**
  `create_account(salt, key)` is permissionless and the address derives from
  the salt alone, so whoever submits the salt first owns the address
  (THREAT_MODEL 10, L5; pinned by the factory test
  `whoever_submits_the_salt_first_owns_the_address`). Before the wallet
  activates a newly created account or moves any funds into it, it checks on
  chain that the account runs the manifest's `perch-account` wasm and that
  its only rule is the admin rule, scoped to the account, whose single
  signer is the user's new passkey under the pinned Perch WebAuthn
  verifier; on any mismatch it stops with an explicit failure that tells the
  user the address was taken, and never funds it. A reviewed mechanism that
  prevents the race (for example, a factory commitment to the key before
  the salt is revealed) meets A6 instead. Evidence: an adversarial setup
  test in which a front-runner creates the account first, and a test of the
  wallet's failure path. Tracked in nidohq/nido#245.

### Reproducible builds

- [ ] **C1. `stellar-cli` and `stellar-scaffold-cli` pinned** and the
  versions behind each deployed wasm recorded (they write themselves into the
  wasm metadata).
- [ ] **C2. One command rebuilds Nido's deployed wasm** and diffs the hashes
  against DEPLOYED.md. Perch's wasm is checked against the manifest's hashes
  (`just perch-infra`).

### Recovery operations

- [ ] **D1. The wallet handles archived recovery state** before a recovery
  transaction, for both responses RUNBOOKS §6 describes. Automatic restoration
  can already succeed: the submit paths (`recoverySubmit.ts`,
  `primaryPasskeySigner.ts`, `signing/submit.ts`) submit the `transactionData`
  the simulation returns, so a transaction the simulation marks for automatic
  restoration restores those entries when it fits the write limit. What is
  missing is the explicit path — the wallet checks only for a simulation error,
  never reads a `restorePreamble`, and never submits a `RestoreFootprint` or a
  bounded pre-restoration — so a recovery whose simulation asks for an explicit
  restore goes out without it (THREAT_MODEL L6). No live archival drill has been
  run.
- [ ] **D2. Protected requires a baseline**, or the wallet makes the risk
  explicit (nidohq/nido#220; THREAT_MODEL L1).
- [ ] **D3. Recovery state renewal runs on a schedule** (the permissionless
  `renew` calls, RUNBOOKS §6), or users are told how to renew.
- [~] **D4. The testnet suite passes against Perch's testnet release,
  onboarding included.** Met for recovery and policy: the six profile/mode
  combinations and the policy page's `apply_doc` pass through the wallet
  with real proofs and passkey signatures, with accounts created directly
  rather than through the relayer (SECURITY_INVARIANTS W8). Open: the same
  run with relayer-sponsored onboarding.
- [ ] **D7. The hosted relayer's onboarding queue.** It has refused most
  account setups in recorded testnet runs, sometimes after accepting the
  first few, while its health check passed; find out why before relying on
  it (RUNBOOKS §5). Tracked in #236 (channels held under `skipWait`) and #235
  (upgrading the relayer and its Channels plugin).
- [ ] **D9. Proving measured on reference devices.** In-page proving fits
  the client budgets in
  [Perch's budgets.md §1](https://github.com/stellar-registry/perch/blob/391477ff22edd64a2da326eb9a92a92813b8e65d/docs/recovery/budgets.md#1-proving-client)
  (`vendor/perch/docs/recovery/budgets.md`) on its mid-range phone and
  laptop. Only desktop numbers exist.

### Network and submission

- [ ] **N1. One manifest-bound network configuration.** Every client, signer,
  asset lookup, and RPC reads the network, passphrase, and endpoints from a
  single mainnet manifest. Today `packages/frontend/src/lib/network.ts` and
  `packages/frontend/src/lib/recovery/deployment.ts` hard-code testnet. Wiring
  mainnet is a code change outside the audited snapshot's assurance; it needs a
  delta review before launch.
- [ ] **N2. A funded mainnet submission path for permissionless recovery.**
  Recovery completion and the permissionless `renew` calls rely on testnet
  Friendbot for a fee source. Mainnet needs a funded fee-payer (or relayer
  sponsorship) for these calls, reviewed with N1, plus a recovery smoke test
  from a fresh browser on mainnet.

### Hardening

- [ ] **E1. CSP enforced.** Promote the report-only CSP in
  `frontend/worker-proxy-nido/index.js` and `packages/frontend/public/_headers`
  to enforcing. `connect-src` must allow the RPC, the relayer, and the proving
  reference string's host; the report-only policy does not list
  `crs.aztec.network`. Both copies are `Content-Security-Policy-Report-Only`
  with no `report-uri`/`report-to`, so there is no report stream to judge
  "clean" — violations surface only in each user's console. Gate promotion on
  an end-to-end run of the full onboarding, signing and in-page ZK-proving
  flows under the **enforced** policy with zero violations (and, if an ongoing
  report stream is wanted, add a `report-to`/`report-uri` endpoint to both
  copies first).
- [ ] **E2. Stored credential material encrypted and expiring.**
- [ ] **E3. `status-message` excluded from mainnet.**
- [ ] **E4. The proving reference string self-hosted** with a checked hash
  instead of downloaded from `crs.aztec.network`.
- [ ] **E7. The wallet states what the freeze and spending caps do not
  cover:** a `Protected` freeze does not revoke allowances the account
  granted earlier (THREAT_MODEL L2), and replacing a capped rule or changing
  its cap starts a fresh window (THREAT_MODEL L3).

### Tests

- [ ] **F2. The testnet Playwright lane gated in CI.**
- [ ] **F3. Property or fuzz tests** for the SDK's encodings and WebAuthn
  parsing.

## 4. Shipped behaviour

Met, with their evidence; kept here so their IDs stay resolvable.

- [x] **A2. Setup secret out of query strings.** The salt travels in the URL
  fragment and legacy query links are scrubbed on load (W5).
- [x] **D8. The wallet on Perch's consumer interface.** Every wallet apply
  names the revision its document was composed from, so the later of two
  edits prepared at once is refused instead of overwriting the earlier
  (SECURITY_INVARIANTS A8).
  Rules are selected from `configuration()` rather than by scanning ids
  (SECURITY_INVARIANTS W10), and digests and auth payloads come from perch-js. dApp requests
  build their `apply_doc` on the sign page, outside `applyDocument`,
  carrying the request's revision.
- [x] **E5. The legacy query-parameter sign path validates the callback
  origin** (`signing/signRequest.ts`, `signRequest.test.ts`).
- [x] **E6. Relayer fairness and metrics:** per-IP bucket, Prometheus,
  alerts (RUNBOOKS §5).

## 5. Open product questions

- [ ] **D6. Product calls made:** retire or port Nido's pre-Perch policies
  (nidohq/nido#237); a policy kept for mainnet enters the audit scope.
  Delete the recovery relay's deployed worker (`relay.nido.fyi`) and KV
  namespace; no code in this tree calls them.
- Whether `Protected` requires a baseline (nidohq/nido#220) is decided under
  D2.

## 6. Optional post-audit evolution

Not gates. Each item's current behaviour is part of the audited system; its
entry in [DEFERRED.md](./DEFERRED.md) gives the owner, residual risk, exit
criterion, and the review an adopted change needs, proportional to the trust
boundary it changes.

- [CANON v2 structured document identity](./DEFERRED.md#canon-v2-structured-document-identity)
- [Versioned policy backend and larger limits](./DEFERRED.md#versioned-policy-backend-and-larger-limits)
- [Revision-bound ordinary signatures](./DEFERRED.md#revision-bound-ordinary-signatures) (THREAT_MODEL L4)
- [Stable numeric rule IDs](./DEFERRED.md#stable-numeric-rule-ids)
- [Persistent spending budgets across replacements](./DEFERRED.md#persistent-spending-budgets-across-replacements) (THREAT_MODEL L3)
- [Additional formal models](./DEFERRED.md#additional-formal-models)
- [OZ quiet-events fork pull requests](./DEFERRED.md#oz-quiet-events-fork-pull-requests)
- [npm publishing of perch-zk and the contract clients](./DEFERRED.md#npm-publishing-of-perch-zk-and-the-contract-clients)
- [Registry import-macro migration](./DEFERRED.md#registry-import-macro-migration)

## Cutover sequence

1. Every launch gate checked on the frozen, audited commits.
2. Perch's mainnet deployment exists and its manifest verifies (A1).
3. Deploy the registry instance (A4), its owner the multisig (B2). Nido
   deploys no WebAuthn verifier: accounts use Perch's, which is
   constructorless and has no admin, at the address the verified manifest
   gives (step 2).
4. Build the factory around the published account wasm, deploy it, upload the
   account wasm, pin the manifest's verifier (`set_registry_pins`), hand the
   factory to the multisig (B1), and register it (RUNBOOKS §2.2).
5. Relayer on KMS (A3), alerts live, incident drill run.
6. Front end built with the single mainnet manifest (N1), with a funded
   recovery submission path (N2); smoke-test onboarding and one full recovery
   from a fresh browser.
7. Record everything in DEPLOYED.md.
