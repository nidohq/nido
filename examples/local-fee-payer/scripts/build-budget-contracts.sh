#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/prepare-perch.mjs
export CARGO_TARGET_DIR="$PWD/.perch-src/target"
for package in perch-fee-budget perch-webauthn-verifier; do
  stellar contract build --manifest-path .perch-src/Cargo.toml --package "$package" --locked --out-dir public/contracts
done
export CARGO_TARGET_DIR="$PWD/contracts/target"
stellar contract build --manifest-path contracts/Cargo.toml --locked --out-dir public/contracts
node scripts/contract-manifest.mjs
