#!/usr/bin/env bash
# `just perch-infra`: fetch Perch's deployed stack into
# target/wasm32v1-none/contract/ with Perch's scripts/fetch-infra-wasm.sh at
# Nido's Perch pin (scripts/perch-src.sh fetches that source),
# reading the chain through the endpoint scripts/stellar-rpc.sh chooses
# (RPC_URL/STELLAR_RPC_URL override, else the manifest's rpc_url, else a
# guarded fallback while that is down; docs/RUNBOOKS.md "RPC endpoints").
#
# A Perch fetch script that sources stellar-rpc.sh itself chooses and fails
# over per fetch; it is run as is. An older one reads only the manifest's
# rpc_url, so it is given a copy of the manifest whose rpc_url is the chosen
# endpoint (every other field, so every hash and content address it checks,
# unchanged). If that run fails because the endpoint failed a fetch after the
# script's own retries, the run moves to the next guarded fallback and starts
# again. Any other failure (a hash or content-address mismatch, a contract
# error, a missing entry) fails as it is.
#
# It first writes the manifest's `perch-account` hash to the factory's pin,
# contracts/factory/wasm/perch-account.sha256, which the factory's
# `registry_contract!` compiles in. A manifest without that hash fails here:
# the pin never comes from another network.
#
# With [workspace.metadata.perch] stack = "build", it builds the stack from
# the pinned source instead (below).
#
# Env: STELLAR_NETWORK (default testnet) picks Perch's deployments/<net>.json;
# NIDO_PERCH_DIR overrides the pinned Perch source and NIDO_FACTORY_PIN the
# pin file (tests).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# A stack built from source: the Cargo patch that builds the native Perch
# crates from the same source (scripts/perch-overlay.sh).
[ -n "${NIDO_PERCH_DIR:-}" ] || "$repo_root/scripts/perch-overlay.sh"
perch="$("$repo_root/scripts/perch-src.sh")"
stack="$repo_root/target/wasm32v1-none/contract"
network="${STELLAR_NETWORK:-testnet}"
manifest="$perch/deployments/$network.json"
fetch="$perch/scripts/fetch-infra-wasm.sh"
[ -f "$manifest" ] || { echo "error: no manifest at $manifest" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }

built=""
if [ "$("$repo_root/scripts/perch-src.sh" --stack)" = build ]; then
    # Nothing deploys the pin: build its stack from the pinned source with
    # Perch's scripts/build-stack.sh (which also writes each tier's pins into
    # the source, for the next tier and the native crates) into
    # target/perch-stack/, once per rev, and record it as the manifest
    # everything else reads (scripts/perch-src.sh --manifest): each
    # contract's sha256 and version, the registries the stack's paths derive
    # on the network, and the passphrase and RPC of the pin's own manifest.
    # Nothing is fetched; the chain is not read.
    out="$repo_root/target/perch-stack"
    rev="$("$repo_root/scripts/perch-src.sh" --rev)"
    account_pin="$perch/crates/perch-account-factory/wasm/perch-account.sha256"
    if [ "$(jq -r '.source.commit // empty' "$out/build.json" 2>/dev/null)" != "$rev" ] ||
        [ "$(tr -d '[:space:]' <"$account_pin")" != "$(jq -r '.artifacts[] | select(.package == "perch-account") | .sha256' "$out/build.json")" ]; then
        (cd "$perch" && bash scripts/build-stack.sh --out "$out" --network-passphrase "$(jq -r .network_passphrase "$manifest")")
    fi
    mkdir -p "$stack"
    cp "$out"/*.wasm "$stack/"
    jq --slurpfile src "$manifest" --arg network "$network" '{
        network: $network,
        network_passphrase: $src[0].network_passphrase,
        rpc_url: $src[0].rpc_url,
        built_from_source: true,
        source: .source,
        toolchain: .toolchain,
        registry: {id: .registry},
        verifier_registry: .verifier_registry,
        contracts: ([.artifacts[] | {key: .package, value: {sha256, version}}] | from_entries)
    }' "$out/build.json" >"$out/$network.json"
    manifest="$out/$network.json"
    built=1
fi

pin="${NIDO_FACTORY_PIN:-$repo_root/contracts/factory/wasm/perch-account.sha256}"
account="$(jq -r '.contracts["perch-account"].sha256 // empty' "$manifest")"
[[ "$account" =~ ^[0-9a-f]{64}$ ]] ||
    { echo "error: $manifest has no perch-account hash for the factory to pin" >&2; exit 1; }
printf '%s\n' "$account" >"$pin"
[ -z "$built" ] || { echo "perch-infra: Perch ${rev:0:7} built from source into $stack ($manifest)" >&2; exit 0; }

if grep -q 'stellar-rpc\.sh' "$fetch"; then
    cd "$perch" && exec bash "$fetch" --manifest "$manifest" --stack "$stack"
fi

# shellcheck source=scripts/stellar-rpc.sh
. "$repo_root/scripts/stellar-rpc.sh"
rpc_select "$(jq -r .rpc_url "$manifest")" "$(jq -r .network_passphrase "$manifest")" ||
    { echo "error: no usable RPC endpoint" >&2; exit 1; }

copy="$repo_root/target/perch-infra/$(basename "$manifest")"
mkdir -p "$(dirname "$copy")"
err="$(mktemp)"
trap 'rm -f "$_rpc_state" "$err"' EXIT
while :; do
    url="$(rpc_url)"
    jq --arg u "$url" '.rpc_url = $u' "$manifest" >"$copy"
    _rpc_log "fetch-infra-wasm.sh: every fetch in this run <- $url"
    rc=0
    # stderr to the terminal and to $err; stdout untouched.
    { (cd "$perch" && bash "$fetch" --manifest "$copy" --stack "$stack") 2>&1 1>&3 | tee "$err" >&2; } 3>&1 || rc=$?
    [ "$rc" -ne 0 ] || exit 0
    # The fetch script exhausted its retries against the endpoint ("fetch
    # failed after N attempts"); anything else is not the endpoint's fault.
    grep -q 'fetch failed after' "$err" || exit "$rc"
    _rpc_server_error=false
    ! _rpc_server_side "$err" || _rpc_server_error=true
    rpc_failover || exit "$rc"
done
