#!/usr/bin/env bash
# Print the cargo arguments that build the Perch crates from the fetched
# Perch source with a built stack's pins (scripts/perch-overlay.sh, run by
# `just perch-infra`), or nothing for a deployed stack:
# `cargo test $(scripts/perch-overlay-config.sh)`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
[ "$(scripts/perch-src.sh --stack)" = build ] || exit 0
[ -f target/perch-overlay.toml ] || scripts/perch-overlay.sh
echo "--config $PWD/target/perch-overlay.toml"
