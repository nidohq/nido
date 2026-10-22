#!/usr/bin/env bash
#
# Deploy Nido's account factory around Perch's deployed account (RUNBOOKS §2.2).
#
#   1. Check the staged account wasm (target/wasm32v1-none/contract/
#      perch_account.wasm, from `just perch-infra`) is the manifest's
#      `perch-account`, install it on the network, and read the installed
#      code back from the ledger by that hash: the factory deploys accounts
#      by the hash it pins, and `create_account` fails until that code is
#      installed.
#   2. Check the factory's account pin (contracts/factory/wasm/
#      perch-account.sha256, which `STELLAR_NETWORK=<network> just
#      perch-infra` writes) is the manifest's `perch-account`, then build
#      Nido's contracts (`just build-contracts`; the factory's
#      `registry_contract!` compiles the pin in) unless SKIP_BUILD is set.
#   3. Check the factory wasm carries the manifest's account hash, before
#      anything is deployed: a SKIP_BUILD wasm built from another network's
#      or Perch commit's pin is refused here.
#   4. Deploy the factory with the paying identity as its admin, Perch's
#      WebAuthn verifier pinned, and MANAGER (if set) as the address that
#      must authorize every account creation, all constructor arguments:
#      account creation never consults the registry.
#   5. Read the verifier pin, the manager, and the account hash the factory
#      deploys (`account_wasm_hash`) back, and check the hash against the
#      manifest.
#   6. Hand the factory to ADMIN (`set_admin`, which needs only the current
#      admin's signature) and read the admin back. Last, so a multisig ADMIN
#      never has to sign during the deploy.
#   7. Write the factory record, packages/passkey-sdk/src/perch/
#      factory.<network>.json: the address, its wasm hash, the account hash,
#      verifier, and manager read back in step 5, the admin, and the Nido and
#      Perch commits and toolchain it was built from. deployment.test.ts
#      checks the record's account and verifier against the manifest, and
#      scripts/check-factory.sh checks the record and the manifest against
#      the chain.
#
# If any step after the factory exists fails, the script stops and names the
# factory and the step: don't register or use that factory. It is never
# handed over unpinned: the pin is a constructor argument.
#
# Prints the factory address. It registers no name in any registry: repointing
# `factory` is a separate, deliberate step (RUNBOOKS §2.2). Set
# `perch.TESTNET.factory` to the printed address and commit it with the record.
#
# Usage:
#   scripts/deploy-factory.sh <identity> [network]
#
#   <identity>  A `stellar keys` identity that pays for the deploy.
#   [network]   Default "testnet". The Perch manifest read is
#               vendor/perch/deployments/<network>.json.
#
# The endpoint is chosen once, before anything is submitted, by
# scripts/stellar-rpc.sh: RPC_URL/STELLAR_RPC_URL if set, else the manifest's
# rpc_url, else a guarded fallback while that is down (docs/RUNBOOKS.md "RPC
# endpoints"). Every read and write in the run goes there. It never fails
# over mid-run: a write whose response was lost may still have landed, so a
# failure stops the run (see above).
#
# Env:
#   ADMIN          The factory's final admin (default: the identity's address,
#                  fine only on testnet). On mainnet this must be the admin
#                  smart account that enforces the change delay (RUNBOOKS §3).
#   MANAGER        The address that must authorize every `create_account`
#                  (default: none, so anyone may create an account; testnet
#                  keeps none). On mainnet, the manager smart account.
#   SKIP_BUILD     Skip `just build-contracts`. The record's toolchain is then
#                  null: this script did not see what built the wasm.
#
# The Stellar CLI keeps identities under $XDG_CONFIG_HOME/stellar (or
# ~/.config/stellar); set XDG_CONFIG_HOME to use another directory.
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
note() { echo "→ $*" >&2; }

IDENTITY="${1:-}"
NETWORK="${2:-testnet}"
[ -n "$IDENTITY" ] || die "usage: $0 <identity> [network]"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
MANIFEST="vendor/perch/deployments/$NETWORK.json"
ACCOUNT_WASM="target/wasm32v1-none/contract/perch_account.wasm"
FACTORY_WASM="target/wasm32v1-none/contract/nido_factory.wasm"
RECORD="packages/passkey-sdk/src/perch/factory.$NETWORK.json"

command -v stellar >/dev/null || die "stellar CLI not found"
command -v jq >/dev/null || die "jq not found"
command -v curl >/dev/null || die "curl not found"
[ -f "$MANIFEST" ] || die "no Perch manifest at $MANIFEST (git submodule update --init)"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
m() { jq -r "$1" "$MANIFEST"; }

ACCOUNT_HASH="$(m '.contracts["perch-account"].sha256')"
VERIFIER="$(m '.contracts["perch-webauthn-verifier"].address')"
[[ "$ACCOUNT_HASH" =~ ^[0-9a-f]{64}$ ]] || die "manifest has no perch-account hash"
[[ "$VERIFIER" =~ ^C[A-Z2-7]{55}$ ]] || die "manifest has no perch-webauthn-verifier address"
DEPLOYER="$(stellar keys address "$IDENTITY")"
ADMIN="${ADMIN:-$DEPLOYER}"
[[ "$ADMIN" =~ ^[GC][A-Z2-7]{55}$ ]] || die "ADMIN '$ADMIN' is not an address"
MANAGER="${MANAGER:-}"
[ -z "$MANAGER" ] || [[ "$MANAGER" =~ ^[GC][A-Z2-7]{55}$ ]] || die "MANAGER '$MANAGER' is not an address"
# shellcheck source=scripts/stellar-rpc.sh
. scripts/stellar-rpc.sh
rpc_select "$(m .rpc_url)" "$(m .network_passphrase)" || die "no usable RPC endpoint for $NETWORK"
RPC="$(rpc_url)"
NET=(--source-account "$IDENTITY" --rpc-url "$RPC" --network-passphrase "$(m .network_passphrase)")

note "account wasm"
[ -f "$ACCOUNT_WASM" ] || die "$ACCOUNT_WASM missing: run 'just perch-infra'"
[ "$(sha256 "$ACCOUNT_WASM")" = "$ACCOUNT_HASH" ] || die "$ACCOUNT_WASM is not the manifest's perch-account ($ACCOUNT_HASH)"
installed="$(stellar contract upload --wasm "$ACCOUNT_WASM" "${NET[@]}" 2>/dev/null | grep -oE '[0-9a-f]{64}' | tail -1)"
[ "$installed" = "$ACCOUNT_HASH" ] || die "installed account hash ${installed:-<none>} != $ACCOUNT_HASH"
code="$(stellar ledger entry fetch contract-code --wasm-hash "$ACCOUNT_HASH" --rpc-url "$RPC" \
    --network-passphrase "$(m .network_passphrase)" --output json \
    | jq -r '[.. | objects | select(has("contract_code")) | .contract_code | select((.code // "") != "") | .hash][0] // empty')"
[ "$code" = "$ACCOUNT_HASH" ] || die "account code $ACCOUNT_HASH does not read back from the ledger"
echo "  installed $ACCOUNT_HASH" >&2

TOOLCHAIN=null
if [ -z "${SKIP_BUILD:-}" ]; then
    note "build"
    PIN=contracts/factory/wasm/perch-account.sha256
    [ "$(tr -d '[:space:]' < "$PIN")" = "$ACCOUNT_HASH" ] ||
        die "$PIN is not the manifest's perch-account ($ACCOUNT_HASH): run 'STELLAR_NETWORK=$NETWORK just perch-infra'"
    just build-contracts >&2
    TOOLCHAIN="$(jq -n --arg rustc "$(rustc --version)" --arg stellar "$(stellar --version | head -1)" \
        --arg scaffold "$(stellar-scaffold --version | head -1)" '{rustc: $rustc, stellar: $stellar, scaffold: $scaffold}')"
fi
[ -f "$FACTORY_WASM" ] || die "$FACTORY_WASM missing"
FACTORY_WASM_HASH="$(sha256 "$FACTORY_WASM")"
# The pin is 32 raw bytes in the wasm's data; `account_wasm_hash` reads it
# back from the deployed factory in step 5.
od -An -v -tx1 "$FACTORY_WASM" | tr -d ' \n' | grep -q "$ACCOUNT_HASH" \
    || die "$FACTORY_WASM does not pin the manifest's perch-account ($ACCOUNT_HASH): run 'STELLAR_NETWORK=$NETWORK just perch-infra' and rebuild"

# An absent `--manager` is the constructor's `None`. The CLI reads an
# `Option<Address>` argument as JSON, so a present one is a quoted string.
MANAGER_ARG=()
[ -z "$MANAGER" ] || MANAGER_ARG=(--manager "\"$MANAGER\"")
note "deploy factory (admin $DEPLOYER until step 6, verifier $VERIFIER, manager ${MANAGER:-none})"
FACTORY="$(stellar contract deploy --wasm "$FACTORY_WASM" "${NET[@]}" -- \
    --admin "$DEPLOYER" --verifier "\"$VERIFIER\"" ${MANAGER_ARG[@]+"${MANAGER_ARG[@]}"} | tail -1)"
[[ "$FACTORY" =~ ^C[A-Z2-7]{55}$ ]] || die "deploy returned '$FACTORY'"
echo "  factory $FACTORY (wasm $FACTORY_WASM_HASH)" >&2

# From here on the factory exists: any failure names it and the step.
step=""
abandoned() {
    echo "error: factory $FACTORY was created, but the deploy stopped at: $step." >&2
    echo "       The steps after that one didn't run. Don't register or use this" >&2
    echo "       factory; rerun this script for a fresh one." >&2
}
trap abandoned ERR
fail() { echo "error: $*" >&2; false; }

step="check the verifier pin, the manager, and the account hash"; note "$step"
pinned="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- pinned_verifier | tr -d '"')"
[ "$pinned" = "$VERIFIER" ] || fail "pinned verifier reads back as '$pinned'"
manager="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- manager | tr -d '"')"
[ "$manager" = "${MANAGER:-null}" ] || fail "manager reads back as '$manager'"
deploys="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- account_wasm_hash | tr -d '"')"
[ "$deploys" = "$ACCOUNT_HASH" ] || fail "factory deploys $deploys, manifest says $ACCOUNT_HASH"

if [ "$ADMIN" != "$DEPLOYER" ]; then
    step="hand the factory to $ADMIN"; note "$step"
    stellar contract invoke --id "$FACTORY" "${NET[@]}" -- set_admin --new_admin "$ADMIN" >/dev/null
fi
admin="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- admin | tr -d '"')"
[ "$admin" = "$ADMIN" ] || fail "admin reads back as '$admin', expected $ADMIN"
trap - ERR

# The factory is complete; a failure here leaves it usable but unrecorded.
note "record $RECORD"
dirty=false
[ -z "$(git status --porcelain --untracked-files=no)" ] || dirty=true
jq -n \
    --arg network "$NETWORK" \
    --arg passphrase "$(m .network_passphrase)" \
    --arg factory "$FACTORY" \
    --arg wasm "$FACTORY_WASM_HASH" \
    --arg account "$deploys" \
    --arg verifier "$pinned" \
    --arg manager "$MANAGER" \
    --arg admin "$admin" \
    --arg commit "$(git rev-parse HEAD)" \
    --argjson dirty "$dirty" \
    --arg perch "$(git -C vendor/perch rev-parse HEAD)" \
    --argjson toolchain "$TOOLCHAIN" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{schema: 1, network: $network, network_passphrase: $passphrase, factory: $factory,
      wasm_hash: $wasm, account_wasm_hash: $account, pinned_verifier: $verifier,
      manager: (if $manager == "" then null else $manager end), admin: $admin,
      source: {commit: $commit, dirty: $dirty, perch_commit: $perch},
      toolchain: $toolchain, deployed_at: $at}' > "$RECORD" \
    || die "factory $FACTORY is deployed and checked, but writing $RECORD failed"

echo "$FACTORY"
