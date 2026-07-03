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

# Deploy the relayer (incl. the Channels perf instrumentation) to fly.io and
# verify the plugin loaded + responds. Run from a tree where infra/relayer has
# the instrumented plugin (this branch), with flyctl authed. Does NOT run the
# perf spec — that lives on the harness branch: after this, run `just perf-create`
# there to light up the relayer.* bands, and `flyctl logs -a nido | grep
# channels.phase` to see the status timeline. Rollback: `flyctl releases -a nido`.
deploy-and-verify app="nido":
    #!/usr/bin/env bash
    set -euo pipefail
    echo "▶ pre-flight: plugin unit tests"
    npx vitest run --root infra/relayer/plugins/channels
    echo "▶ deploy → {{app}} (single machine, remote build)"
    flyctl deploy infra/relayer --remote-only --ha=false -a {{app}}
    echo "▶ health"
    for i in $(seq 1 20); do
      if curl -fsS "https://{{app}}.fly.dev/api/v1/health" >/dev/null 2>&1; then echo "  ✓ health ok"; break; fi
      [ "$i" -eq 20 ] && { echo "  ✗ health never came up — flyctl logs -a {{app}}" >&2; exit 1; }
      sleep 3
    done
    echo "▶ /relay plugin probe (getTransaction on a bogus id — proves the plugin loaded)"
    body="$(mktemp)"
    code="$(curl -s -o "$body" -w '%{http_code}' -X POST "https://{{app}}.fly.dev/relay" \
      -H 'content-type: application/json' \
      -d '{"params":{"getTransaction":{"transactionId":"perf-probe-000"}}}' || echo 000)"
    echo "  HTTP $code: $(cat "$body")"; rm -f "$body"
    if [ "$code" = "000" ] || [ "${code:0:1}" = "5" ]; then
      echo "  ✗ /relay probe failed (${code}) — plugin likely didn't load. flyctl logs -a {{app}}" >&2
      exit 1
    fi
    echo "✓ deployed + plugin live. Next: \`just perf-create\` (harness branch) →"
    echo "  the trace splits into relayer.* bands; \`flyctl logs -a {{app}} | grep channels.phase\`."
