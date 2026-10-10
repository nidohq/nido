# PR #234: Nido and Perch audit review

Reviewed 10 October 2026. Scope: [Nido PR #234](https://github.com/nidohq/nido/pull/234),
its pinned Perch dependency, and the corresponding Perch audit materials.

**Assessment: not ready for a standalone audit handoff.** The package captures the main
architecture, but two security-relevant release-gate errors, contradictory Perch semantics,
unreachable references, and stale evidence prevent it from serving as one concise audit reference.
There are six confirmed findings: two P1 and four P2.

This document records the review and recommended corrections. Proposed deferrals are recommendations,
not approved scope decisions. The implementation at the revisions below is the baseline all active
technical documentation should describe. Documentation should state present behavior, guarantees,
limitations, and evidence without requiring a reader to reconstruct development history.

## Reviewed revisions

| Material | Revision |
| --- | --- |
| Nido PR head | `0626703cb10310ba376b5ccc586705654d5399e8` |
| Nido comparison base | `882b4474b04fea748e56c482725eb6ffb62f7bc5` |
| Perch submodule source | `bb746f9d03c593f0d5a2518c6900e00c938f95ec` |
| Perch main also checked | `95b9f840402905a5ebfec07aa63ab3fbf599dd94` |
| Perch deployed build recorded in the materials | `7ae915dc1ac6ae36cacf6db87794b056923d3b1f` |

Perch's documentation is unchanged between the pinned source and the checked main; the intervening
release changes package version, lockfile, and changelog material. Source identity and deployed
artifact provenance must remain distinct in the audit manifest. Source links below pin the reviewed
revisions rather than moving branches.

## Findings

P1 identifies a security-relevant release-gate error. P2 identifies inaccurate or unusable audit
material. Perch findings apply to both the pinned dependency and the checked Perch main.

### F1 — [P1] Nido: A pinned verifier does not replace factory governance

The mainnet checklist permits either a multisig with an upgrade delay *or* a verifier pinned at
build time. The factory admin can still replace the entire factory Wasm, including its embedded
account and verifier logic. Hardcoding a verifier alone therefore cannot satisfy the stated
protection against a compromised factory admin.

**Correction:** Require governance over factory upgrades independently of verifier pinning. An alternative must
remove the relevant upgrade authority, not merely move the verifier address into the binary.

**Sources:** [docs/MAINNET_READINESS.md:31](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/MAINNET_READINESS.md#L31) · [Factory upgrade implementation](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/contracts/factory/src/contract.rs#L82) · [Threat model 8](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/THREAT_MODEL.md#L77)

### F2 — [P1] Nido: The setup-account takeover risk has no mainnet gate

The threat model says a compromised relayer can use the setup salt to create the account with its
own passkey, and the wallet does not verify the admin before activation or funding. Yet the go/no-go
checklist can be completed without resolving issue #245: A2 only removes query-string exposure, and
D7 only addresses queue availability.

**Correction:** Add a specific release gate for verifying the created account’s code, expected admin key and
verifier before activation or funding, or a reviewed prevention mechanism. Include an adversarial
setup test and an explicit failure path. The current risk belongs in the audit; its mitigation
cannot be silently treated as completed.

**Sources:** [docs/THREAT_MODEL.md:97](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/THREAT_MODEL.md#L97) · [Checklist A2](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/MAINNET_READINESS.md#L18) · [Open issue #245](https://github.com/nidohq/nido/issues/245)

### F3 — [P2] Perch: The authoritative recovery material contradicts itself

Spec §3.4 says both account and controller reject a changed ZK factor with a reused enrollment ID.
The same section then says the controller does not raise that error and that adding the check is
deferred. The pinned controller already performs the check. Separately, the ZK README describes
nullifier reservations, while spec §11 and the implementation use only unspent/spent state.

**Correction:** Delete the obsolete §3.4 deferral and align every description with the existing controller check.
Replace reservation/release language in the ZK README with the current per-account spent-nullifier
semantics. These are documentation corrections to the audit baseline.

**Sources:** [Spec: current requirement](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L236) · [Spec: contradictory deferral](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L263) · [Controller check](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/crates/perch-recovery/src/contract.rs#L1173) · [Obsolete reservation claim](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/zk/README.md#L8)

### F4 — [P2] Nido: The reading order links into an unreadable GitHub submodule path

The recovery-spec link resolves within the Nido repository to vendor/perch/docs/recovery/spec.md.
GitHub returns HTTP 404 for that nested submodule path. The equivalent URL in the Perch repository
at the recorded submodule commit returns HTTP 200. An auditor following the PR on GitHub cannot
reach the source of truth from the supplied reading order.

**Correction:** Use full, commit-pinned Perch repository links for cross-repository documents. Retain local checkout
paths as supplementary build references. Apply the same rule to spec, implementation, deployment
manifest and ZK links throughout the package.

**Sources:** [docs/AUDIT_SCOPE.md:17](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/AUDIT_SCOPE.md#L17) · [ARCHITECTURE.md:22](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/ARCHITECTURE.md#L22) · [Working pinned spec URL](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L1)

### F5 — [P2] Nido: The authorization invariant omits the recovery write path

A2 states that only the admin rule changes the document. Recovery completion intentionally changes
it through the zero-signer recovery rule. Its cited test checks that a device key cannot satisfy the
selected admin rule; it does not prove the universal claim. The architecture also says __check_auth
never reads another contract, although verifier and policy calls run beneath it; only the freeze
lookup is local.

**Correction:** State the two authorization paths precisely: an authorized ordinary apply, subject to recovery
gates, or the authorized recovery completion of the derived target. Narrow the cross-contract
statement to the freeze-mirror lookup. Preserve separate evidence for rejection of an unrelated
device key and successful recovery completion.

**Sources:** [docs/SECURITY_INVARIANTS.md:73](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/SECURITY_INVARIANTS.md#L73) · [Cited test’s actual scope](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/crates/integration-tests/tests/it/account.rs#L149) · [ARCHITECTURE.md:181](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/ARCHITECTURE.md#L181) · [Perch entry-point authorization](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L1359)

### F6 — [P2] Perch: The implementation-to-test map describes a superseded reconciler

The implementation map describes batch_add_signer and event-byte pricing, then cites two crossover
tests that do not exist in the pinned Rust sources. The current reconciler uses
reconcile_signers_no_events; event prices are zero and the selection is driven by writes. The same
document later describes parts of the current algorithm, leaving two competing explanations.

**Correction:** Rewrite the delta-apply description once around the current implementation, and replace obsolete
crossover claims and test names with the actual suite. Retain the invariant that final authorization
matches a full replacement and that failed applies roll back.

**Sources:** [Superseded algorithm](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/implementation.md#L133) · [Missing test references](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/implementation.md#L268) · [Current cost model](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/crates/perch-smart-account/src/rules.rs#L219) · [Current signer-swap cases](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/crates/integration-tests/tests/apply_delta.rs#L831)

The missing test references are:

- `rotating_the_admin_rules_keys_switches_to_replacement_where_it_is_cheaper`
- `rotating_a_capped_rules_keys_switches_to_replacement_where_it_is_cheaper`

## Current baseline for all documentation

### Components and authority

Nido deploys an upgradeable factory that creates Perch accounts with a passkey admin. Perch supplies
the immutable compiler, policies, verifier, recovery controller, ZK pool, and adapter. A user's
account has an owner-authorized upgrade path with a 120,960-ledger delay. Immutable infrastructure
is adopted through new builds or recovery configuration, as appropriate.

### Document and authorization

CANON v1 defines document identity. `apply_doc` installs the complete declared configuration through
an atomic delta. The wallet binds document writes to the configuration revision. Ordinary
transactions bind their invocation and selected rule IDs, not a revision. Limits are 8 declared
signers, 11 document rules, 8192 canonical bytes, and 20-byte rule names. The generated recovery rule
is additional to the document-rule limit.

### Recovery

GuardianOnly, ZkOnly, and Combined work with Loss or Protected. Evidence binds one controller-built
statement. The controller derives the target; completion applies exactly that target, revokes
replaced or removed credentials, advances recovery state, and spends the ZK nullifier when
applicable. No nullifier is reserved. Both account and controller reject a changed ZK factor that
reuses its enrollment ID.

### Limits within the audited behavior

Protected without a baseline does not provide the same compromise protection. The freeze blocks
new account authorizations, not token allowances already granted elsewhere. Replacing a spending
policy resets its window. The setup-salt race is unresolved, and the wallet lacks the complete
archived-state restoration and renewal workflow. These limitations must be visible without reading
an issue discussion.

**Sources:** [ARCHITECTURE.md:94](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/ARCHITECTURE.md#L94) · [docs/recovery/spec.md:1380](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L1380) · [docs/recovery/spec.md:975](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L975) · [docs/recovery/spec.md:860](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L860)

## Cross-repository documentation alignment

Concision must preserve failure modes, exact encodings, proof assumptions, and evidence provenance.
Each fact should have one authoritative home. No reader should need a sequence of PRs to identify
current behavior.

### Shared audit identity

**Observed:** Nido scope leaves the freeze TBD; Perch scope says the merged commit does not exist and gives a
branch-by-branch reading order.

**Required standalone version:** Record one audit manifest: full Nido and Perch source SHAs, deployed build SHA, Wasm hashes,
toolchains, package versions/integrities and audit date. Distinguish reviewed source from deployment
provenance. Retain no moving branch as the audit identity.

**Sources:** [docs/AUDIT_SCOPE.md:6](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/AUDIT_SCOPE.md#L6) · [docs/audit-scope.md:12](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/audit-scope.md#L12)

### Scope ownership

**Observed:** Nido puts admin-sep under “Out of scope” but asks the auditor to read it in full. Nido includes
perch-js/perch-zk while Perch excludes JS and deployment machinery from both contract audit units.

**Required standalone version:** Use one responsibility matrix: Nido integration and browser review; Perch core; Perch OZ
materialization; explicit dependency review. Assign admin-sep, all three OZ fork deltas, the ZK
verifier delta, consumed JS and artifact-selection scripts to an owner or a named exclusion. The two
Perch units are a useful boundary, not a guarantee that a later backend needs no integration review.

**Sources:** [docs/AUDIT_SCOPE.md:127](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/AUDIT_SCOPE.md#L127) · [docs/AUDIT_SCOPE.md:93](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/AUDIT_SCOPE.md#L93) · [docs/audit-scope.md:101](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/audit-scope.md#L101)

### Nido architecture and threat model

**Observed:** Mostly describes the current integration, but still uses workstream labels and dated incidents; some
security claims are broader than their conditions.

**Required standalone version:** Keep components, trust boundaries, onboarding, authorization and recovery. State current
constraints: optional Protected baseline, setup race, existing token allowances surviving the
freeze, document-only revision checks and cap resets. Link each risk to its invariant and release
gate.

**Sources:** [ARCHITECTURE.md:85](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/ARCHITECTURE.md#L85) · [docs/THREAT_MODEL.md:110](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/THREAT_MODEL.md#L110) · [docs/recovery/spec.md:975](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L975)

### Nido evidence and readiness

**Observed:** D4 narrates multiple deployments, dates, failures and fixes. W8 repeats test-run history. Mainnet
readiness mixes shipped behavior, open product questions and operational gates.

**Required standalone version:** Keep one evidence row per claim: test or report, exact revision/artifact, environment, result and
limitation. Record the current result: six recovery combinations plus policy apply passed with
direct deployment; full hosted-relayer onboarding remains unproven. Use separate audit-entry and
launch gates.

**Sources:** [docs/MAINNET_READINESS.md:57](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/MAINNET_READINESS.md#L57) · [docs/SECURITY_INVARIANTS.md:241](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/SECURITY_INVARIANTS.md#L241)

### Nido deployment and supply chain

**Observed:** Current hashes are recorded, but active, fallback and retired deployments share one long document.
Package-migration promises are repeated across several documents.

**Required standalone version:** Keep active deployment provenance in the audit pack. Put still-reachable fallback addresses in a
clearly scoped compatibility appendix. Remove the historical deployment catalog from the reading
path. State current pins once; put future package migration in the deferral register.

**Sources:** [DEPLOYED.md:63](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/DEPLOYED.md#L63) · [DEPLOYED.md:78](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/DEPLOYED.md#L78) · [docs/SUPPLY_CHAIN.md:18](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/SUPPLY_CHAIN.md#L18)

### Perch spec

**Observed:** The normative spec includes a decision summary, old-schema differences, evaluated adapter options,
issue maps and obsolete deferrals.

**Required standalone version:** Keep current schema, state transitions, evidence, authorization matrix, storage semantics,
invariants, ABI and limits. Preserve stable anchors used by Nido, but remove alternatives and
implementation chronology. Resolve F3 before calling it authoritative.

**Sources:** [docs/recovery/spec.md:31](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L31) · [docs/recovery/spec.md:1168](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L1168) · [docs/recovery/spec.md:1427](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L1427)

### Perch recovery folder

**Observed:** Six pre-spec documents remain in the main recovery folder, explicitly retained for reasoning. Some
repeat obsolete topology and migration constraints.

**Required standalone version:** Consolidate any still-current requirement into the spec. Remove these six documents from the active
audit package; keep history in Git or a clearly excluded archive. Do not make auditors reconcile old
and new designs.

**Sources:** [docs/recovery/README.md:34](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/README.md#L34)

### Perch benchmarks and ZK package

**Observed:** budgets.md opens as a stub and includes old Nido numbers and TBD tables, then supplies current
measurements. The ZK README still calls full-transaction measurements open.

**Required standalone version:** Publish one current results table with measured, unmeasured and required-before-launch states. Keep
source/artifact provenance and testnet vs in-process distinctions. Reference-device proving remains
open; completed full-transaction results should not remain labeled future work.

**Sources:** [docs/recovery/budgets.md:3](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/budgets.md#L3) · [docs/recovery/budgets.md:145](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/budgets.md#L145) · [docs/zk/README.md:44](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/zk/README.md#L44)

### Assurance boundaries

**Observed:** Perch’s formal coverage statement clearly excludes runtime recovery, account authorization, circuit,
adapter and pool from the Lean model.

**Required standalone version:** Keep that boundary prominently. Separate proof about canonical encodings from empirical Rust/Lean
parity, contract tests and cryptographic audit. Remove the historical account of how coverage grew;
preserve what is and is not established today.

**Sources:** [docs/recovery/formal-verification-impact.md:49](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/formal-verification-impact.md#L49) · [docs/recovery/formal-verification-impact.md:82](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/formal-verification-impact.md#L82)

### All other documentation

**Observed:** Perch README still says “design phase” and describes cap lowering as future work. Nido’s README
links SCF application notes that describe removed Nido-owned account/verifier contracts.

**Required standalone version:** Sweep every public entry point, package guide and operational reference for current-state claims.
Keep genuine historical project records explicitly outside the technical audit reading order. “All
documentation aligns” must include these entry points, not only the new audit files.

**Sources:** [README.md:23](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/README.md#L23) · [docs/APPLICATION.md:33](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/APPLICATION.md#L33) · [README.md:179](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/README.md#L179)

## Recommended post-audit deferrals

Use this PR and its pinned Perch dependency as the audit target. The following implementation work
can remain outside that target; its current consequences belong in the audit documents.

**Decision status:** [Perch RFC #109](https://github.com/stellar-registry/perch/issues/109) was an open
discussion at review time, with proposed conclusions and no comments recording acceptance. These
are recommended scope declarations grounded in the implementation. Consumer views, two-digest
target binding, and the optional `apply_doc` revision check are already implemented and must not be
described as deferred.

### CANON v2 / structured document identity

**Proposed owner:** Perch.

**Current behavior to audit:** Retain SHA-256 of CANON v1 canonical bytes and current fragment hashes. The two-digest recovery
binding is already implemented.

**Consequence and follow-up:** A later identity change needs a new compiler/account build, re-application and renewed baseline
approval; Protected accounts need their recovery condition. Review the changed identity and
integration surfaces.

**Sources:** [docs/recovery/spec.md:505](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L505)

### Versioned policy backend and larger limits

**Proposed owner:** Perch + Nido.

**Current behavior to audit:** Retain OZ materialization and current caps: 8 declared signers, 11 document rules, 8192 canonical
bytes; the generated recovery rule is additional.

**Consequence and follow-up:** Treat a replacement backend as a separately scoped change with regression evidence across
authorization, recovery and migration. Decide support for existing funded accounts before mainnet.

**Sources:** [docs/recovery/spec.md:804](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L804)

### Revision-bound ordinary signatures

**Proposed owner:** Perch + consumers.

**Current behavior to audit:** Keep expected_revision on apply_doc. Ordinary signatures bind the invocation and rule IDs; a
retained rule ID is evaluated under its content at inclusion.

**Consequence and follow-up:** Changing this requires new signing semantics, capability discovery and updated wallet/dApp/session
signers. Document current behavior now; do not claim document-write revision safety applies to every
transaction.

**Sources:** [docs/recovery/spec.md:1380](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L1380)

### Stable numeric rule IDs

**Proposed owner:** Perch.

**Current behavior to audit:** Consumers select by name, scope and credential from configuration(). Replaced rules receive new IDs.

**Consequence and follow-up:** Define rename, recreation, restoration and signature validity before promising numeric stability.
Keep those promises out of the current audit contract.

**Sources:** [docs/SECURITY_INVARIANTS.md:262](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/SECURITY_INVARIANTS.md#L262)

### Persistent spending budgets across replacements

**Proposed owner:** Perch + Nido.

**Current behavior to audit:** Retained policies retain state. Replacing a rule or reinstalling its spending policy resets its
spending window; a compromise restore may grant a fresh window to retained baseline signers.

**Consequence and follow-up:** A persistent budget needs new schema/policy/state semantics and its own audit. Add the current reset
behavior to Nido’s threat model and user-facing cap explanation now.

**Sources:** [docs/recovery/spec.md:860](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/spec.md#L860)

### Additional formal models

**Proposed owner:** Perch.

**Current behavior to audit:** Keep existing canonicalization and interpreter proof claims within their stated coverage. Recovery
state machine, account auth and ZK components have no formal model.

**Consequence and follow-up:** Broader formal verification can be separate work. It does not replace the requested review of those
presently implemented runtime paths.

**Sources:** [docs/recovery/formal-verification-impact.md:82](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/formal-verification-impact.md#L82)

Every accepted deferral needs five fields: owner, current behavior, residual risk, exit criterion,
and required follow-up review. Moving submodule dependencies to published packages is packaging work
only if the consumed code and artifacts are proved equivalent; a version bump is not that proof.

## Audit and launch gates

### Before audit handoff

Fix factual contradictions and unreachable links; record exact revisions and audit ownership; state
current limitations and known risks; provide a reproducible evidence index.

### During audit / before sign-off

Review the ZK verifier delta, full OZ fork changes, factory authority, setup race and
cross-repository integration. Findings that change contracts or signing behavior require an updated
review baseline.

### After audit, before mainnet

Close setup-takeover mitigation and factory governance; resolve Protected-baseline UX; implement or
validate archived-state restoration and renewal; verify hosted-relayer onboarding, KMS, CSP and
deployment overrides; finish reference-device proving measurements and required
supply-chain/reproducibility gates.

### After audit, optional evolution

CANON v2, a versioned backend, larger caps, persistent budgets, numeric-ID guarantees and new
ordinary-signature semantics. Any adopted change needs review proportional to its changed trust
boundary.

The ZK verifier delta belongs in the audit scope. Reference-device proving remains unmeasured.
Archived-state restoration must cover automatic-restoration and explicit-restore responses rather
than assuming every simulation returns `restorePreamble`. No live archival drill was performed
during this review.

**Sources:** [docs/MAINNET_READINESS.md:7](https://github.com/nidohq/nido/blob/0626703cb10310ba376b5ccc586705654d5399e8/docs/MAINNET_READINESS.md#L7) · [docs/recovery/budgets.md:134](https://github.com/stellar-registry/perch/blob/bb746f9d03c593f0d5a2518c6900e00c938f95ec/docs/recovery/budgets.md#L134)

See also [Stellar state-archival documentation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival).

## Recommended standalone handoff

1. **Audit manifest and scope:** frozen identities, component ownership, in-scope and excluded paths,
   dependency deltas, and exact links.
2. **Architecture and trust model:** current component boundaries, authority, flows, and known risks.
   Remove workstream names and migration narrative.
3. **Normative protocol:** Perch owns the shared recovery and document specification. Nido documents
   integration behavior and links to that exact Perch revision.
4. **Invariants and evidence:** property → implementation → existing test or report → result and
   coverage limitation. Distinguish mocked, enforcing-auth, real-proof, testnet, and formal evidence.
5. **Build, deployment, and operations:** executable commands, exact toolchain and artifact inputs,
   current manifest, incident procedures, and archival procedures.
6. **Known limitations and deferrals:** current semantics and residual risks, plus post-audit items
   with owners, exit criteria, and review requirements.
7. **Mainnet gate:** outstanding launch conditions. Link to evidence for completed items; keep dated
   run logs and retired deployments outside the primary reading path.

**Acceptance criterion:** an auditor can identify the exact code, understand every authority and
state transition, reproduce the evidence, and distinguish current guarantees from deferred features
without opening an epic, historical PR, or design-decision discussion.

## Evidence and limitations

- Reviewed the 17-file PR diff against the comparison base above. It consists of the audit package,
  removal of three obsolete recovery documents, reference updates, and removal of the retired
  registry registration.
- Compared the pinned Perch materials with the checked Perch main and confirmed that the reviewed
  documentation is unchanged between them.
- Inspected factory upgrade and pin paths, account authorization and apply paths, controller
  enrollment validation, the rule reconciler, and cited test implementations. Checked relevant
  issue and review context.
- GitHub reported all 12 PR checks passing at review time. Local read-only checks passed for diff
  whitespace and `scripts/deploy-registry.sh` shell syntax.
- A scan of 24 audit-path documents found no missing relative file targets in an initialized source
  snapshot. All 37 extracted snake-case references in Nido's invariant document appeared in its
  sources. These checks establish reference presence, not the correctness of the associated claim.
- Remote validation found the Nido nested-submodule spec URL returned HTTP 404, while the equivalent
  commit-pinned Perch URL returned HTTP 200. F4 records the affected reading path.
- Perch's implementation map references two nonexistent crossover test names, recorded in F6.
- No contract suites, browser recovery flows, live deployments, or archival transactions were rerun.
  Passing CI is reported evidence; this review does not independently establish cryptographic
  correctness or validate live deployment state.
- This commit records the review. It changes no implementation or normative audit documents, and no
  GitHub review or release approval was submitted.
