# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nido helps users move from Stellar G-addresses to Soroban Smart Accounts (C-addresses) using WebAuthn/passkey authentication. All passkey verification is on-chain via the WebAuthn verifier contract and OpenZeppelin's stellar-accounts library.

## Build & Test Commands

```bash
git submodule update --init   # vendor/perch, the Perch stack
just perch-infra       # Perch's deployed wasm + pin caches, by the hashes in vendor/perch/deployments/testnet.json
just build-contracts   # Nido's wasm (the factory embeds the fetched Perch account)
just test              # cargo test --workspace (embeds the wasm above)
just check             # cargo fmt --check + cargo clippy -D warnings
just gen-zk-fixtures   # re-prove the real-proof fixtures with Perch's pinned nargo/bb
```

Run a single test by name: `cargo test -p nido-integration-tests --test it recovery_lifecycle`

## Workspace Architecture

The smart account, WebAuthn verifier, recovery controller, ZK membership pool,
and ZK adapter are Perch's (stellar-registry/perch epic #99), consumed from the `vendor/perch`
submodule as path dependencies; the root `Cargo.toml` comment says why and
which branch it pins. Nido's own crates:

**`contracts/factory`** — Deploys Perch accounts (embedding the Perch account wasm) with a passkey admin rule checked by Perch's immutable WebAuthn verifier (pinned via `set_registry_pins`).

**`crates/integration-tests`** — The Perch stack as Nido deploys it (`src/world.rs`): everything from wasm, real passkey assertions, enforcing auth (`set_auths`), and real UltraHonk proofs replayed from `fixtures/zk/` (`src/zk.rs`).

## Policy doc layer (perch)

The perch PolicyDoc is nido's policy source of truth at the doc layer:
`packages/passkey-sdk/src/policyDoc/` builds docs, lowers them onto OZ context
rules (stock policies where the shape fits, the perch interpreter otherwise),
and decompiles chain rules back to a doc view — its module docs are the
authoritative reference. `@stellar-registry/perch` and
`@stellar-registry/perch-interpreter` come from npm (a root `overrides` entry
keeps the interpreter's bindings on the workspace's single `@stellar/stellar-sdk`
copy — the #72 dual-SDK hazard); `perch-zk` is unpublished, so it is an npm
workspace from the `vendor/perch` submodule. Perch contract addresses are derived, not deployed
by nido — see DEPLOYED.md "Perch policy layer (0.2.1 era)" and
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

Recovery is Perch's: `vendor/perch/docs/recovery/spec.md` is the authoritative
state machine and `vendor/perch/docs/zk/` the ZK backend. Nido's coverage of it
is `crates/integration-tests/tests/it/recovery_*.rs`, `onboarding.rs`, and
`costs.rs`. ZK tests build their statement through the real controller and
replay a committed proof of it; a changed statement fails with the instruction
to run `just gen-zk-fixtures`. The wallet side is
`packages/passkey-sdk/src/perch/` (SDK) and `packages/frontend/src/lib/recovery/`
(pages), with `model.ts` holding the pure rules the unit tests pin.

## Testing Notes

Tests use synthetic P-256 keypairs (`SigningKey::random()`) to construct full WebAuthn assertions without a browser. Contract test IDs use valid stellar-strkey encoded addresses.

## Dependency Version Constraints

- `stellar-accounts` is pinned to Perch's CAP-0071 OZ fork rev (theahaco/stellar-contracts-OZ), the same rev `vendor/perch/Cargo.toml` pins, so Nido's crates and Perch's share one `stellar-accounts`
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
