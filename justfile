# List available recipes
default:
    @just --list

# Run all workspace tests
test:
    cargo test --workspace

# Build all crates (native)
build:
    cargo build --workspace

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

# E2E create-run perf harness: REAL CDP virtual authenticator on REAL testnet.
# Runs the perf spec PERF_RUNS times (default 5), prints a per-phase
# `% of total` table, and writes perf-results/<ts>-create.json (gitignored).
# Investigation tool, NOT a CI gate — never fails on slowness.
#
# Account creation goes through the Channels relayer, so the frontend must be
# BUILT with PUBLIC_RELAYER_URL / PUBLIC_RELAYER_SIM_SOURCE. The canonical
# testnet values (same as .github/workflows/deploy.yml and
# infra/relayer/README.md) are baked in below, so this works out of the box —
# the create flow self-funds via friendbot, no bank secret needed. Override
# either var (or add NIDO_TEST_BANK_SECRET) via tests/.env.testnet.
# Usage: `just perf-create` or `just perf-create 10`.
perf-create runs="5":
    #!/usr/bin/env bash
    set -euo pipefail
    # tests/.env.testnet takes precedence; canonical testnet defaults fill the rest.
    if [ -f tests/.env.testnet ]; then set -a; source tests/.env.testnet; set +a; fi
    export PUBLIC_RELAYER_URL="${PUBLIC_RELAYER_URL:-https://nido.fly.dev}"
    export PUBLIC_RELAYER_SIM_SOURCE="${PUBLIC_RELAYER_SIM_SOURCE:-GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2}"
    if ! [[ "$PUBLIC_RELAYER_SIM_SOURCE" =~ ^G[A-Z2-7]{55}$ ]]; then
      echo "error: PUBLIC_RELAYER_SIM_SOURCE is not a 56-char G-address: '$PUBLIC_RELAYER_SIM_SOURCE'" >&2
      echo "       fix or remove it in tests/.env.testnet — canonical value ends ...IR63JFK2" >&2
      exit 1
    fi
    npx astro build --root ./packages/frontend
    PERF_RUNS={{runs}} npx playwright test --project=testnet-chromium tests/e2e/testnet/account-create-perf.testnet.spec.ts
