#!/usr/bin/env bash
# Start the throwaway onion + test-page server. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

TOR=$(command -v tor || true)
[[ -x bin/tor/tor ]] && TOR=bin/tor/tor
[[ -n "$TOR" ]] || { echo "no tor — run ./fetch-tor.sh or apt install tor" >&2; exit 1; }

mkdir -p data/tor data/onion
chmod 700 data/onion

"$TOR" -f torrc &
TOR_PID=$!
python3 server.py &
SRV_PID=$!
trap 'kill $TOR_PID $SRV_PID 2>/dev/null' EXIT INT TERM

for _ in $(seq 1 60); do
  [[ -s data/onion/hostname ]] && break
  sleep 1
done
ADDR=$(cat data/onion/hostname)
echo
echo "==============================================================="
echo "  onion up:  http://${ADDR}"
echo "  subdomain: http://test.${ADDR}"
[[ -f certs/leaf.pem ]] && echo "  https:     https://${ADDR}  (local CA: certs/ca.pem)"
echo "  SOCKS for non-Tor-Browser rows: 127.0.0.1:9052"
echo "==============================================================="
echo

wait
