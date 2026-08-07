#!/usr/bin/env bash
# Local CA + leaf cert for the throwaway onion (https matrix rows).
# Secure-context only needs a cert the test browser trusts — no HARICA for a spike.
set -euo pipefail
cd "$(dirname "$0")"

ADDR=$(cat data/onion/hostname) # e.g. abc...xyz.onion
mkdir -p certs

if [[ ! -f certs/ca.pem ]]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout certs/ca.key -out certs/ca.pem -days 90 \
    -subj "/CN=webauthn-onion-spike local CA" \
    -addext basicConstraints=critical,CA:TRUE
  echo "made certs/ca.pem — import into test-browser trust stores"
fi

openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout certs/leaf.key -out certs/leaf.csr -subj "/CN=${ADDR}"
openssl x509 -req -in certs/leaf.csr -CA certs/ca.pem -CAkey certs/ca.key \
  -CAcreateserial -out certs/leaf.pem -days 90 \
  -extfile <(printf "subjectAltName=DNS:%s,DNS:*.%s\nbasicConstraints=CA:FALSE" "$ADDR" "$ADDR")
rm certs/leaf.csr

echo "leaf for ${ADDR} + *.${ADDR} at certs/leaf.pem — restart run.sh to enable :443"
