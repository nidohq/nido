#!/usr/bin/env bash
# Point every commit-pinned Perch link in Nido's documentation at Nido's Perch
# pin, the rev of the root Cargo.toml's Perch git dependencies (and fill any
# PERCH_SHA placeholder). Run after moving the pin; check-perch-drift.sh fails
# on a link that names
# another commit. docs/reviews/ pins reviewed revisions on purpose, so it is
# left alone.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
pinned="$(scripts/perch-src.sh --rev)"
git ls-files -z -- '*.md' ':!docs/reviews' |
    xargs -0 perl -pi -e "s{(github\.com/stellar-registry/perch/(?:blob|tree)/)(?:[0-9a-f]{40}|PERCH_SHA)}{\${1}$pinned}g"
echo "Perch links pinned to ${pinned:0:7}"
