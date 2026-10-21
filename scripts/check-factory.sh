#!/usr/bin/env bash
#
# Check Nido's factory record (packages/passkey-sdk/src/perch/
# factory.<network>.json, written by scripts/deploy-factory.sh) against the
# chain, and the account hash the factory pins against Perch's manifest.
# Read-only: no identity, nothing signed.
#
# From the factory's instance: its executable wasm hash, its pinned WebAuthn
# verifier (`PinnedVerifier`), its admin (`ADMIN`), and its manager
# (`Manager`, none for a record without one). From a simulated
# `account_wasm_hash` call: the account hash it deploys, pinned when its wasm
# was built (a factory from before the pin has no such call; its hash is the
# `Account` cache in its instance). Each must equal the record's.
#
# The account hash must also equal the manifest's `perch-account`
# (vendor/perch/deployments/<network>.json) when the record says the factory
# was built at vendor/perch's commit (`source.perch_commit`). A record from an
# earlier Perch commit was checked against that commit's manifest when it was
# deployed; the difference is reported, not failed, and
# packages/passkey-sdk/src/perch/deployment.test.ts holds it until the factory
# is redeployed.
#
# The read goes through scripts/stellar-rpc.sh: RPC_URL/STELLAR_RPC_URL if
# set, else Perch's manifest's rpc_url (vendor/perch/deployments/<network>.json),
# else a guarded fallback while that is down, also mid-run (docs/RUNBOOKS.md
# "RPC endpoints").
#
# Usage: scripts/check-factory.sh [network]   (default "testnet")
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }

NETWORK="${1:-testnet}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RECORD="$REPO_ROOT/packages/passkey-sdk/src/perch/factory.$NETWORK.json"

command -v stellar >/dev/null || die "stellar CLI not found"
command -v jq >/dev/null || die "jq not found"
command -v curl >/dev/null || die "curl not found"
[ -f "$RECORD" ] || die "no factory record at $RECORD"
MANIFEST="$REPO_ROOT/vendor/perch/deployments/$NETWORK.json"
[ -f "$MANIFEST" ] || die "no Perch manifest at $MANIFEST (git submodule update --init)"

r() { jq -r "$1" "$RECORD"; }
# The all-zero account: a valid address nobody holds the key to.
SIMULATE_AS=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
FACTORY="$(r .factory)"
[[ "$FACTORY" =~ ^C[A-Z2-7]{55}$ ]] || die "$RECORD has no factory address"

PASSPHRASE="$(r .network_passphrase)"
[ "$PASSPHRASE" = "$(jq -r .network_passphrase "$MANIFEST")" ] || die "$RECORD and $MANIFEST name different networks"
# shellcheck source=scripts/stellar-rpc.sh
. "$REPO_ROOT/scripts/stellar-rpc.sh"
rpc_select "$(jq -r .rpc_url "$MANIFEST")" "$PASSPHRASE" || die "no usable RPC endpoint for $NETWORK"

instance="$(rpc_stellar ledger entry fetch contract-data --contract "$FACTORY" --instance --output json \
    | jq -c '[.. | objects | select(has("contract_instance")) | .contract_instance][0]')"
[ "$instance" != null ] || die "no contract instance for $FACTORY on $NETWORK"

stored() { jq -r --arg k "$1" '.storage[]? | select(.key.symbol == $k) | .val | (.bytes // .address // .u32)' <<<"$instance"; }

# Any account will do as the source of a simulation; nothing is signed.
err="$(mktemp)"
if account="$(rpc_stellar contract invoke --id "$FACTORY" --source-account "$SIMULATE_AS" --send=no \
        -- account_wasm_hash 2>"$err" | tr -d '"')"; then
    account_from="account_wasm_hash"
elif account="$(stored Account)" && [ -n "$account" ]; then
    account_from="the Account cache of a factory from before the pin"
else
    cat "$err" >&2
    die "cannot read the account hash $FACTORY deploys"
fi
rm -f "$err"
problems=0
check() {
    if [ "$2" = "$3" ]; then
        echo "  $1: ${2:-<none>}"
    else
        echo "error: $1 is ${2:-<none>} on chain, ${3} in the record" >&2
        problems=$((problems + 1))
    fi
}

echo "factory $FACTORY ($NETWORK)"
check "wasm" "$(jq -r '.executable.wasm' <<<"$instance")" "$(r .wasm_hash)"
check "account it deploys ($account_from)" "$account" "$(r .account_wasm_hash)"
check "pinned verifier" "$(stored PinnedVerifier)" "$(r .pinned_verifier)"
check "admin" "$(stored ADMIN)" "$(r .admin)"
# Factories from before the manager have none, and neither do their records.
check "manager" "$(stored Manager)" "$(r '.manager // empty')"
[ "$problems" -eq 0 ] || die "$RECORD does not describe the deployed factory ($problems mismatches)"

manifest_account="$(jq -r '.contracts["perch-account"].sha256 // empty' "$MANIFEST")"
[[ "$manifest_account" =~ ^[0-9a-f]{64}$ ]] || die "$MANIFEST has no perch-account hash"
built_at="$(r '.source.perch_commit // empty')"
perch_at="$(git -C "$REPO_ROOT/vendor/perch" rev-parse HEAD)"
if [ "$account" = "$manifest_account" ]; then
    echo "  account it deploys is the manifest's perch-account"
elif [ "$built_at" = "$perch_at" ]; then
    die "$FACTORY deploys account $account; $MANIFEST names $manifest_account"
else
    echo "  account it deploys is not the manifest's perch-account ($manifest_account): the factory was built at Perch ${built_at:0:7}, vendor/perch is at ${perch_at:0:7}; redeploy it (just deploy-factory)"
fi
