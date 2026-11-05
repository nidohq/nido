#!/usr/bin/env bash
# Print the cargo arguments that build the Perch crates from the overlaid
# submodule (scripts/perch-overlay.sh, run by `just perch-infra`), or
# nothing without perch-overlay/: `cargo test $(scripts/perch-overlay-config.sh)`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
[ -d perch-overlay ] || exit 0
[ -f target/perch-overlay.toml ] || scripts/perch-overlay.sh
echo "--config $PWD/target/perch-overlay.toml"
