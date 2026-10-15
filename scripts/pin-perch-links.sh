#!/usr/bin/env bash
# Point every commit-pinned Perch link in Nido's documentation at the commit
# the vendor/perch gitlink records (and fill any PERCH_SHA placeholder). Run
# after bumping the submodule; check-perch-drift.sh fails on a link that names
# another commit. docs/reviews/ pins reviewed revisions on purpose, so it is
# left alone.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
pinned="$(git rev-parse :vendor/perch)"
git ls-files -z -- '*.md' ':!vendor' ':!docs/reviews' |
    xargs -0 perl -pi -e "s{(github\.com/stellar-registry/perch/(?:blob|tree)/)(?:[0-9a-f]{40}|PERCH_SHA)}{\${1}$pinned}g"
echo "Perch links pinned to ${pinned:0:7}"
