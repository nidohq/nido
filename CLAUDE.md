# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

g2c facilitates migration from Stellar G-addresses to Soroban Smart Accounts (C-addresses) using WebAuthn/passkey authentication. All passkey verification is on-chain via the WebAuthn verifier contract and OpenZeppelin's stellar-accounts library.

## Build & Test Commands

```bash
just test              # cargo test --workspace
just build             # cargo build --workspace (native)
just build-contracts   # stellar contract build --optimize (Soroban wasm)
just check             # cargo fmt --check + cargo clippy -D warnings
just fmt               # cargo fmt --all
```

Run a single test by name: `cargo test -p g2c-integration-tests smart_account_check_auth_with_passkey`

## Workspace Architecture

Three contracts plus integration tests:

**`contracts/smart-account`** — Soroban contract implementing OpenZeppelin's `CustomAccountInterface` + `SmartAccount` + `ExecutionEntryPoint` traits. Delegates auth to `do_check_auth` from stellar-accounts. `#![no_std]`.

**`contracts/webauthn-verifier`** — Soroban contract implementing OZ's `Verifier` trait for secp256r1/P-256 passkey signature verification. Stateless — deploy once, shared across accounts. `#![no_std]`.

**`contracts/factory`** — Deploys Smart Accounts with a WebAuthn signer. Lazy-deploys a shared verifier instance.

**`crates/integration-tests`** — Cross-crate integration tests using synthetic P-256 keypairs to construct full WebAuthn assertions without a browser.

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

## Testing Notes

Tests use synthetic P-256 keypairs (`SigningKey::random()`) to construct full WebAuthn assertions without a browser. Contract test IDs use valid stellar-strkey encoded addresses.

## Dependency Version Constraints

- `stellar-accounts` is pinned to a git rev of OpenZeppelin/stellar-contracts to match `soroban-sdk` 25.x
