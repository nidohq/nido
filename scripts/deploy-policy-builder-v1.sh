#!/usr/bin/env bash
#
# Tasks 4 & 4b of the Policy Builder v1 plan:
#   - Publish + deploy the multisig-policy under its canonical registry name
#   - Ensure the WebAuthn verifier is registered by name (publish + deploy
#     if not)
#   - Publish + upgrade the factory wasm via the stellar-registry
#
# Idempotent: each step checks current state and skips work that's already done.
#
# Usage:
#   ./scripts/deploy-policy-builder-v1.sh <stellar-keys-alias> [network]
#
#   <alias>   Required. The `stellar keys` identity authorized to publish under
#             your registry namespace (see `stellar keys ls`).
#   [network] Optional, defaults to "testnet". Sets STELLAR_NETWORK for the
#             stellar-registry CLI (which doesn't accept --network directly).
#
# Prerequisites:
#   - `stellar` CLI (>= 26)
#   - `just` available on PATH
#   - The deployed factory's existing contract ID matches FACTORY_CONTRACT_ID
#     below; if you've redeployed elsewhere, edit the constant or pass
#     FACTORY_CONTRACT_ID as an env var.
#
# Environment overrides:
#   FACTORY_CONTRACT_ID  Existing deployed factory address (default = the
#                        testnet instance the frontend currently targets).
#   POLICY_VERSION       multisig-policy semantic version (default 0.1.0).
#   FACTORY_VERSION      factory wasm version to publish + upgrade to
#                        (default 0.2.0).
#   REGISTRY_PREFIX      Prefix for unverified registry names (default
#                        "unverified/"). Set to "" to use the verified
#                        registry (requires curation rights).
#   SKIP_BUILD           If set, skip `just build-contracts`.
#
# Re-deploying a non-upgradable contract (factory / multisig-policy /
# verifier in their current form):
#
# None of the policy-builder-v1 contracts have admin()/upgrade(); to
# ship a new WASM you must deploy a fresh contract at a new address and
# repoint the registry name. Pattern (verified, used on testnet):
#
#   stellar contract deploy --wasm target/.../<name>.wasm \
#     --source-account <alias> --network <net>
#   # captures the new C-address
#
#   stellar contract invoke --id <REGISTRY> --source-account <alias> \
#     --network <net> -- update_contract_address \
#     --contract_name <name>             # bare, no prefix \
#     --new_address <new C-address>
#
# REGISTRY for testnet is CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S
# (the unverified registry). The CLI's "registry deploy/upgrade" flow
# assumes a contract that can self-upgrade or be re-registered; the
# above manual pattern works when neither holds. See #25 / #26 for the
# long-term factory rewrite.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "usage: $0 <stellar-keys-alias> [network]" >&2
    echo "  see 'stellar keys ls' for available aliases" >&2
    exit 1
fi

ALIAS="$1"
NETWORK="${2:-testnet}"
export STELLAR_NETWORK="$NETWORK"   # the CLI doesn't take --network; reads env

FACTORY_CONTRACT_ID="${FACTORY_CONTRACT_ID:-CDQDNOT4RWQKAIJIZYJE5HK7DMIVTYBJ4QXHIERNOZPPYMUNBT2JZ2SK}"
POLICY_VERSION="${POLICY_VERSION:-0.2.0}"
VERIFIER_VERSION="${VERIFIER_VERSION:-0.2.0}"
FACTORY_VERSION="${FACTORY_VERSION:-0.3.0}"
REGISTRY_PREFIX="${REGISTRY_PREFIX:-unverified/}"

# Canonical registry names (prefixed). These are what `factory.resolve(name)`
# looks up — but the contract calls `fetch_contract_id` with the BARE name
# (without prefix). The verified registry's `unverified` namespace then maps
# bare names to the unverified entries. If your CLI is configured for a
# specific named registry, this prefix lets us pass through without changing
# the factory source.
POLICY_NAME="${REGISTRY_PREFIX}multisig-policy"
VERIFIER_NAME="${REGISTRY_PREFIX}verifier"
FACTORY_NAME="${REGISTRY_PREFIX}factory"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POLICY_WASM="$REPO_ROOT/target/wasm32v1-none/contract/g2c_multisig_policy.wasm"
VERIFIER_WASM="$REPO_ROOT/target/wasm32v1-none/contract/g2c_webauthn_verifier.wasm"
FACTORY_WASM="$REPO_ROOT/target/wasm32v1-none/contract/g2c_factory.wasm"

cd "$REPO_ROOT"

# --- helpers --------------------------------------------------------------

note()   { printf "\n\033[1m▸ %s\033[0m\n" "$*"; }
ok()     { printf "  \033[32m✓\033[0m %s\n" "$*"; }
skip()   { printf "  \033[90m·\033[0m %s\n" "$*"; }
warn()   { printf "  \033[33m!\033[0m %s\n" "$*" >&2; }
die()    { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# Returns the contract ID for a registered name, empty string if not registered.
# Only reads stdout (stderr can contain unrelated C-addresses from error
# messages, which would false-positive a grep). Errors → empty.
fetch_contract_id() {
    local name="$1" out
    out="$(stellar registry fetch-contract-id "$name" --source-account "$ALIAS" 2>/dev/null)" \
        || return 0
    printf '%s' "$out" | grep -oE 'C[A-Z0-9]{55}' | head -1
}

# Returns the wasm hash for a published (name, version), empty if not published.
fetch_hash() {
    local name="$1" version="$2" out
    out="$(stellar registry fetch-hash "$name" --version "$version" --source-account "$ALIAS" 2>/dev/null)" \
        || return 0
    printf '%s' "$out" | grep -oE '[0-9a-f]{64}' | head -1
}

# --- preflight ------------------------------------------------------------

note "Preflight"

command -v stellar >/dev/null \
    || die "'stellar' CLI not found on PATH"
command -v just >/dev/null \
    || die "'just' not found on PATH (needed for build-contracts)"

if ! stellar keys ls 2>/dev/null | grep -qx "$ALIAS"; then
    die "'$ALIAS' is not a known stellar keys alias. Run 'stellar keys ls' to check."
fi
ok "Using stellar keys alias: $ALIAS"
ok "Network (STELLAR_NETWORK): $NETWORK"
ok "Registry prefix: '${REGISTRY_PREFIX}' (override via REGISTRY_PREFIX env)"
ok "Factory contract: $FACTORY_CONTRACT_ID"

if [ -z "${SKIP_BUILD:-}" ]; then
    note "Building contracts (set SKIP_BUILD=1 to skip)"
    just build-contracts >/dev/null
    ok "build-contracts complete"
fi

for wasm in "$POLICY_WASM" "$VERIFIER_WASM" "$FACTORY_WASM"; do
    [ -f "$wasm" ] || die "expected wasm not found: $wasm (run 'just build-contracts' first)"
done

# --- Task 4: multisig-policy ---------------------------------------------

note "Task 4 · multisig-policy v$POLICY_VERSION"

published_hash="$(fetch_hash "$POLICY_NAME" "$POLICY_VERSION")"
if [ -n "$published_hash" ]; then
    skip "$POLICY_NAME@$POLICY_VERSION already published (hash $published_hash)"
else
    # --wasm-name and --binver override what's read from contract metadata,
    # so we can publish under bare/prefixed names regardless of the
    # crate's Cargo.toml `[package].name` (which is `g2c-multisig-policy`).
    stellar registry publish \
        --wasm "$POLICY_WASM" \
        --wasm-name "$POLICY_NAME" \
        --binver "$POLICY_VERSION" \
        --source-account "$ALIAS"
    ok "published $POLICY_NAME@$POLICY_VERSION"
fi

policy_addr="$(fetch_contract_id "$POLICY_NAME")"
if [ -n "$policy_addr" ]; then
    skip "$POLICY_NAME already deployed: $policy_addr"
else
    stellar registry deploy \
        --contract-name "$POLICY_NAME" \
        --wasm-name "$POLICY_NAME" \
        --version "$POLICY_VERSION" \
        --source-account "$ALIAS"
    policy_addr="$(fetch_contract_id "$POLICY_NAME")"
    ok "deployed $POLICY_NAME: $policy_addr"
fi

# --- Verifier (publish + deploy if missing) -----------------------------

note "verifier · ensure registered by name"

verifier_addr="$(fetch_contract_id "$VERIFIER_NAME")"
if [ -n "$verifier_addr" ]; then
    skip "$VERIFIER_NAME already registered: $verifier_addr"
else
    warn "'$VERIFIER_NAME' is not registered in the registry."
    warn "The factory's pre-upgrade verifier (if any) was lazy-deployed from a"
    warn "hardcoded hash, so it has no registry name. Publishing the current"
    warn "verifier wasm and deploying it under '$VERIFIER_NAME'. The resulting"
    warn "contract address WILL DIFFER from any pre-existing unregistered"
    warn "verifier deployment — accounts created BEFORE this script ran"
    warn "reference the old address; new accounts will use the registered one."

    if [ -z "$(fetch_hash "$VERIFIER_NAME" "$VERIFIER_VERSION")" ]; then
        stellar registry publish \
            --wasm "$VERIFIER_WASM" \
            --wasm-name "$VERIFIER_NAME" \
            --binver "$VERIFIER_VERSION" \
            --source-account "$ALIAS"
        ok "published $VERIFIER_NAME@$VERIFIER_VERSION"
    else
        skip "$VERIFIER_NAME@$VERIFIER_VERSION already published"
    fi

    stellar registry deploy \
        --contract-name "$VERIFIER_NAME" \
        --wasm-name "$VERIFIER_NAME" \
        --version "$VERIFIER_VERSION" \
        --source-account "$ALIAS"
    verifier_addr="$(fetch_contract_id "$VERIFIER_NAME")"
    ok "deployed $VERIFIER_NAME: $verifier_addr"
fi

# --- Task 4b: factory publish + upgrade ----------------------------------

note "Task 4b · factory v$FACTORY_VERSION"

published_factory_hash="$(fetch_hash "$FACTORY_NAME" "$FACTORY_VERSION")"
if [ -n "$published_factory_hash" ]; then
    skip "$FACTORY_NAME@$FACTORY_VERSION already published (hash $published_factory_hash)"
else
    stellar registry publish \
        --wasm "$FACTORY_WASM" \
        --wasm-name "$FACTORY_NAME" \
        --binver "$FACTORY_VERSION" \
        --source-account "$ALIAS"
    ok "published $FACTORY_NAME@$FACTORY_VERSION"
fi

registered_factory="$(fetch_contract_id "$FACTORY_NAME")"
if [ -z "$registered_factory" ]; then
    warn "$FACTORY_NAME at $FACTORY_CONTRACT_ID is not yet registered by name."
    warn "Registering so 'stellar registry upgrade' can target it."
    stellar registry register-contract \
        --contract-name "$FACTORY_NAME" \
        --contract-address "$FACTORY_CONTRACT_ID" \
        --owner "$ALIAS" \
        --source-account "$ALIAS"
    registered_factory="$(fetch_contract_id "$FACTORY_NAME")"
    ok "registered $FACTORY_NAME: $registered_factory"
elif [ "$registered_factory" != "$FACTORY_CONTRACT_ID" ]; then
    die "registered $FACTORY_NAME ($registered_factory) does not match FACTORY_CONTRACT_ID ($FACTORY_CONTRACT_ID). Set FACTORY_CONTRACT_ID env var if you're targeting a different deployment."
else
    skip "$FACTORY_NAME already registered as $registered_factory"
fi

# `--version` is JSON-parsed by the registry CLI, so bare `0.2.0` fails as
# "trailing characters" (0.2 is a valid JSON number, then `.0` errors). Quote
# it as a JSON string.
if stellar registry upgrade \
    --contract-name "$FACTORY_NAME" \
    --wasm-name "$FACTORY_NAME" \
    --version "\"$FACTORY_VERSION\"" \
    --source-account "$ALIAS" 2>/tmp/upgrade.err
then
    ok "upgraded $FACTORY_NAME to $FACTORY_VERSION"
else
    rc=$?
    if grep -q "non-existent contract function.*upgrade\|non-existent contract function.*admin" /tmp/upgrade.err; then
        warn "factory upgrade SKIPPED: the deployed contract at"
        warn "  $FACTORY_CONTRACT_ID"
        warn "doesn't implement the admin()/upgrade(hash) methods that"
        warn "stellar-registry's 'upgrade' flow requires. The factory wasn't"
        warn "designed with upgrade machinery; in-place upgrade isn't possible."
        warn ""
        warn "This isn't a blocker for the policy-builder v1 flows: the SDK"
        warn "and /security UI talk to smart accounts directly (not the"
        warn "factory). Multisig-policy + verifier are deployed and"
        warn "registered, so add_context_rule + the registry lookups work."
        warn ""
        warn "If you want NEW accounts to use the registered verifier (rather"
        warn "than the old lazy-deployed hash-based one), deploy a fresh"
        warn "factory at a NEW address and update the frontend's"
        warn "FACTORY_CONTRACT_ID — a follow-up task, not required for v1."
    else
        warn "factory upgrade failed (rc=$rc):"
        sed 's/^/    /' /tmp/upgrade.err >&2
        exit "$rc"
    fi
fi
rm -f /tmp/upgrade.err

# --- Summary ---------------------------------------------------------

note "Done."
cat <<EOF

Summary:
  $POLICY_NAME@$POLICY_VERSION   $policy_addr
  $VERIFIER_NAME (registered)     $verifier_addr
  $FACTORY_NAME                   $registered_factory (registered by name)

The multisig-policy contract and the WebAuthn verifier are now deployed and
registered. The policy-builder UI on /security can be used against any
existing account to set up recovery rules or delegate session keys —
add_context_rule + the registry resolution happen at the SDK layer, no
factory involvement needed.

Notes:
- The existing factory at $FACTORY_CONTRACT_ID could not be upgraded in
  place (it doesn't implement admin()/upgrade()). If the warning above
  surfaced, the factory continues to lazy-deploy the OLD hash-based
  verifier for newly-created accounts. To switch newly-created accounts to
  the registered '$VERIFIER_NAME' contract, deploy a fresh factory and
  update the frontend FACTORY_CONTRACT_ID — separate follow-up.
- Both the multisig-policy and the registered verifier are reachable by
  name via 'stellar registry fetch-contract-id <name> --source-account
  <alias>'. The SDK's policyChainFetch.fetchRegistryAddress(name) does the
  same simulate-only lookup at runtime.

Next: the policy-builder UI on /security is operational. Use the inline
forms to set up a recovery rule or delegate a session key on any account.
EOF
