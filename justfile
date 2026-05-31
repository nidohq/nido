# List available recipes
default:
    @just --list

# Run all workspace tests
test:
    cargo test --workspace

# Build all crates (native)
build:
    cargo build --workspace

# Build and optimize Soroban contracts
build-contracts:
    stellar contract build --optimize --profile contract

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
        --wasm target/wasm32v1-none/contract/g2c_{{replace(name, '-', '_')}}.wasm
    ./scripts/fix-bindings.sh

# Regenerate ALL bindings (assumes wasms in target/) and apply post-gen
# fixes once at the end.
bindings-all:
    @for name in smart-account factory multisig-policy webauthn-verifier; do \
        wasm="target/wasm32v1-none/contract/g2c_$$(echo $$name | tr - _).wasm"; \
        echo "→ $$name ($$wasm)"; \
        stellar contract bindings typescript --overwrite \
            --output-dir packages/contract-bindings/$$name \
            --wasm "$$wasm"; \
    done
    ./scripts/fix-bindings.sh
