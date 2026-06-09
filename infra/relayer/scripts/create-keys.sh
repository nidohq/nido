#!/bin/sh
# Generates the three local keystores for the relayer (fund + 2 channels).
# Usage: KEYSTORE_PASSPHRASE='<strong passphrase>' ./create-keys.sh <output-dir>
# Passphrase rules (enforced by create_key): >=12 chars, upper, lower, digit, special.
set -eu
OUT="${1:?usage: create-keys.sh <output-dir>}"
: "${KEYSTORE_PASSPHRASE:?set KEYSTORE_PASSPHRASE}"
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git clone --depth 1 --branch v1.5.0 https://github.com/OpenZeppelin/openzeppelin-relayer "$WORK/relayer"
cd "$WORK/relayer"
for name in fund channel-001 channel-002; do
  cargo run --example create_key -- \
    --password "$KEYSTORE_PASSPHRASE" \
    --output-dir "$OUT" \
    --filename "$name.json"
done
echo "Keystores written to $OUT — store them in 1Password (vault theahaco), then:"
for name in fund channel-001 channel-002; do
  upper=$(echo "$name" | tr 'a-z-' 'A-Z_')
  echo "  fly secrets set KEYSTORE_${upper}_B64=\"\$(base64 -w0 $OUT/$name.json)\" -a nido-relayer"
done
