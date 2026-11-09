#!/usr/bin/env bash
# Print the path of Perch's source at the commit Nido pins, fetching it on
# first use. The pin is the root Cargo.toml's: the `git` and `rev` of its
# `perch-account` dependency, which every Perch git dependency shares
# (scripts/check-perch-drift.sh fails otherwise). So the source Nido's
# scripts and tests read (the deployment manifests, circuits, testdata, the
# smart account's build-time pins) is the commit Cargo builds the Perch
# crates from, and moving the pin is a Cargo.toml edit
# (scripts/repin-perch.sh).
#
# The checkout is target/perch-src/<rev>/, a depth-1 clone made once per rev
# and then reused; it is a cache, never edited, and `cargo clean` drops it.
#
#   perch="$(scripts/perch-src.sh)"
#   scripts/perch-src.sh --rev     # the pinned commit
#   scripts/perch-src.sh --git     # the repository it comes from
#   scripts/perch-src.sh --branch  # the Perch branch the pin must be on
#                                  # ([workspace.metadata.perch] in Cargo.toml)
#
# Env: NIDO_PERCH_DIR names a Perch checkout to use instead (a local Perch
# being worked on, or a test's stand-in); it is printed as is.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
dep="$(grep -E '^perch-account = \{' "$repo_root/Cargo.toml" || true)"
git_url="$(sed -nE 's/.*git = "([^"]+)".*/\1/p' <<<"$dep")"
rev="$(sed -nE 's/.*rev = "([^"]+)".*/\1/p' <<<"$dep")"
[ -n "$git_url" ] && [[ "$rev" =~ ^[0-9a-f]{40}$ ]] ||
    { echo "error: the root Cargo.toml pins no perch-account git dependency at a full rev" >&2; exit 1; }

case "${1:-}" in
    --rev) echo "$rev"; exit 0 ;;
    --git) echo "$git_url"; exit 0 ;;
    --branch)
        branch="$(sed -n '/^\[workspace\.metadata\.perch\]/,/^\[/s/^branch = "\(.*\)"$/\1/p' "$repo_root/Cargo.toml")"
        [ -n "$branch" ] || { echo "error: Cargo.toml's [workspace.metadata.perch] declares no branch" >&2; exit 1; }
        echo "$branch"
        exit 0
        ;;
    "") ;;
    *) echo "usage: scripts/perch-src.sh [--rev|--git|--branch]" >&2; exit 1 ;;
esac

if [ -n "${NIDO_PERCH_DIR:-}" ]; then
    echo "$NIDO_PERCH_DIR"
    exit 0
fi

dir="$repo_root/target/perch-src/$rev"
if [ ! -f "$dir/.perch-src-ok" ]; then
    # Test runners call this from parallel workers; one fetches, the rest wait.
    mkdir -p "$(dirname "$dir")"
    lock="$dir.lock"
    waited=0
    until mkdir "$lock" 2>/dev/null; do
        [ "$waited" -lt 3000 ] ||
            { echo "error: $lock has been held for 10 minutes (remove it if no fetch is running)" >&2; exit 1; }
        sleep 0.2
        waited=$((waited + 1))
    done
    trap 'rmdir "$lock"' EXIT
    if [ ! -f "$dir/.perch-src-ok" ]; then
        rm -rf "$dir"
        git init -q "$dir"
        git -C "$dir" remote add origin "$git_url"
        echo "perch-src: fetching ${git_url} at ${rev:0:7} into ${dir#"$repo_root"/}" >&2
        git -C "$dir" fetch -q --depth 1 origin "$rev"
        git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
        [ "$(git -C "$dir" rev-parse HEAD)" = "$rev" ] ||
            { echo "error: fetched $(git -C "$dir" rev-parse HEAD), not $rev" >&2; exit 1; }
        touch "$dir/.perch-src-ok"
    fi
fi
echo "$dir"
