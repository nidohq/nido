# Deferred until after the audit

Work that is outside the audited revisions (the
[audit manifest](./AUDIT_SCOPE.md#audit-manifest)), what Nido does instead,
and what ends each deferral. Nothing deferred here is implemented in the
audited code.

Perch owns the first eight items and keeps the authoritative entry for each in
its own register,
[`docs/DEFERRED.md`](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md)
(`vendor/perch/docs/DEFERRED.md`). The sections below give Nido's side of
each. The last item is Nido's.

These are not deferred, because they are implemented and in scope: Perch's
consumer views (`revision()`, `configuration()`, `document()`), the
two-digest recovery target binding, and the optional `expected_revision`
check on `apply_doc`.

## CANON v2 structured document identity

- **Deferred:** replacing CANON v1 document identity (SHA-256 of a document's
  canonical bytes, plus per-rule fragment hashes) with a structured identity.
- **Current behaviour in Nido:** every document identity the wallet computes
  comes from perch-js (`@stellar-registry/perch`: `docHash`, `ruleHash`,
  `configHash`). The policy and delegate pages show and compare `docHash`;
  the recovery settings page records a baseline as the `docHash` of the
  document without its recovery member
  (`packages/frontend/src/lib/recovery/settingsPage.ts`); the guardian page
  recomputes `configHash` of a proposed reconfiguration and offers no Approve
  button unless it equals the request's (SECURITY_INVARIANTS W2). Recovery
  evidence binds the source and target document hashes through the
  controller-built statement.
- **Why it is safe to defer:** CANON v1 is the identity the audited contracts
  and wallet use. The SDK's statement encodings are pinned byte for byte to
  Perch's vectors and to statements Nido's Rust suites built through the
  controller (SECURITY_INVARIANTS Z4), and its document hashes to frozen
  vectors (`packages/passkey-sdk/src/policyDoc/testdata/`). No Nido behaviour
  depends on a structured identity.
- **Exit criterion:** Perch ships a compiler and account build with the new
  identity. Nido then needs a factory build pinning that account, every
  account's own upgrade and re-application of its document (with the
  recovery condition under `Protected`), renewed baseline approval, and
  regenerated parity vectors, followed by a review of the changed identity
  and integration surfaces.
- **Owner:** Perch. Nido owns the wallet and factory migration.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#canon-v2-structured-document-identity)
  (`vendor/perch/docs/DEFERRED.md`).

## Canonical value spellings

- **Deferred:** enforcing one canonical spelling per value in CANON v1, so two
  logically equal documents always share a `doc_hash`. CANON v1 accepts a cap
  `limit` with a leading `+` or leading zeros, signer-key hex in either case,
  and (in perch-js) number forms perch-ir refuses or spells differently.
- **Why it is safe to defer:** Nido's wallet builds documents only through
  perch-js and the SDK, which emit the canonical spelling, so documents it
  produces already agree; the residual is a hand-written or third-party
  document whose non-canonical spelling hashes differently, which still
  authorizes exactly what it says.
- **Exit criterion:** Perch defines the one valid spelling per field, enforces
  it in `perch-ir` and perch-js with parity vectors, and bumps `CANON_VERSION`
  with CANON v2.
- **Owner:** Perch, with Nido for the perch-js/SDK builders.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#canonical-value-spellings)
  (`vendor/perch/docs/DEFERRED.md`).

## Versioned policy backend and larger limits

- **Deferred:** a policy backend other than materialization onto OZ context
  rules, and document limits above the current caps.
- **Current behaviour in Nido:** the wallet reads the limits from the
  compiler the account pins (`limits()`, through perch-js) and refuses an
  over-limit document before submission (SECURITY_INVARIANTS W9): 8 declared
  signers, 11 document rules, 8192 canonical bytes, and 20-byte rule names.
  The generated recovery rule is additional to the 11. Each admin key and
  each app grant takes its own rule; after the founding passkey, added
  devices and app keys share 7 signer slots
  ([RUNBOOKS §6](./RUNBOOKS.md#user-support)). The factory pins exactly one
  account build.
- **Why it is safe to defer:** the account's compiler enforces the caps on
  every `apply_doc` and in `derive_target`; the wallet's check only gives a
  readable refusal. The caps are sized so the worst-case recovery completion
  fits the transaction budget. The residual cost is usability: an owner at
  a cap must remove a device or app grant before adding another.
- **Exit criterion:** a replacement backend or larger caps are scoped and
  reviewed as a separate change, with regression evidence across
  authorization, recovery, and migration. Before mainnet, Nido decides how
  existing funded accounts reach a new backend (each owner's seven-day
  upgrade, then re-application).
- **Owner:** Perch, with Nido for the account migration decision.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#versioned-policy-backend-and-larger-limits)
  (`vendor/perch/docs/DEFERRED.md`).

## Revision-bound ordinary signatures

- **Deferred:** binding ordinary signatures (anything other than
  `apply_doc`) to the account's configuration revision.
- **Current behaviour in Nido:** every wallet `apply_doc` names the revision
  its document was composed from, and the account refuses it with
  `StaleRevision` once another apply has moved the account
  (SECURITY_INVARIANTS A8): owner applies go through perch-js
  `applyDocument` (`applyDocWithPasskey` in
  `packages/frontend/src/lib/primaryPasskeySigner.ts`), and a dApp document
  request carries `expectedRevision`. Ordinary signatures (transfers,
  `execute`, dApp transaction signing, a guardian's approval from their own
  Nido) sign
  `sha256(payload ‖ rule ids)` for rules selected from one `configuration()`
  read. They bind the invocation and the selected rule IDs, not a revision,
  and the wallet does not check the revision before an ordinary signature.
- **Why it is safe to defer:** a removed or replaced rule never gets its ID
  back, so a signature that names it fails. A rule keeps its ID only through
  an in-place edit, which requires the account's admin authority. The
  residual risk: a signature collected before an in-place edit of its rule
  (a changed signer set, `valid_until`, or policy parameters) is evaluated
  under the rule's content at inclusion, until the signature expires.
- **Exit criterion:** Perch defines revision-bound signing semantics and
  capability discovery; Nido's signing paths (`primaryPasskeySigner.ts`, the
  sign page, the Wallets Kit module, session keys) adopt them; the changed
  signing surface is reviewed.
- **Owner:** Perch, with Nido for its signers.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#revision-bound-ordinary-signatures)
  (`vendor/perch/docs/DEFERRED.md`).

## Stable numeric rule IDs

- **Deferred:** a guarantee that a rule keeps a stable numeric ID across
  renames, recreation, and restoration.
- **Current behaviour in Nido:** the wallet selects rules by name, scope, and
  credential from `configuration()` at the time it signs
  (`selectSignerRule` in `packages/frontend/src/lib/policyChainFetch.ts`; the
  recovery completion's `selectRecoveryRule`), never by a stored ID or an ID
  scan (SECURITY_INVARIANTS W10). A replaced rule gets a new ID; OZ never
  reuses one.
- **Why it is safe to defer:** Nido neither promises nor depends on stable
  IDs.
- **Exit criterion:** Perch defines the rename, recreation, restoration, and
  signature-validity semantics; Nido relies on them only after that
  definition is reviewed.
- **Owner:** Perch.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#stable-numeric-rule-ids)
  (`vendor/perch/docs/DEFERRED.md`).

## Persistent spending budgets across replacements

- **Deferred:** a spending budget that survives replacement of its rule or
  reinstallation of its spending policy.
- **Current behaviour in Nido:** the policy page, the delegate pages, and dApp
  delegate requests compose rules with a `cap` (a limit in stroops per window
  of ledgers), which the compiler installs as `perch-spending-limit` beside
  the interpreter (SECURITY_INVARIANTS A5). A rule kept by an apply keeps its
  policy state. Replacing a rule, or changing its cap parameters (which
  removes and reinstalls the spending policy), resets its window. A
  compromise restore re-applies the baseline document and can give retained
  baseline signers a fresh window. No wallet page tells the user that an
  edit resets a window.
- **Why it is safe to defer:** a reset needs an `apply_doc` under the
  account's admin authority, or a recovery completion; an app-grant key whose
  scope excludes account management cannot apply a document (SECURITY_INVARIANTS
  A2), so it cannot reset its own window. A grant scoped to the account itself
  (self-targeted) would instead carry document-management authority, so this
  holds only for ordinary dApp grants that do not target the account. The residual risk: after a reset, including the one a
  compromise restore causes, a capped signer can spend a full window's limit
  again at once.
- **Exit criterion:** a persistent budget is designed as new schema, policy,
  and state semantics with its own audit. Until then, Nido states the reset
  in its threat model and in the wallet's explanation of caps.
- **Owner:** Perch, with Nido for the threat model and wallet wording.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#persistent-spending-budgets-across-replacements)
  (`vendor/perch/docs/DEFERRED.md`).

## Additional formal models

- **Deferred:** formal models of the recovery state machine, account
  authorization, the circuit, the ZK adapter, and the pool.
- **Current behaviour in Nido:** Nido has no formal model of its own. Its
  evidence is the enforcing-authorization integration suites with real
  proofs (`crates/integration-tests/`), the SDK's parity tests against
  Perch's vectors, and unit and browser tests
  ([SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md)). Perch's Lean model
  covers canonical encodings and the interpreter only.
- **Why it is safe to defer:** the audit reviews the implemented runtime
  paths directly; a formal model would add assurance, not replace that
  review.
- **Exit criterion:** set by Perch; a new model's coverage statement says
  what it establishes and what it does not.
- **Owner:** Perch.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#additional-formal-models)
  (`vendor/perch/docs/DEFERRED.md`).

## OZ quiet-events fork pull requests

- **Deferred:** merging the three `stellar-accounts` changes Perch depends on
  upstream, and an OpenZeppelin audit of them: theahaco/stellar-contracts-OZ
  [#3](https://github.com/theahaco/stellar-contracts-OZ/pull/3) (CAP-0071
  delegated auth), [#4](https://github.com/theahaco/stellar-contracts-OZ/pull/4)
  (`_no_events` mutations), and
  [#5](https://github.com/theahaco/stellar-contracts-OZ/pull/5)
  (`reconcile_signers`).
- **Current behaviour in Nido:** the root `Cargo.toml` pins `stellar-accounts`
  to the fork at rev `33726766a1fd5e7e3d2977d79f64ee29e1ea3ca9` (the head of
  #5, stacked on #4 and #3, on upstream OpenZeppelin `fbfde38`), the rev
  Perch pins, so Nido's factory, its pre-Perch policies, and its integration
  tests share one `stellar-accounts` crate with Perch's contracts. None of
  the three pull requests is merged into the fork's main or audited by
  OpenZeppelin.
- **Why it is safe to defer:** the rev is a fixed commit, recorded in
  `Cargo.lock`, and all three deltas are in this audit's scope (the Perch OZ
  materialization stream in [AUDIT_SCOPE.md](./AUDIT_SCOPE.md#responsibility-matrix)).
  Until the audit covers them, they are unaudited code on every account's
  authorization path.
- **Exit criterion:** the changes reach an OpenZeppelin release (or the
  fork's main) and both repositories move to it after a diff review against
  the audited rev, or the accepted risk of staying on the rev is recorded.
- **Owner:** Perch.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#oz-quiet-events-fork-pull-requests)
  (`vendor/perch/docs/DEFERRED.md`); the three fork pull requests above.

## npm publishing of perch-zk and the contract clients

This section is the one home for Nido's package-migration plans.

- **Deferred:** consuming `@stellar-registry/perch-zk` and Perch's contract
  clients (`@stellar-registry/perch-contracts`) as published npm packages.
- **Current behaviour in Nido:**
  - `@stellar-registry/perch-zk` 0.1.0 is an npm workspace from the submodule
    (`vendor/perch/packages/perch-zk`, root `package.json`). The SDK pins the
    version the submodule carries, and `scripts/check-perch-drift.sh` fails if
    npm resolves it anywhere else or the versions differ.
  - Perch's contract clients are generated in Nido, from the deployed wasm
    `just perch-infra` fetched, into `packages/contract-bindings/perch-*`
    (`@nidohq/perch-*`, `private`; `just bindings-perch`).
  - `@stellar-registry/perch` and `@stellar-registry/perch-interpreter` already
    come from npm ([SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md#perch-vendorperch-submodule)).
  - Perch's Rust crates are path dependencies on the submodule. Perch
    publishes no crates (its releases are on-chain wasm publishes and npm
    packages), so the submodule stays Nido's source for them.
  - Consequence: `@nidohq/passkey-sdk` is not publishable while it depends on
    the private `@nidohq/perch-*` clients and the workspace-only perch-zk.
- **Why it is safe to defer:** the consumed code is fixed by the Perch source
  commit in the audit manifest, the consumed wasm by the manifest's hashes
  (`just perch-infra`), and npm's resolution of perch-zk by the drift check.
  Switching to published packages changes packaging only if each published
  artifact is shown equal to the reviewed source; a version bump is not that
  proof.
- **Exit criterion:** Perch publishes perch-zk and
  `@stellar-registry/perch-contracts`; Nido replaces the workspace link and
  its generated clients with them after showing each published artifact
  equals the reviewed one (source unchanged at the release tag, and the
  published build or the clients' wasm hashes compared); `@nidohq/passkey-sdk`
  then becomes publishable. Until then no Nido release publishes it
  ([SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md#npm)).
- **Owner:** Perch publishes; Nido migrates.
- **Tracking:** [Perch entry](https://github.com/stellar-registry/perch/blob/6af7622da80309b9c6764f1e05c8a6186ad2e0ad/docs/DEFERRED.md#npm-publishing-of-perch-zk-and-the-contract-clients)
  (`vendor/perch/docs/DEFERRED.md`);
  [nidohq/nido#208](https://github.com/nidohq/nido/issues/208) (Perch
  consumability gaps).

## Registry import-macro migration

- **Deferred:** resolving the factory's verifier through the Stellar
  Registry's import macro (registry-resolved contract imports) instead of
  Nido's own registry client.
- **Current behaviour in Nido:** the factory (`contracts/factory/src/contract.rs`)
  declares its own `RegistryInterface` client (`fetch_contract_id(name)`)
  against a hardcoded `REGISTRY` constant, the unverified testnet Stellar
  Registry `CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S`.
  `create_account` resolves only `"verifier"`: the pin set by the
  constructor or `pin_verifier` if there is one, else an
  address cached in the factory's instance storage from an earlier lookup,
  else a registry lookup that it then caches. The Perch account wasm hash
  is pinned at build time with Perch's `registry_contract!` from the
  committed `contracts/factory/wasm/perch-account.sha256`, which `just
  perch-infra` writes from `vendor/perch/deployments/<STELLAR_NETWORK>.json`
  (default testnet); a missing or malformed pin fails the build. The
  factory deploys every account from that hash (`account_wasm_hash`), so
  the wasm must already be installed on the network. A pin from another
  network's manifest still builds: `just check-vendor-drift` and
  `scripts/deploy-factory.sh` (before it deploys) refuse it.
- **Why it is safe to defer:** the deployed factory has Perch's verifier
  pinned, so the registry is off the account-creation path; a repointed or
  failing registry can neither reroute nor block creation
  (SECURITY_INVARIANTS F5). `scripts/deploy-factory.sh` pins it in the
  constructor, installs the account wasm and reads it back from the ledger,
  and checks the *deployed* factory's `account_wasm_hash` against the
  manifest; `scripts/check-perch-drift.sh` checks the committed pin and the
  built `nido_factory.wasm` against the manifest's hash, and `just check-factory`
  checks the deployed factory's. The residual risk is a
  factory used before its pin, which trusts whatever the registry returns
  for `"verifier"`, and a mainnet build, which needs `REGISTRY` changed and
  the factory rebuilt (MAINNET_READINESS A4).
- **Exit criterion:** the factory takes its verifier through a
  registry-resolved import too (`registry_contract!` can derive it from a
  pinned registry id and verifier hash, replacing `REGISTRY`; nidohq/nido#279), and Nido's
  wasm is published through `stellar-registry/actions`; or Nido records that
  the build-time pin design stays. Either way, the factory's resolution path
  is reviewed again.
- **Owner:** Nido.
- **Tracking:** [stellar-registry/perch#41](https://github.com/stellar-registry/perch/issues/41)
  (`registry_contract!`),
  [nidohq/nido#239](https://github.com/nidohq/nido/issues/239) (adopt
  `stellar-registry/actions`).
