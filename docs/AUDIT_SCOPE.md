# Audit scope

What to audit in Nido, at which revisions, who reviews each part, and in what
order. Perch, which supplies Nido's account, verifier, and recovery stack, has
its own audit manifest; this file assigns every Perch input Nido consumes.

## Snapshot caveats

Read these before the manifest.

- **Single-commit snapshot.** The handed-over tree is one commit with no git
  history or tags, so the git-based provenance checks below
  (`git -C vendor/perch diff` against release tags, `scripts/check-perch-drift.sh`,
  `git rev-parse HEAD`) cannot run as written. Identity is fixed by the recorded
  SHAs and integrity hashes; source-equality by the comparison results attached
  to the handoff.
- **`vendor/perch` is fork-pinned for the audit.** `.gitmodules` points
  `vendor/perch` at the audit fork's `audit/integration` branch so the audited Nido
  head pulls the audited Perch head; it is reverted to upstream `main` before
  mainnet. [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md) describes the upstream pin.
- **perch-js.** The pinned source's `packages/perch-js` is `0.3.1` (unreleased
  section); the wallet runs the published `0.3.2` tarball, built from a later
  Perch commit. Tarball-vs-source equality is a post-audit release gate
  ([DEFERRED.md](./DEFERRED.md#npm-publishing-of-perch-zk-and-the-contract-clients)).
- **What is deferred until after the audit** is in [DEFERRED.md](./DEFERRED.md).

## Audit manifest

The audit covers fixed revisions. No branch is part of the audit identity.

Identity is fixed by the SHAs and integrity hashes recorded below, which an
auditor checks against the handed-over tree directly. The source-equality
comparisons this manifest prescribes — the `git -C vendor/perch diff` commands,
`scripts/check-perch-drift.sh`, `git rev-parse HEAD`, and the published-tarball
comparisons — additionally need git history or tags. A single-commit snapshot
carries neither, so when the handoff is a plain tree those comparisons run from
the recorded hashes plus the comparison results attached to the handoff, not
from `git` against the tree.

### Reviewed source

| Item | Identity | How to record or check it |
| --- | --- | --- |
| Nido source | The commit that contains this file. | At handoff: `git rev-parse HEAD` (full SHA). |
| Perch source | The `vendor/perch` gitlink of that commit. Every commit-pinned Perch link in Nido's documents names it. | `git -C vendor/perch rev-parse HEAD`, which must equal `git ls-tree HEAD vendor/perch`. `scripts/check-perch-drift.sh` fails otherwise. |
| OZ `stellar-accounts` fork | theahaco/stellar-contracts-OZ at rev `33726766a1fd5e7e3d2977d79f64ee29e1ea3ca9`, the same rev in Nido's and Perch's `Cargo.toml`. | `Cargo.lock` (`source = "git+…?rev=3372676…"`). |
| `admin-sep` | crates.io `0.27.0`. | `Cargo.lock` checksum `b45f70e98918c7ecfcda164bc45811cfc282be96f38e57e1198f401d9466eb7a`. |
| Toolchains | `rust-toolchain.toml` at the Nido commit (Nido's wasm and tests); Perch's [`scripts/zk-toolchain.sh`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/scripts/zk-toolchain.sh) (`vendor/perch/scripts/zk-toolchain.sh`) at the Perch commit (`nargo`, `bb`, each download checked against a pinned SHA-256). | Both files at the recorded commits. Pins and known gaps: [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md). |
| npm packages | `package-lock.json` at the Nido commit. The Perch packages the wallet runs are below. | `npm ci` refuses a tarball whose integrity differs. |
| Audit date | Recorded with the handoff. | |

Perch packages in the wallet:

| Package | Source | Version | Integrity (`package-lock.json`) |
| --- | --- | --- | --- |
| `@stellar-registry/perch` (Perch's `packages/perch-js`) | npm | 0.3.2 | `sha512-34lGg5GJpfzTsWNEski31WFMgCgXSNp6ShyHuFT3CfWAA1FRLF+SWZ3QoJJ38w/TGAfUxf69cf8+J3SeZnzvYg==` |
| `@stellar-registry/perch-interpreter` (Perch's `packages/perch-interpreter-js`) | npm | 0.1.0 | `sha512-ZUW1+/ojzTw0tjlfOxjHtWB7b+I6kWEMz5oQIH6wZrpk2H2vsPfdsc5wnQCU8NNWrLqWJlRKG+yxsbHB/p7Vtw==` |
| `@stellar-registry/perch-zk` | npm workspace link to `vendor/perch/packages/perch-zk` | 0.1.0 | None: its identity is the Perch source commit. |

Perch publishes the two npm packages from release tags, not from the Perch
source commit, and the pinned Perch source corresponds to neither published
version. `packages/perch-js` declares `0.3.1` with an unreleased section (ahead
of the `0.3.1` release) —
Perch's manifest,
[`docs/audit-scope.md`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/docs/audit-scope.md)
(`vendor/perch/docs/audit-scope.md`), records that "no release it records
contains this source" — while the wallet runs the published `0.3.2` tarball,
built from a Perch commit later than the pinned one. `packages/perch-interpreter-js`
declares `0.1.0`, the published version. So no `perch-js-v0.3.2` tag exists in
this tree, and the published `perch-js` tarball cannot be diffed against the
pinned source by any tag in a single-commit snapshot. This audit reviews the
perch-js and perch-interpreter-js encoders as the source at the pinned commit
(`vendor/perch/packages/perch-js`, `vendor/perch/packages/perch-interpreter-js`).
Establishing that a published `dist` is a reproducible build of an audited
source is a post-audit release gate
([DEFERRED.md](./DEFERRED.md#npm-publishing-of-perch-zk-and-the-contract-clients)),
not a check runnable against this snapshot; the alternative, having the wallet
consume perch-js from the workspace as it already does perch-zk, is a Nido code
change outside this audit.

### Deployed artifacts (provenance, not review targets)

| Artifact | Record |
| --- | --- |
| Perch's testnet stack | Perch's manifest [`deployments/testnet.json`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/deployments/testnet.json) (`vendor/perch/deployments/testnet.json`) at the Perch source commit: the build commit (`source.commit`, with `dirty`), the build toolchain (`toolchain`), and every contract's version, `sha256`, and address. |
| Nido's testnet factory | [DEPLOYED.md](../DEPLOYED.md#nidos-factory): wasm hash, build commit, toolchain, verifier pin, admin. |

The deployed Perch wasm was built from `source.commit`, which can be an
ancestor of the Perch source commit (for example, when the later commit only
adds the deployment record). The handoff confirms that the contract sources
are the same in both:
`git -C vendor/perch diff --stat <source.commit> HEAD -- crates circuits vendor Cargo.toml Cargo.lock ':!**/test_snapshots/**'`
(empty output). Nido's tests run the deployed bytes, fetched by the manifest's
hashes (`just perch-infra`), not a local build of the Perch source.

## Responsibility matrix

Four review streams. If one engagement covers Nido and Perch, it runs all
four. Otherwise Nido's engagement runs Nido integration and the dependency
items only Nido consumes (`admin-sep`, the npm tarballs against their
source), and Perch's runs Perch core, Perch OZ materialization, and the
dependency items Perch's manifest assigns to itself (the OZ fork deltas, the
ZK verifier delta, the Perch JavaScript source, Perch's artifact selection).

| Stream | What it covers |
| --- | --- |
| **Nido integration and browser review** | Nido's factory and name registry, wallet, SDK, infrastructure, the Perch JavaScript the wallet runs, the scripts that select which Perch artifacts Nido builds and tests against, and whether Nido uses Perch as Perch's specification intends. |
| **Perch core** (Perch unit 1) | The backend-independent stack: controller, statement, ZK primitives, pool, adapter, circuit, compiler and CANON, interpreter, the account's recovery and capability paths, and the WebAuthn verifier. |
| **Perch OZ materialization** (Perch unit 2) | Perch's rule reconciler and install paths, the document caps, `perch-spending-limit`, and how they use the pinned OZ fork. |
| **Explicit dependency review** | Code on an authority path that neither project owns line by line: `admin-sep`, the three OZ fork deltas, the ZK verifier delta, and the Perch JavaScript the wallet consumes, each read in full or checked against its source or audited release. Perch's manifest assigns its share of these the same way. |

Perch's two units are a boundary for Perch's audit; a later Perch backend
still needs its own integration review in Nido. Perch's map of its paths to
the two units is its audit manifest,
[`docs/audit-scope.md`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/docs/audit-scope.md)
(`vendor/perch/docs/audit-scope.md`).

| Item | Path or identity | Stream |
| --- | --- | --- |
| Factory | `contracts/factory/`: deterministic deployment of `perch-account` with the passkey admin rule; the embedded account wasm and its hash cache across upgrades; admin, upgrade, and verifier pin; the registry fallback for an unpinned verifier | Nido integration |
| Name registry | `contracts/name-registry/`: name ownership and release | Nido integration |
| `admin-sep` 0.27.0 | `admin`, `set_admin`, and `upgrade` for the factory (whose `upgrade` override also clears the account-hash cache), the name registry, and the multisig and spending-limit policies. About 50 lines. `admin()` reads the stored admin with `unwrap_unchecked`, and `set_admin` requires no authorization while no admin is stored; the factory's constructor stores one. | Explicit dependency review: read in full |
| Passkey SDK | `packages/passkey-sdk/`: `src/perch/` (statement encodings, recovery builders, document helpers, proving), `src/policyDoc/`, WebAuthn parsing, auth-entry signing | Nido integration |
| Wallet | `packages/frontend/`: recovery pages (`src/lib/recovery/`), onboarding and the setup secret (`src/pages/new-account/`, `src/lib/createNido.ts`), signing flows, the storage bridge, `public/_headers` | Nido integration |
| Wallets Kit module | `packages/stellar-wallets-kit-module/`: dApp signing handoff | Nido integration |
| Infrastructure | `infra/relayer/` (fee sponsorship and submission, the channels plugin, key custody), `infra/nido-resolver/` (name resolution), `frontend/worker-proxy-nido/` (subdomain proxy, security headers) | Nido integration |
| Integration harness | `crates/integration-tests/`: that it runs under enforcing authorization with real proofs and that its fixtures cannot drift silently (`src/zk.rs`) | Nido integration |
| `@stellar-registry/perch` (perch-js; npm `0.3.2`, pinned source `0.3.1`, see manifest note) | Statement and document encodings, `applyDocument`, rule selection, signing digests. | Source at the pinned commit: explicit dependency review. The published tarball vs an audited source: post-audit release gate ([DEFERRED.md](./DEFERRED.md#npm-publishing-of-perch-zk-and-the-contract-clients)). The wallet's use of it: Nido integration |
| `@stellar-registry/perch-interpreter` 0.1.0 | Interpreter install parameters and bindings the SDK uses (`src/policyDoc/params.ts`) | Nido integration; tarball against source: explicit dependency review |
| `perch-zk` | [`packages/perch-zk`](https://github.com/stellar-registry/perch/tree/845c49a376c08aeeed9f5d3c63356b753dc617f4/packages/perch-zk) (`vendor/perch/packages/perch-zk`): in-page proving and the circuit artifact it ships | Source: explicit dependency review; the wallet's use of it: Nido integration |
| Generated Perch clients | `packages/contract-bindings/perch-*`, generated from the deployed wasm (`just bindings-perch`) | Nido integration (provenance) |
| Artifact selection | `just perch-infra` (runs Perch's [`scripts/fetch-infra-wasm.sh`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/scripts/fetch-infra-wasm.sh) (`vendor/perch/scripts/fetch-infra-wasm.sh`) `--stack`), `scripts/check-perch-drift.sh`, `scripts/deploy-factory.sh`, `packages/passkey-sdk/src/perch/deployment.ts` (`perch.TESTNET`) and its test. Perch's own artifact selection (`fetch-infra-wasm.sh`, `build-stack.sh`, `verify-deployment.sh`) is in Perch's explicit dependency review. | Nido integration |
| Perch contracts | `perch-account`, `perch-smart-account` (recovery and capability paths), `perch-recovery`, `perch-zk-pool`, `perch-zk-adapter`, `perch-doc-compiler`, `perch-interpreter`, `perch-webauthn-verifier`, in Perch's [`crates/`](https://github.com/stellar-registry/perch/tree/845c49a376c08aeeed9f5d3c63356b753dc617f4/crates) (`vendor/perch/crates/`) | Perch core |
| Circuit | Perch's [`circuits/`](https://github.com/stellar-registry/perch/tree/845c49a376c08aeeed9f5d3c63356b753dc617f4/circuits) (`vendor/perch/circuits/`), specialist review: soundness, domain separation, nullifier binding | Perch core |
| ZK verifier delta | Perch's `UltraKeccakZKFlavor` delta on NethermindEth's UltraHonk verifier, in Perch's `vendor/ultrahonk-soroban-verifier/`: `src/zk.rs` (new), `src/lib.rs` (+3 lines: the module and its re-exports), and visibility-only changes to `src/transcript.rs`, `src/sumcheck.rs`, `src/utils.rs`, and `src/verifier.rs`, as listed in its [`NOTICE`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/vendor/ultrahonk-soroban-verifier/NOTICE) (`vendor/perch/vendor/ultrahonk-soroban-verifier/NOTICE`). Not audited. | Explicit dependency review (cryptographic specialist) |
| Upstream UltraHonk verifier | The rest of Perch's [`vendor/ultrahonk-soroban-verifier/`](https://github.com/stellar-registry/perch/tree/845c49a376c08aeeed9f5d3c63356b753dc617f4/vendor/ultrahonk-soroban-verifier) (`vendor/perch/vendor/ultrahonk-soroban-verifier/`): NethermindEth's verifier at the upstream commit its `NOTICE` names, audited by OpenZeppelin for the non-ZK flavor only. Confirm the vendored bytes are upstream's (`UPSTREAM.sha256`, `CHECKSUMS.sha256`, Perch's `crates/perch-zk-adapter/tests/vendor.rs`). | Explicit dependency review: provenance only |
| Rule reconciler, install paths, caps, spending limit | `perch-smart-account/src/rules.rs`, the install half of `apply`, the caps in `perch-doc-compiler`, `perch-spending-limit` (all in Perch's `crates/`) | Perch OZ materialization |
| OZ fork #3: CAP-0071 delegated auth | [theahaco/stellar-contracts-OZ#3](https://github.com/theahaco/stellar-contracts-OZ/pull/3), in the rev above | Explicit dependency review |
| OZ fork #4: `_no_events` mutations | [theahaco/stellar-contracts-OZ#4](https://github.com/theahaco/stellar-contracts-OZ/pull/4), in the rev above | Explicit dependency review |
| OZ fork #5: `reconcile_signers` | [theahaco/stellar-contracts-OZ#5](https://github.com/theahaco/stellar-contracts-OZ/pull/5), in the rev above | Explicit dependency review |

Named exclusions:

| Excluded | Why |
| --- | --- |
| `contracts/status-message/` | Demo contract for the example dApp; excluded from mainnet (MAINNET_READINESS E3). |
| `contracts/*-policy` (multisig, spending limit, pre-auth sweep) | Pre-Perch OZ policies a Perch document cannot attach; in scope only if a product decision keeps them (MAINNET_READINESS D6). |
| `soroban-sdk`, `soroban-sdk-tools`, the Stellar Registry contract | Pinned third-party dependencies or external contracts ([SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md)). |
| Noir, Barretenberg, `@aztec/bb.js`, `@noir-lang/noir_js` | Pinned third-party proving toolchain: only these versions are supported and tested. The deployed adapter verifies a proof against the one embedded verification key for the pinned circuit, so a proof whose format or key does not match it fails verification; the verifier reads no version number. |
| Perch's `packages/perch-relay` and `packages/perch-contracts` | Not used by Nido. |
| `perch-zk-prover` | The native prover Nido's tests use to write the proof fixtures (`just gen-zk-fixtures`). A wrong proof fails verification in the deployed adapter, which the tests run from its deployed wasm. |
| The Stellar protocol, consensus, and RPC | Trusted ([THREAT_MODEL.md](./THREAT_MODEL.md#trusted)). |
| Retired Nido contracts | Nido's former smart account, WebAuthn verifier, recovery controllers, recovery verifier, ZK pool and verifier, circuits, and pool indexer. Their source is not in this tree and none may be deployed to mainnet. The deployments that current code still reaches are in DEPLOYED.md's [compatibility appendix](../DEPLOYED.md#compatibility-appendix). |
| The recovery-relay worker | `relay.nido.fyi` and its KV namespace are still deployed; their source is not in this tree and no wallet code calls them. The SDK still exports the relay-era handoff format (`packages/passkey-sdk/src/friendSigning.ts`), which no wallet page imports. Deleting the worker is MAINNET_READINESS D6. |

## Reading order

1. This file: the manifest and who reviews what.
2. [ARCHITECTURE.md](../ARCHITECTURE.md): components, flows, diagrams.
3. [THREAT_MODEL.md](./THREAT_MODEL.md): assets, adversaries, what is
   trusted, and the limits within the audited behaviour;
   [STRIDE_THREAT_MODEL.md](./STRIDE_THREAT_MODEL.md) is the risk register
   that indexes each threat's STRIDE category, invariants, release gate, and
   status.
4. Perch's recovery specification,
   [`docs/recovery/spec.md`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/docs/recovery/spec.md)
   (`vendor/perch/docs/recovery/spec.md`): the single source of truth for
   recovery semantics.
5. [SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md): each property and the
   test that pins it.
6. [DEFERRED.md](./DEFERRED.md): what is deferred until after the audit,
   and what Nido does instead.
7. [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md): third-party inputs and pins.
8. [DEPLOYED.md](../DEPLOYED.md): what is deployed, and from which revisions.
9. [RUNBOOKS.md](./RUNBOOKS.md) and [MAINNET_READINESS.md](./MAINNET_READINESS.md):
   how it is built, deployed, and operated, and what is still open.
10. Perch's audit manifest,
    [`docs/audit-scope.md`](https://github.com/stellar-registry/perch/blob/845c49a376c08aeeed9f5d3c63356b753dc617f4/docs/audit-scope.md)
    (`vendor/perch/docs/audit-scope.md`), for the Perch streams.

Not in the reading order, because they are historical records rather than
descriptions of current behaviour: `docs/APPLICATION.md` (the funding
application) and `docs/REQUIREMENTS.md` (the request it answered).

## Integration with Perch

The Nido integration stream checks that Nido uses Perch as Perch's
specification intends:

- The factory's constructor rule and the wallet's first document (admin rule
  scoped to the account, recovery member, guardian rule scoped to the
  controller) match what the specification assumes.
- The wallet builds evidence and documents only from chain reads and
  controller-built statements (`packages/passkey-sdk/src/perch/`), never from
  link contents a guardian can't check.
- The integration tests are sound evidence: they run under enforcing
  authorization with real proofs, and the fixtures can't drift silently.
- The wallet's deployment (`perch.TESTNET`) is the Perch manifest plus Nido's
  factory, and the artifact-selection scripts accept only the manifest's
  bytes.

## Questions we want answered

1. **Factory admin.** The factory admin can replace the whole factory wasm,
   and with it the account code and verifier new accounts get
   (THREAT_MODEL 8); pinning the verifier does not constrain an upgrade.
   MAINNET_READINESS B1 requires a multisig with a visible upgrade delay, or
   no upgrade authority. Is that enough for accounts created while an
   upgrade is pending?

   _As built:_ the factory's `upgrade` and `set_registry_pins` take effect in
   the same transaction (`admin.require_auth`, then
   `update_current_contract_wasm` / the pin write) — there is no on-chain
   timelock, so any "visible upgrade delay" is a property of the admin
   multisig's off-chain process, not an on-chain guarantee. An account created
   while an upgrade is pending gets whatever factory code and pin are live at
   its ledger, and nothing on-chain or in the wallet compares the new account's
   wasm hash or admin-rule verifier against `perch.TESTNET` / the manifest. A
   multisig delay alone therefore does not protect accounts created during or
   after a malicious upgrade unless the wallet verifies the deployed result
   (see B1).
2. **The ZK verifier delta.** Proofs are zero-knowledge, verified by Perch's
   unaudited `UltraKeccakZKFlavor` delta on the audited verifier
   (THREAT_MODEL 13). Is it sound?
3. **Guardian checks.** Is what the guardian page verifies (W2, W3) enough for
   a guardian who follows its instructions?
4. **Setup secret.** Whoever submits a salt first owns its address, and the
   relayer sees every salt (THREAT_MODEL 5, 10, L5). Is the window between
   creating a salt and deploying acceptable, and does the mitigation
   MAINNET_READINESS A6 requires close it?
5. **Deployment.** `perch.TESTNET` is checked against Perch's manifest in a
   test, and the manifest against the chain by Perch's `verify-deployment.sh`.
   Is that enough, and should a `PUBLIC_PERCH_DEPLOYMENT` override be checked
   the same way at build time (THREAT_MODEL 9)?
6. **Archival.** Is the stepwise restoration procedure (RUNBOOKS §6) safe and
   complete for both automatic-restoration and explicit-restore simulation
   responses? The wallet does not run it.
