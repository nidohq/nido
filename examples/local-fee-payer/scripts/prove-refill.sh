#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/prepare-perch.mjs
bash .perch-src/crates/perch-fee-budget-core/proof/run.sh
mkdir -p qa
cp .perch-src/crates/perch-fee-budget-core/proof/evidence.json qa/refill-proof-evidence.json
cp .perch-src/crates/perch-fee-budget-core/proof/audit.log qa/refill-proof.log
