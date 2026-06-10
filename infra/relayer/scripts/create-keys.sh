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
echo "Note: building create_key compiles the relayer crate — the first run takes several minutes (requires cargo)."
for name in fund channel-001 channel-002; do
  cargo run --example create_key -- \
    --password "$KEYSTORE_PASSPHRASE" \
    --output-dir "$OUT" \
    --filename "$name.json"
done
# One combined fly call below: three separate `fly secrets set` runs on a live app = three restarts.
# macOS note: BSD base64 has no -w flag — use `openssl base64 -A -in <file>` instead of `base64 -w0 <file>`.
echo "Keystores written to $OUT — store them in 1Password (vault theahaco), then:"
echo "  fly secrets set -a nido \\"
echo "    KEYSTORE_FUND_B64=\"\$(base64 -w0 $OUT/fund.json)\" \\"
echo "    KEYSTORE_CHANNEL_001_B64=\"\$(base64 -w0 $OUT/channel-001.json)\" \\"
echo "    KEYSTORE_CHANNEL_002_B64=\"\$(base64 -w0 $OUT/channel-002.json)\""
echo "  (macOS: swap base64 -w0 <file> for: openssl base64 -A -in <file>)"
