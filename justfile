# List available recipes
default:
    @just --list

# Run all workspace tests
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

# Rerun the zk_recovery circuit build and re-stage its vk/proof/public_inputs
# artifacts as test fixtures under crates/integration-tests/fixtures/zk/ (used
# by crates/zk-bench's real-metering budget gate and any other zk-verifier
# integration tests). Records the staged fixtures' sha256 into
# crates/integration-tests/fixtures/zk/manifest.json, alongside a pointer at
# the circuit build's own manifest (circuits/zk_recovery/public/circuits/manifest.json)
# for cross-checking provenance.
gen-zk-fixtures:
    #!/usr/bin/env bash
    set -euo pipefail
    just build-circuits
    mkdir -p crates/integration-tests/fixtures/zk
    cp circuits/zk_recovery/target/vk crates/integration-tests/fixtures/zk/vk
    cp circuits/zk_recovery/target/proof crates/integration-tests/fixtures/zk/proof
    cp circuits/zk_recovery/target/public_inputs crates/integration-tests/fixtures/zk/public_inputs
    vk_sha=$(sha256sum crates/integration-tests/fixtures/zk/vk | cut -d' ' -f1)
    proof_sha=$(sha256sum crates/integration-tests/fixtures/zk/proof | cut -d' ' -f1)
    pub_sha=$(sha256sum crates/integration-tests/fixtures/zk/public_inputs | cut -d' ' -f1)
    built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '{\n  "vkSha256": "%s",\n  "proofSha256": "%s",\n  "publicInputsSha256": "%s",\n  "sourceCircuitManifest": "circuits/zk_recovery/public/circuits/manifest.json",\n  "builtAt": "%s"\n}\n' \
        "$vk_sha" "$proof_sha" "$pub_sha" "$built_at" > crates/integration-tests/fixtures/zk/manifest.json
    echo "[ok] Staged zk fixtures + wrote manifest:"
    cat crates/integration-tests/fixtures/zk/manifest.json

# Task 4 GO/NO-GO gate: real-metering verify_proof CPU cost (<=250M gate, real 400M tx cap), measured
# against the real depth-24 circuit's proof/vk/public_inputs fixtures via a
# registered (not native) Wasm verifier contract. See
# crates/zk-bench/tests/budget.rs for the full metering methodology.
bench-zk:
    cargo test -p nido-zk-bench --test budget -- --nocapture

# Build and optimize Soroban contracts.
# `stellar-scaffold build` topologically sorts the contract crates (via the
# `[package.metadata.stellar] contract = true` edges) so dependencies build
# first — notably smart-account before the factory, whose build.rs embeds the
# smart-account wasm.
#
# SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2: scaffold invokes raw
# `cargo rustc` rather than `stellar contract build`, so it does not set the
# signal soroban-sdk 26's build script expects; we set it here (we build with a
# new enough stellar-cli) so the build does not abort on spec-shaking.
#
# Scaffold does NOT run wasm-opt, so we optimize in-place afterwards (the old
# `stellar contract build --optimize` did this); deployed wasm must stay
# optimized.
build-contracts:
    SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 stellar-scaffold build --profile contract
    @for wasm in target/wasm32v1-none/contract/*.wasm; do \
        case "$wasm" in *.optimized.wasm) continue;; esac; \
        echo "→ optimize $wasm"; \
        stellar contract optimize --wasm "$wasm" --wasm-out "$wasm"; \
    done

build-ts:
    npx tsc -p ./packages/passkey-sdk/tsconfig.json

# Check formatting and clippy
check:
    cargo fmt --all -- --check
    cargo clippy  --all --tests -- -Dclippy::pedantic

# Format all code
fmt:
    cargo fmt --all

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
