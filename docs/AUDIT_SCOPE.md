# Audit scope

What to audit in Nido, at which revisions, and in what order. Hand this to the
audit firm with the freeze commit filled in.

> **Freeze commit:** _TBD: record `git rev-parse HEAD` of the audited tree and
> `git -C vendor/perch rev-parse HEAD` here._ At the time of writing, Perch is
> pinned at `836fdc9` (branch `fm/perch-epic99-deploy-p8`, the deployment
> record at the top of stellar-registry/perch#99's stack), whose testnet
> deployment was built from Perch commit `aa5a78f`; the pin moves to Perch's
> published release.

## Reading order

1. [ARCHITECTURE.md](../ARCHITECTURE.md): components, flows, diagrams.
2. [THREAT_MODEL.md](./THREAT_MODEL.md): assets, adversaries, what is trusted.
3. Perch's recovery specification,
   [`vendor/perch/docs/recovery/spec.md`](../vendor/perch/docs/recovery/spec.md):
   the single source of truth for recovery semantics.
4. [SECURITY_INVARIANTS.md](./SECURITY_INVARIANTS.md): each property and the
   test that pins it.
5. [SUPPLY_CHAIN.md](./SUPPLY_CHAIN.md): third-party inputs and pins.
6. [RUNBOOKS.md](./RUNBOOKS.md) and [MAINNET_READINESS.md](./MAINNET_READINESS.md):
   how it is built, deployed, and operated, and what is still open.

## Nido's scope

### Contracts (Rust, `#![no_std]`)

| Contract | Path | Focus |
| --- | --- | --- |
| Factory | `contracts/factory/` | Deterministic deployment of `perch-account` with the passkey admin rule; embedded wasm hash and its cache across upgrades; admin and upgrade (`admin-sep`); verifier pin; registry fallback. |
| Name registry | `contracts/name-registry/` | Name ownership and release. |
| Status message | `contracts/status-message/` | Demo only. Confirm it is excluded from mainnet. |

`contracts/*-policy` (multisig, spending limit, pre-auth sweep) predate Perch
and can't be attached by a Perch document. They are out of scope unless a
product decision keeps them.

### Integration with Perch

The audit should check that Nido uses Perch as Perch's spec intends:

- The factory's constructor rule and the wallet's first document (admin rule
  scoped to the account, recovery member, guardian rule scoped to the
  controller) match what the spec assumes.
- The wallet builds evidence and documents only from chain reads and
  controller-built statements (`packages/passkey-sdk/src/perch/`), never from
  link contents a guardian can't check.
- The integration tests (`crates/integration-tests/`) are sound evidence: they
  run under enforcing authorization with real proofs, and the fixtures can't
  silently drift (`src/zk.rs`).

### TypeScript

| Package | Path | Focus |
| --- | --- | --- |
| Passkey SDK | `packages/passkey-sdk/` | `src/perch/` (statement encodings, recovery builders, document helpers, proving), `src/policyDoc/`, WebAuthn parsing and auth-entry signing. |
| Wallet | `packages/frontend/` | Recovery pages (`src/lib/recovery/`), onboarding and the setup secret (`src/pages/new-account/`, `src/lib/createNido.ts`), signing flows, the storage bridge, `public/_headers`. |
| Wallets Kit module | `packages/stellar-wallets-kit-module/` | dApp signing handoff. |

### Infrastructure

- `infra/relayer/`: fee sponsorship and submission, the channels plugin, key
  custody.
- `infra/nido-resolver/`: name resolution worker.
- `frontend/worker-proxy-nido/`: subdomain proxy and security headers.

The recovery relay that held friend signatures for the retired recovery is
removed from the tree (#233). Its deployed worker (`relay.nido.fyi`) and KV
namespace remain until the Cloudflare account owner deletes them; no wallet
code calls them.

## Perch's scope

Perch is a separate project with its own audit package. Nido consumes it from
the `vendor/perch` submodule; the audited revision is the one recorded above.
Perch's own scope document,
[`vendor/perch/docs/audit-scope.md`](../vendor/perch/docs/audit-scope.md),
maps its stack to two audit units (the backend-independent core and the OZ
materialization layer) and names the pull request that introduced each path.
If one engagement covers both, Perch's scope is:

- Contracts: `perch-account` and `perch-smart-account`, `perch-recovery`,
  `perch-zk-pool`, `perch-zk-adapter`, `perch-doc-compiler`,
  `perch-interpreter`, `perch-spending-limit`, and `perch-webauthn-verifier`,
  which every Nido passkey names (`vendor/perch/crates/`).
- The circuit, `vendor/perch/circuits/` (specialist review: soundness,
  domain separation, nullifier binding).
- The OZ `stellar-accounts` fork with the CAP-0071 delegated-auth patch
  (`theahaco/stellar-contracts-OZ` at the rev in `Cargo.toml`). The patch is
  not OZ-audited.
- `perch-js` and `perch-zk` (`vendor/perch/packages/`).

The UltraHonk verifier inside the adapter is NethermindEth's, audited by
OpenZeppelin, plus Perch's delta for the zero-knowledge flavor
(`UltraKeccakZKFlavor`: one new file, `vendor/ultrahonk-soroban-verifier/src/zk.rs`,
and visibility-only changes to four audited files;
[vendor/perch/docs/zk/README.md](../vendor/perch/docs/zk/README.md)). The
delta is not audited. The audit should confirm the rest matches the audited
release and review the delta, which Perch lists as a release criterion.

## Questions we want answered

1. **Factory admin.** The factory admin can change the account code and the
   verifier new accounts get (THREAT_MODEL 8). Is a multisig plus a visible
   upgrade delay enough, or should the factory pin its verifier at build time
   as Perch's does?
2. **The ZK verifier delta.** Proofs are zero-knowledge now, verified by
   Perch's unaudited `UltraKeccakZKFlavor` delta on the audited verifier
   (THREAT_MODEL 13). Is it sound?
3. **Guardian checks.** Is what the guardian page verifies (W2, W3) enough for
   a guardian who follows its instructions?
4. **Setup secret.** Is the window between creating a salt and deploying
   acceptable (THREAT_MODEL 5)?
5. **Deployment.** `perch.TESTNET` is checked against Perch's manifest in a
   test, and the manifest against the chain by Perch's `verify-deployment.sh`.
   Is that enough, and should a `PUBLIC_PERCH_DEPLOYMENT` override be checked
   the same way at build time (THREAT_MODEL 9)?
6. **Archival.** Is stepwise restoration (RUNBOOKS §6) safe and complete?

## Out of scope

- `soroban-sdk`, `soroban-sdk-tools`, and the Stellar Registry contract:
  pinned dependencies or external contracts (SUPPLY_CHAIN.md).
- `admin-sep`: a dependency, but on the upgrade path of the factory, the
  name registry, and two of the policies. It is about 50 lines;
  read it in full.
- The Stellar protocol, consensus, and RPC.
- Everything retired by the move to Perch: Nido's former smart account,
  WebAuthn verifier, recovery controllers, recovery verifier, ZK pool and
  verifier, circuits, and pool indexer. Their testnet deployments are listed in DEPLOYED.md as
  retired and must not be deployed to mainnet.
- `docs/superpowers/`: historical design notes, not current behaviour.
