#!/usr/bin/env bash
#
# Deploy Nido's account factory around Perch's deployed account (RUNBOOKS §2.2).
#
#   1. Check the staged account wasm (target/wasm32v1-none/contract/
#      perch_account.wasm, from `just perch-infra`) is the manifest's
#      `perch-account`, and install it on the network: the factory deploys
#      accounts by its hash.
#   2. Build Nido's contracts (`just build-contracts`; the factory embeds that
#      wasm) unless SKIP_BUILD is set.
#   3. Deploy the factory with the paying identity as its admin.
#   4. Pin Perch's WebAuthn verifier (`set_registry_pins`), so account creation
#      never consults the registry, and read the pin back.
#   5. Ask the factory for the account hash it deploys (admin-gated
#      `refresh_account_wasm_hash`) and check it against the manifest.
#   6. Hand the factory to ADMIN (`set_admin`, which needs only the current
#      admin's signature) and read the admin back. Last, so the pin and the
#      hash are checked while the paying identity can still sign for them, and
#      a multisig ADMIN never has to sign during the deploy.
#
# If any step after the factory exists fails, the script stops and names the
# factory and the step: don't register or use that factory. It is never left
# pinned-but-unhanded silently, and never handed over unpinned.
#
# Prints the factory address. It registers no name in any registry: repointing
# `factory` is a separate, deliberate step (RUNBOOKS §2.2).
#
# Usage:
#   scripts/deploy-factory.sh <identity> [network]
#
#   <identity>  A `stellar keys` identity that pays for the deploy.
#   [network]   Default "testnet". The Perch manifest read is
#               vendor/perch/deployments/<network>.json.
#
# Env:
#   ADMIN       The factory's final admin (default: the identity's address,
#               fine only on testnet). On mainnet this must be the multisig.
#   SKIP_BUILD  Skip `just build-contracts`.
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

command -v stellar >/dev/null || die "stellar CLI not found"
command -v jq >/dev/null || die "jq not found"
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
NET=(--source-account "$IDENTITY" --network "$NETWORK")

note "account wasm"
[ -f "$ACCOUNT_WASM" ] || die "$ACCOUNT_WASM missing: run 'just perch-infra'"
[ "$(sha256 "$ACCOUNT_WASM")" = "$ACCOUNT_HASH" ] || die "$ACCOUNT_WASM is not the manifest's perch-account ($ACCOUNT_HASH)"
installed="$(stellar contract upload --wasm "$ACCOUNT_WASM" "${NET[@]}" 2>/dev/null | grep -oE '[0-9a-f]{64}' | tail -1)"
[ "$installed" = "$ACCOUNT_HASH" ] || die "installed account hash ${installed:-<none>} != $ACCOUNT_HASH"
echo "  installed $ACCOUNT_HASH" >&2

if [ -z "${SKIP_BUILD:-}" ]; then
    note "build"
    just build-contracts >&2
fi
[ -f "$FACTORY_WASM" ] || die "$FACTORY_WASM missing"

note "deploy factory (admin $DEPLOYER until step 6)"
FACTORY="$(stellar contract deploy --wasm "$FACTORY_WASM" "${NET[@]}" -- --admin "$DEPLOYER" | tail -1)"
[[ "$FACTORY" =~ ^C[A-Z2-7]{55}$ ]] || die "deploy returned '$FACTORY'"
echo "  factory $FACTORY (wasm $(sha256 "$FACTORY_WASM"))" >&2

# From here on the factory exists: any failure names it and the step.
step=""
abandoned() {
    echo "error: factory $FACTORY was created, but the deploy stopped at: $step." >&2
    echo "       The steps after that one didn't run. Don't register or use this" >&2
    echo "       factory; rerun this script for a fresh one." >&2
}
trap abandoned ERR
fail() { echo "error: $*" >&2; false; }

step="pin Perch's WebAuthn verifier $VERIFIER"; note "$step"
stellar contract invoke --id "$FACTORY" "${NET[@]}" -- set_registry_pins --verifier "$VERIFIER" >/dev/null
pinned="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- pinned_verifier | tr -d '"')"
[ "$pinned" = "$VERIFIER" ] || fail "pinned verifier reads back as '$pinned'"

step="check the account hash the factory deploys"; note "$step"
deploys="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" -- refresh_account_wasm_hash | tr -d '"')"
[ "$deploys" = "$ACCOUNT_HASH" ] || fail "factory deploys $deploys, manifest says $ACCOUNT_HASH"

if [ "$ADMIN" != "$DEPLOYER" ]; then
    step="hand the factory to $ADMIN"; note "$step"
    stellar contract invoke --id "$FACTORY" "${NET[@]}" -- set_admin --new_admin "$ADMIN" >/dev/null
fi
admin="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- admin | tr -d '"')"
[ "$admin" = "$ADMIN" ] || fail "admin reads back as '$admin', expected $ADMIN"
trap - ERR

echo "$FACTORY"
