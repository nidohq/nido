# List available recipes
default:
    @just --list

# Run all workspace tests. Needs the contract wasm (`just build-contracts`),
# which the integration tests embed.
test:
    cargo test --workspace

# Build all crates (native)
build:
    cargo build --workspace

# Compile the zk_recovery Noir circuit and generate its VK/proof/public-inputs
# artifacts + manifest under circuits/zk_recovery/{target,public/circuits}.
# See circuits/zk_recovery/scripts/gen_artifacts.sh for details (falls back
# to docker for the bb steps if the local bb can't run -- e.g. glibc < 2.38).
build-circuits:
    bash circuits/zk_recovery/scripts/gen_artifacts.sh

# Populate the Perch submodule's build-time infra cache
# (vendor/perch/crates/perch-smart-account/wasm/: the stateless registry id and
# the doc compiler / interpreter / spending-limit wasm whose hashes the account
# pins). Perch's own script; needs the Stellar CLI with the registry plugin.
# Run once after cloning (and after bumping vendor/perch).
perch-infra:
    cd vendor/perch && bash scripts/fetch-infra-wasm.sh

# Build Perch's deployables from the vendor/perch submodule, each in its own
# invocation (one `cargo build` over several packages unifies features and
# links the full doc compiler into the account), in Perch's own workspace so
# Perch's lock and release profile apply. `stellar contract build` also shakes
# the contract spec, which a raw `cargo build` does not. Outputs land beside
# Nido's own wasm in target/wasm32v1-none/contract/. These are local builds of
# the pinned source, not release artifacts: they are replaced by the
# hash-verified wasm Perch's release workstream publishes.
build-perch:
    #!/usr/bin/env bash
    set -euo pipefail
    test -s vendor/perch/crates/perch-smart-account/wasm/stateless.id || {
        echo "vendor/perch infra cache missing: run 'git submodule update --init' and 'just perch-infra'" >&2
        exit 1
    }
    for p in perch-account perch-recovery perch-zk-pool perch-zk-adapter \
             perch-doc-compiler perch-interpreter perch-spending-limit; do
        CARGO_TARGET_DIR=target/perch stellar contract build \
            --manifest-path vendor/perch/Cargo.toml --package "$p" \
            --out-dir target/wasm32v1-none/contract --optimize
    done

# Regenerate the real UltraHonk proofs the recovery integration tests replay
# (crates/integration-tests/fixtures/zk/). Installs Perch's pinned nargo/bb
# under vendor/perch/target/zk-toolchain/, compiles Perch's circuit, and runs
# the integration suites in prove mode: each ZK test builds its statement through
# the real controller, proves it natively, and writes the fixture. Proofs are
# deterministic, so `git diff --exit-code crates/integration-tests/fixtures/zk`
# afterwards checks reproduction.
gen-zk-fixtures:
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(bash vendor/perch/scripts/zk-toolchain.sh)"
    (cd vendor/perch/circuits && "$NARGO" compile --workspace)
    NIDO_ZK_PROVE=1 cargo test -p nido-integration-tests --test it -- --test-threads=1

# Build and optimize Soroban contracts: Perch's deployables first (the
# factory's build.rs embeds the Perch account wasm), then Nido's own contracts.
#
# SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2: scaffold invokes raw
# `cargo rustc` rather than `stellar contract build`, so it does not set the
# signal soroban-sdk's build script expects; we set it here (we build with a
# new enough stellar-cli) so the build does not abort on spec-shaking.
#
# Scaffold does NOT run wasm-opt, so we optimize Nido's wasm in place
# afterwards; deployed wasm must stay optimized. Perch's wasm is already
# optimized by `build-perch`.
build-contracts: build-perch
    SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 stellar-scaffold build --profile contract
    @for wasm in target/wasm32v1-none/contract/nido_*.wasm; do \
        case "$wasm" in *.optimized.wasm) continue;; esac; \
        echo "→ optimize $wasm"; \
        stellar contract optimize --wasm "$wasm" --wasm-out "$wasm"; \
    done

build-ts:
    npx tsc -p ./packages/passkey-sdk/tsconfig.json

# Nido's own crates. Named explicitly because `cargo fmt --all` also formats
# local path dependencies, which would rewrite the vendor/perch submodule.
# Keep in sync with `[workspace.members]` in the root Cargo.toml.
fmt-pkgs := "-p nido-integration-tests -p nido-factory -p nido-multisig-policy -p nido-name-registry -p nido-preauth-sweep-policy -p nido-spending-limit-policy -p nido-status-message -p nido-webauthn-verifier"

# Check formatting and clippy
check:
    cargo fmt {{fmt-pkgs}} -- --check
    cargo clippy --all --tests -- -Dclippy::pedantic

fmt:
    cargo fmt {{fmt-pkgs}}

# Clean build artifacts
clean:
    cargo clean

check-astro:
    npx astro check --root ./packages/frontend

build-astro:
    npx astro build --root ./packages/frontend

cloudflare-deploy: build-astro
    npx wrangler pages deploy packages/frontend/dist/ --project-name mysoroban --branch main

dev: build-ts
    (cd packages/frontend; npm run dev)

# Run Tasks 4 & 4b: publish + deploy multisig-policy via stellar-registry,
# publish + upgrade factory. See scripts/deploy-policy-builder-v1.sh for what
# it does and the env-var overrides.
publish-policy-builder-v1 alias network="testnet":
    ./scripts/deploy-policy-builder-v1.sh {{alias}} {{network}}

# Deploy a Nido-owned stellar-registry instance and register factory/verifier/
# zk-recovery into it (plan A3). Fetches the reference registry wasm, redeploys
# it under our owner, records the wasm hash. Rehearse on testnet before mainnet;
# set FACTORY/VERIFIER/ZK_RECOVERY (+ OWNER/ctor args). See scripts/deploy-registry.sh.
publish-registry alias network="testnet":
    ./scripts/deploy-registry.sh {{alias}} {{network}}

# Regenerate one binding from a fresh .wasm and apply post-gen fixes.
# Usage: just bindings smart-account
# Run after `just build-contracts`. See scripts/fix-bindings.sh for what
# the post-gen pass does (stellar-sdk pin alignment + Context shim).
bindings name:
    stellar contract bindings typescript \
        --overwrite \
        --output-dir packages/contract-bindings/{{name}} \
        --wasm target/wasm32v1-none/contract/nido_{{replace(name, '-', '_')}}.wasm
    ./scripts/fix-bindings.sh

# Regenerate ALL bindings (assumes wasms in target/) and apply post-gen
# fixes once at the end.
bindings-all:
    @for name in smart-account factory multisig-policy webauthn-verifier; do \
        wasm="target/wasm32v1-none/contract/nido_$$(echo $$name | tr - _).wasm"; \
        echo "→ $$name ($$wasm)"; \
        stellar contract bindings typescript --overwrite \
            --output-dir packages/contract-bindings/$$name \
            --wasm "$$wasm"; \
    done
    ./scripts/fix-bindings.sh

# Run TestAuthenticator unit tests (vitest, node)
test-support:
    npx vitest run --config vitest.support.config.ts

# Fast UI e2e tier (shim) across all browsers; builds the frontend first
test-e2e: build-astro
    npx playwright test --grep @fast

# Chromium CDP virtual-authenticator fidelity lane; builds the frontend first
test-e2e-cdp: build-astro
    npx playwright test --project=chromium-cdp

# Sources tests/.env.testnet if present (set NIDO_TEST_BANK_SECRET there to a
# funded testnet G-account secret to skip friendbot for the name submitter);
# otherwise the app funds its own submitter via friendbot.
# Quarantined real-testnet e2e tier (create+deploy + name-claim); builds first
test-e2e-testnet: build-astro
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f tests/.env.testnet ]; then set -a; source tests/.env.testnet; set +a; fi
    npx playwright test --project=testnet-chromium --project=testnet-webkit
