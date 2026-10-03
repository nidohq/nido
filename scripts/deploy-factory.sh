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
#   3. Deploy the factory with `--admin`.
#   4. Pin Perch's WebAuthn verifier (`set_registry_pins`), so account creation
#      never consults the registry, and read the pin back.
#   5. Ask the factory for the account hash it deploys (admin-gated
#      `refresh_account_wasm_hash`) and check it against the manifest.
#
# Prints the factory address. It registers no name in any registry: repointing
# `factory` is a separate, deliberate step (RUNBOOKS §2.2, step 4).
#
# Usage:
#   scripts/deploy-factory.sh <identity> [network]
#
#   <identity>  A `stellar keys` identity that pays for the deploy.
#   [network]   Default "testnet". The Perch manifest read is
#               vendor/perch/deployments/<network>.json.
#
# Env:
#   ADMIN       The factory admin (default: the identity's address). On
#               mainnet this must be the multisig.
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
ADMIN="${ADMIN:-$(stellar keys address "$IDENTITY")}"
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

note "deploy factory (admin $ADMIN)"
FACTORY="$(stellar contract deploy --wasm "$FACTORY_WASM" "${NET[@]}" -- --admin "$ADMIN" | tail -1)"
[[ "$FACTORY" =~ ^C[A-Z2-7]{55}$ ]] || die "deploy returned '$FACTORY'"
echo "  factory $FACTORY (wasm $(sha256 "$FACTORY_WASM"))" >&2

note "pin Perch's WebAuthn verifier $VERIFIER"
stellar contract invoke --id "$FACTORY" "${NET[@]}" -- set_registry_pins --verifier "$VERIFIER" >/dev/null
pinned="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" --send=no -- pinned_verifier | tr -d '"')"
[ "$pinned" = "$VERIFIER" ] || die "pinned verifier reads back as '$pinned'"

note "check the account hash the factory deploys"
deploys="$(stellar contract invoke --id "$FACTORY" "${NET[@]}" -- refresh_account_wasm_hash | tr -d '"')"
[ "$deploys" = "$ACCOUNT_HASH" ] || die "factory deploys $deploys, manifest says $ACCOUNT_HASH"

echo "$FACTORY"
