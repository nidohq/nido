# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nido helps users move from Stellar G-addresses to Soroban Smart Accounts (C-addresses) using WebAuthn/passkey authentication. All passkey verification is on-chain via the WebAuthn verifier contract and OpenZeppelin's stellar-accounts library.

## Build & Test Commands

```bash
just test              # cargo test --workspace
just build             # cargo build --workspace (native)
just build-contracts   # stellar contract build --optimize (Soroban wasm)
just check             # cargo fmt --check + cargo clippy -D warnings
just fmt               # cargo fmt --all
```

Run a single test by name: `cargo test -p nido-integration-tests smart_account_check_auth_with_passkey`

## Workspace Architecture

Three contracts plus integration tests:

**`contracts/smart-account`** — Soroban contract implementing OpenZeppelin's `CustomAccountInterface` + `SmartAccount` + `ExecutionEntryPoint` traits. Delegates auth to `do_check_auth` from stellar-accounts. `#![no_std]`.

**`contracts/webauthn-verifier`** — Soroban contract implementing OZ's `Verifier` trait for secp256r1/P-256 passkey signature verification. Stateless — deploy once, shared across accounts. `#![no_std]`.

**`contracts/factory`** — Deploys Smart Accounts with a WebAuthn signer. Lazy-deploys a shared verifier instance.

**`crates/integration-tests`** — Cross-crate integration tests using synthetic P-256 keypairs to construct full WebAuthn assertions without a browser.

## Policy doc layer (perch)

The perch PolicyDoc is nido's policy source of truth at the doc layer:
`packages/passkey-sdk/src/policyDoc/` builds docs, lowers them onto OZ context
rules (stock policies where the shape fits, the perch interpreter otherwise),
and decompiles chain rules back to a doc view — its module docs are the
authoritative reference. Perch comes from npm (`@stellar-registry/perch`,
`@stellar-registry/perch-interpreter`; a root `overrides` entry keeps the
interpreter bindings on the workspace's single `@stellar/stellar-sdk` copy —
the #72 dual-SDK hazard). Perch contract addresses are derived, not deployed
by nido — see DEPLOYED.md "Perch canonical deployment" and
`src/policyDoc/deployment.ts`; frozen golden vectors live in
`src/policyDoc/testdata/`. The frontend's doc surface lives under
`packages/frontend/src/lib/policy/` (three-tier read, doc builder drafts,
the dApp delegate-doc request contract) — each module's header comment is
the reference.

## Frontend Design Export

`packages/frontend/scripts/export-design.mjs` exports the built site into
`packages/frontend/design-export/` as self-contained single-file HTML pages (CSS
inlined, all `<script>` tags stripped, internal links rewritten to flat
filenames). Use it to hand a page off for visual design editing (e.g. paste into
a Claude.ai artifact) or browse the whole site's styling offline via
`design-export/_index.html`.

```bash
cd packages/frontend && npm run build && node scripts/export-design.mjs
```

It's a static snapshot of *design*, not a running app: the landing page
(`index.html`) is fully static, but the app screens are stateful views whose
content JS injects at runtime — so dynamic data shows as placeholders/skeletons.
Pages whose UI lives inside `class="hidden"` mode containers need their primary
state revealed; the script's `reveal` map handles this (currently un-hides
`#home-mode` on the account page). Add an entry there if another page exports blank.

## Account recovery (guardian quorum + ZK)

Guardian-quorum and ZK-proof account recovery for doc-only smart accounts,
built in three layers that are still visible in the code/doc layout:

**Transition spec** (`docs/recovery/TRANSITION_SPEC.md` +
`packages/recovery-spec/`) — the state-machine transition spec, an
executable reference model, and adversarial tests for Perch/Nido ZK+guardian
recovery. No contracts or circuits here — read the spec doc before extending
recovery design elsewhere.

**Completion mechanism** (`docs/recovery/stage2-findings.md`,
`contracts/recovery-doc-completion`,
`crates/integration-tests/tests/it/recovery_stage2_*.rs`) compares two ways
to complete a doc-hash-committed recovery attempt against the doc-only smart
account: authorizing the existing `apply_doc` (Variant A, adopted — no
smart-account code changes) vs. a dedicated `complete_recovery` entry point
sharing the same internal pipeline (Variant B). Read the findings doc's
call-ordering section before adding any recovery completion vehicle — it
explains why a value-bound, single-use completion grant (not a
boolean/ledger flag) is required for any DEDICATED entry point, and why
`apply_doc` needs no such mechanism at all.

**Controller + circuit** (`contracts/recovery-controller`,
`contracts/recovery-verifier`, `circuits/zk_recovery_doc`,
`crates/integration-tests/tests/it/recovery_stage3_*.rs`,
`docs/recovery/stage3-measurements.md`) is the shared controller
implementing guardian-only, ZK-only, and combined evidence paths against the
transition spec's proposal model, completing via the mechanism above's
Variant A. Read `contracts/recovery-controller/src/lib.rs`'s crate doc
comment FIRST — it is the authoritative architecture summary AND the
canonical "Known limits" list (what's NOT implemented and why) before
extending or reviewing this code.

**`circuits/zk_recovery_doc` is a separate circuit crate from the
pre-existing `circuits/zk_recovery` (M1's raw-signer-rotation circuit) —
NOT an in-place edit.** They share domain constants and Merkle/nullifier
logic but bind a different `auth_hash` field list (target-doc-hash instead
of a raw pubkey). Do not merge them or edit one expecting it to affect the
other: `circuits/zk_recovery`'s own fixtures/tests
(`crates/integration-tests/tests/it/zk_recovery_*.rs`, `multisig_recovery.rs`)
pin real `bb`-proved proofs against ITS `auth_hash` formula and would break
if that circuit's witness shape changed. Similarly,
`contracts/recovery-controller/src/zk.rs` deliberately duplicates
(not depends on) `contracts/zk-recovery/src/hash.rs`'s Poseidon2 host-side
reconstruction — same reason.

## Testing Notes

Tests use synthetic P-256 keypairs (`SigningKey::random()`) to construct full WebAuthn assertions without a browser. Contract test IDs use valid stellar-strkey encoded addresses.

## Dependency Version Constraints

- `stellar-accounts` is pinned to a git rev of OpenZeppelin/stellar-contracts to match `soroban-sdk` 25.x
## Relayer channels plugin

`infra/relayer/plugins/channels/index.ts` is a thin passthrough to the upstream
`@openzeppelin/relayer-plugin-channels` handler — it no longer allowlists which
contract function names the relayer will fee-sponsor (removed by design; the
per-function allowlist was a recurring maintenance-friction source, most recently
commit 2533c9a). On-chain auth (the passkey signer on each auth entry) is the only
enforced gate on submitted transactions now — the relayer will fee-sponsor *any*
contract call with valid auth, including calls to contracts other than nido's own.
Do not reintroduce a function-name allowlist here without a deliberate design decision.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
