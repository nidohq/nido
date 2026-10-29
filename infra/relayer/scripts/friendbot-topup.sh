#!/usr/bin/env bash
# Top up an existing testnet account (e.g. a relayer account) with Friendbot XLM.
# Friendbot only funds accounts that don't exist yet, so each round creates a
# throwaway key, funds it with Friendbot (~10,000 XLM), account-merges it into
# the target, and removes the key. Each round adds just under 10,000 XLM.
# Testnet only: the network is hardcoded and STELLAR_NETWORK must be unset or
# "testnet". Uses no relayer secrets.
# The role addresses below must match "Current Testnet Accounts" in ../README.md.
# Usage: ./friendbot-topup.sh [G-ADDRESS|ROLE] [ROUNDS]
#   ROLE    fund | fee-payer (default) | channel-001 | channel-002
#   ROUNDS  positive integer, default 1
# Requires: stellar CLI, curl, python3.
set -euo pipefail

usage() { echo "usage: friendbot-topup.sh [G-ADDRESS|fund|fee-payer|channel-001|channel-002] [ROUNDS]" >&2; exit 2; }
[ $# -le 2 ] || usage
case "${STELLAR_NETWORK:-testnet}" in
  testnet) ;;
  *) echo "testnet only; refusing STELLAR_NETWORK=$STELLAR_NETWORK" >&2; exit 2 ;;
esac

target=${1:-fee-payer}
rounds=${2:-1}
case "$target" in
  fund)                         target=GCYVFKNTVZA5AY3KJWPW4NU4247UDDFFOCT4C3WCOKUDQQABIZRZ46I3 ;;
  fee-payer|channels-fee-payer) target=GDF5IIBWEZIEBA43XAZSOM5A3X6KKZ7CCYX5K7SCO4M4DJGOPEPK7UOL ;;
  channel-001)                  target=GAPGVNKNFHOCER46FQ4WHMWXWA2DLUYY3HYXTBSIPIMPMRCE7Y6URAGA ;;
  channel-002)                  target=GBYC4XMYN7WNBWZ363M3MD6BWUGIX633EIOTOOASSZ3IZUGS44HBA7JZ ;;
esac
[[ "$target" =~ ^G[A-Z2-7]{55}$ ]] || { echo "not a G-address or known role: $target" >&2; usage; }
[[ "$rounds" =~ ^[1-9][0-9]*$ ]] || { echo "ROUNDS must be a positive integer: $rounds" >&2; usage; }

balance() {
  curl -fsS "https://horizon-testnet.stellar.org/accounts/$1" |
    python3 -c 'import sys,json; print(next(b["balance"] for b in json.load(sys.stdin)["balances"] if b["asset_type"]=="native"))'
}

before=$(balance "$target") || { echo "target $target not found on testnet (fund it once with Friendbot directly)" >&2; exit 1; }
echo "target $target, before: $before XLM"
for i in $(seq 1 "$rounds"); do
  name="friendbot-topup-$$-$i"
  trap 'stellar keys rm --force "$name" </dev/null >/dev/null 2>&1 || true' EXIT
  stellar keys generate "$name" --network testnet --fund >/dev/null
  stellar tx new account-merge --network testnet --source-account "$name" --account "$target" >/dev/null
  stellar keys rm --force "$name" </dev/null >/dev/null 2>&1 || true
  echo "round $i/$rounds merged"
done
trap - EXIT
echo "target $target, after:  $(balance "$target") XLM"
