# Supply Chain & Toolchain Provenance

Dependency and toolchain inventory for the audit, plus the scanning/attestation
gaps to close. Goal: an auditor can account for every third-party input and
rebuild every deployed artifact.

## Rust dependencies (workspace `Cargo.toml`)

| Dependency | Pin | Kind | Risk |
|---|---|---|---|
| `soroban-sdk` | `26.0.1` | crates.io tagged | Low. |
| `stellar-accounts` (OZ `stellar-contracts`) | **git rev `637c53a8c4928fd0c71d330bd866f482c3454578`** | git, **untagged main branch** | **Elevated** — see below. Core auth (`do_check_auth`) delegates here. |
| `soroban-sdk-tools` (`BlaineHeffron/soroban-sdk-tools`) | git rev `cbafae3439f01a4add2411c6162885edb30e7389` | git rev | Medium — third-party, pinned by rev. |
| `stellar-registry` | `0.0.10` | crates.io | Medium — `0.0.x`. |
| `base64` | `0.22` | crates.io | Low. |

`Cargo.lock` is committed, so transitive versions are reproducible. `cargo-audit`
is **not yet run in CI** (see gaps).

### OZ pinned to an untagged commit — action

Pinning to a main-branch commit means a force-push or a compromised upstream account
could, in principle, change what `637c53a` resolves to (git protects against this via
content-addressing, but the *practice* diverges from auditing a tagged release).
- **Preferred:** ask OpenZeppelin to tag a `stellar-contracts` release including the
  soroban-sdk-26 bump (which landed on main after `v0.7.1`), then repin to the tag.
- **If not in time:** keep the rev pin, record it here, and add it to the audit scope so
  the firm verifies the pinned tree matches audited OZ behavior. `Cargo.lock` +
  content-addressed git already prevent silent substitution of the resolved tree.

## Vendored code

**`contracts/vendor/ultrahonk-soroban-verifier/`** — verbatim copy of an unaudited
third-party UltraHonk verifier.
- Upstream: `https://github.com/yugocabrio/rs-soroban-ultrahonk`, rev
  **`3b031847eb043856cc5bcad45bd5a6512370cd16`** (recorded in the vendor `Cargo.toml`),
  retargeted onto the workspace `soroban-sdk = 26.0.1`.
- License: MIT (vendor crate); Apache-2.0 `LICENSE` file also present — **confirm the
  effective license and record it** before mainnet.
- Its own deps: `ark-ff`/`ark-bn254`/`ark-ec` 0.5, `hex`, `once_cell`, `lazy_static`.
- Drift guard: `scripts/check-vendor-drift.sh` (run in CI via `just check-vendor-drift`)
  compares a sha256 manifest of `src/` against the committed `CHECKSUMS.sha256`.

### Drift-guard gaps — action (C3)

- The manifest now covers `src/` **and the vendor `Cargo.toml`** (done, C3), so a
  dependency/feature-flag change can't slip past; the guard also asserts the recorded
  upstream commit (`3b031847…`) so a bump can't silently drop provenance. (`tests/` and
  `circuits/` are still out of the manifest — they aren't compiled into the deployed wasm.)
- The baseline is regenerable by design, so a hand-edit "passes" once its new hash is
  committed. Keep vendor changes to reviewed, commit-referenced upstream bumps only, and
  call them out in PR review. (This is integrity + provenance recording, not an
  authenticity attestation of upstream.)

## ZK circuit toolchain

| Tool | Pin | Enforced |
|---|---|---|
| `nargo` (Noir) | `1.0.0-beta.18` (pre-release) | `gen_artifacts.sh` hard version guard. |
| `bb` (Barretenberg) | `3.0.0-nightly.20260102` | **Now** hard-guarded in `gen_artifacts.sh` (`REQUIRED_BB_VERSION`) + recorded as `bbRequired` in `manifest.json` (C1). |
| Fiat-Shamir oracle | keccak, via `--verifier_target evm-no-zk` | Implicit (bb rejects an explicit `--oracle_hash` alongside `--verifier_target`); documented in `gen_artifacts.sh`. UltraHonk = transparent setup, no toxic waste. |

Deployed VK/proof/circuit hashes are recorded in `DEPLOYED.md` and the circuit
`manifest.json`. **Mainnet VK must be regenerated** under these pins with mainnet params
(blocker A1) and its hashes re-recorded.

## Contract build toolchain

| Tool | Pin | Status |
|---|---|---|
| Rust | `1.96.0` | **Pinned (C2):** workspace-root `rust-toolchain.toml` (channel `1.96.0`, `wasm32v1-none`) + CI `dtolnay/rust-toolchain@1.96.0`, kept in lockstep. |
| `stellar-cli` (+ bundled `wasm-opt`) | _unpinned (`cargo install --locked stellar-cli`)_ | **Gap — pin an exact version (C2)** and record which produced each deployed wasm. |
| `[profile.contract]` | committed (`lto`, `codegen-units=1`, `panic=abort`, `overflow-checks`, `opt-level=z`) | Good for reproducibility. |

## npm packages

Roots with committed lockfiles: `package.json` (repo root), `packages/passkey-sdk`,
`packages/frontend`, `packages/stellar-wallets-kit-module`, and the `infra/*` workers.
`@nidohq/passkey-sdk` is published to npm — API stability + provenance matter for
downstream consumers.

## Gaps to close (tracked)

- [x] `cargo-audit` job in CI (advisory DB) — non-blocking (`continue-on-error`); make gating pre-mainnet.
- [x] `npm audit` across all package roots — non-blocking; make gating pre-mainnet.
- [x] **Dependabot** config for cargo + npm + GitHub Actions (`.github/dependabot.yml`).
- [x] Extend vendor drift check to the vendor `Cargo.toml` (+ upstream-commit provenance assertion).
- [x] Pin Rust toolchain (C2) — `rust-toolchain.toml` @ `1.96.0`.
- [ ] Pin `stellar-cli` to an exact version (C2) and record which produced each deployed wasm.
- [ ] Repin OZ to a tagged release (or document the accepted risk).
- [ ] Generate an **SBOM** at release; publish alongside the audit report.
- [ ] License scan / confirm vendored-verifier effective license.
