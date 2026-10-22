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

# Fetch the Perch stack Nido builds and tests against: Perch's testnet
# deployment, by the hashes in vendor/perch/deployments/testnet.json
# (STELLAR_NETWORK picks another manifest). Writes the factory's account pin,
# contracts/factory/wasm/perch-account.sha256, from that manifest first. Puts
# every deployed contract's wasm in target/wasm32v1-none/contract/
# (perch_*.wasm), so the tests run the deployed bytes, including the account
# whose hash the factory pins. (The Perch crates build from the pins Perch commits; cargo
# fetches them at the submodule's commit, see the root Cargo.toml.) Perch's script refuses any
# file whose sha256 or content address differs from the manifest. Needs the
# Stellar CLI, curl and jq. Run once after cloning and after bumping
# vendor/perch. Reads the chain through the manifest's rpc_url, an
# RPC_URL/STELLAR_RPC_URL override, or a guarded fallback while the manifest's
# endpoint is down (scripts/perch-infra.sh; docs/RUNBOOKS.md "RPC endpoints").
perch-infra:
    scripts/perch-infra.sh

# Re-pin vendor/perch to a Perch commit (full 40-hex) and regenerate what the
# pin derives: the stack by manifest hash, Nido's contracts, the Perch
# bindings, the SDK's Perch pins, and the lockfiles; then the drift check
# and the Rust suites. Nido's factory is not redeployed: a re-pin that moves
# the account or verifier needs `just deploy-factory` on its branch before it
# merges. The perch-repin workflow runs this when Perch announces a
# deployment. See scripts/repin-perch.sh.
repin-perch commit:
    scripts/repin-perch.sh {{commit}}

# Check the vendored Perch stack hasn't drifted from what Nido builds against:
# the submodule at its recorded commit (on its declared branch), the fetched
# wasm, pin cache, and factory pin equal to the manifest's, and npm resolving
# Perch's packages to the submodule. See scripts/check-perch-drift.sh. Run after
# `just perch-infra` and `just build-contracts`.
check-vendor-drift:
    bash scripts/check-perch-drift.sh

# Regenerate the real UltraHonk proofs the recovery integration tests replay
# (crates/integration-tests/fixtures/zk/). Installs Perch's pinned nargo/bb
# under vendor/perch/target/zk-toolchain/, compiles Perch's circuit, and runs
# the integration suites in prove mode: each ZK test builds its statement through
# the real controller, proves it natively, verifies it through the deployed
# adapter, and writes the fixture. The proofs are zero-knowledge, so proving is
# randomized and the proof bytes change on every run; the fixture metadata
# (statement digest, root, nullifier) must not:
# `git diff --exit-code -- 'crates/integration-tests/fixtures/zk/*/fixture.json'`.
gen-zk-fixtures:
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(bash vendor/perch/scripts/zk-toolchain.sh)"
    (cd vendor/perch/circuits && "$NARGO" compile --workspace)
    NIDO_ZK_PROVE=1 cargo test -p nido-integration-tests --test it -- --test-threads=1

# Build and optimize Nido's Soroban contracts. The factory compiles in the
# perch-account hash in contracts/factory/wasm/perch-account.sha256
# (`registry_contract!`; `just perch-infra` writes it), and fails without it.
#
# SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2: scaffold invokes raw
# `cargo rustc` rather than `stellar contract build`, so it does not set the
# signal soroban-sdk's build script expects; we set it here (we build with a
# new enough stellar-cli) so the build does not abort on spec-shaking.
#
# Scaffold does NOT run wasm-opt, so we optimize Nido's wasm in place
# afterwards; deployed wasm must stay optimized.
build-contracts:
    SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 stellar-scaffold build --profile contract
    @for wasm in target/wasm32v1-none/contract/nido_*.wasm; do \
        case "$wasm" in *.optimized.wasm) continue;; esac; \
        echo "→ optimize $wasm"; \
        stellar contract optimize --wasm "$wasm" --wasm-out "$wasm"; \
    done

build-ts:
    npx tsc -p ./packages/passkey-sdk/tsconfig.json

# Check formatting and clippy
check:
    cargo fmt --all -- --check
    cargo clippy --all --tests -- -Dclippy::pedantic

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

# Deploy Nido's factory around Perch's deployed account and pin Perch's
# WebAuthn verifier, and write its record
# (packages/passkey-sdk/src/perch/factory.<network>.json). Registers no name.
# See scripts/deploy-factory.sh.
deploy-factory identity network="testnet":
    ./scripts/deploy-factory.sh {{identity}} {{network}}

# Check the factory record against the chain: the deployed factory's wasm,
# the account hash it deploys (also against the manifest), its pinned
# verifier, its admin, and its manager. Read-only.
# See scripts/check-factory.sh.
check-factory network="testnet":
    ./scripts/check-factory.sh {{network}}

# Deploy a Nido-owned stellar-registry instance and register factory/verifier
# into it (plan A3). Fetches the reference registry wasm, redeploys it under our
# owner, records the wasm hash. Rehearse on testnet before mainnet; set
# FACTORY/VERIFIER (+ OWNER/ctor args). See scripts/deploy-registry.sh.
publish-registry alias network="testnet":
    ./scripts/deploy-registry.sh {{alias}} {{network}}

# Regenerate one binding from a fresh .wasm and apply post-gen fixes.
# Usage: just bindings factory
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
    @for name in factory multisig-policy spending-limit-policy status-message; do \
        wasm="target/wasm32v1-none/contract/nido_$(echo $name | tr - _).wasm"; \
        echo "→ $name ($wasm)"; \
        stellar contract bindings typescript --overwrite \
            --output-dir packages/contract-bindings/$name \
            --wasm "$wasm"; \
    done
    ./scripts/fix-bindings.sh

# Regenerate the TypeScript clients for Perch's deployables
# (packages/contract-bindings/perch-*) from the deployed wasm `just perch-infra`
# fetched. Local stand-ins until Perch publishes @stellar-registry/perch-contracts.
bindings-perch:
    @for name in perch-account perch-recovery perch-zk-pool perch-zk-adapter perch-doc-compiler; do \
        wasm="target/wasm32v1-none/contract/$(echo $name | tr - _).wasm"; \
        echo "→ $name ($wasm)"; \
        stellar contract bindings typescript --overwrite \
            --output-dir packages/contract-bindings/$name \
            --wasm "$wasm"; \
        git checkout -- packages/contract-bindings/$name/package.json; \
    done
    ./scripts/fix-bindings.sh

# Run TestAuthenticator unit tests (vitest, node)
test-support:
    npx vitest run --config vitest.support.config.ts

# Fast UI e2e tier (shim) across all browsers; builds the frontend first
test-e2e:
    PUBLIC_PERCH_DEPLOYMENT=none npx astro build --root ./packages/frontend
    npx playwright test --grep @fast

# Chromium CDP virtual-authenticator fidelity lane; builds the frontend first
test-e2e-cdp:
    PUBLIC_PERCH_DEPLOYMENT=none npx astro build --root ./packages/frontend
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
