#!/usr/bin/env bash
# Detect drift between the vendored Perch stack (the vendor/perch submodule)
# and what Nido builds, tests, and ships against it. Fails, listing every
# mismatch, when:
#
#   1. the submodule checkout isn't the commit the superproject records, or has
#      local edits to tracked files;
#   2. that commit isn't on the branch .gitmodules declares (a rewritten or
#      deleted branch); skipped with --offline;
#   3. a Perch wasm Nido consumes isn't the manifest's
#      (vendor/perch/deployments/$STELLAR_NETWORK.json, default testnet): the
#      fetched stack in target/wasm32v1-none/contract/, the build-time pins
#      the smart account compiles in (committed in Perch, read here from the
#      submodule), and the account hash the factory pins (its committed
#      contracts/factory/wasm/perch-account.sha256, which `just perch-infra`
#      writes, and the built nido_factory.wasm);
#   4. npm doesn't resolve a Perch package the root workspace list vendors
#      (today only perch-zk, which Perch hasn't published) to the submodule,
#      or the SDK pins another version than it carries. Published Perch
#      packages (@stellar-registry/perch) come from npm by version.
#   5. a commit-pinned Perch link in Nido's documentation names another commit
#      than the pinned one (scripts/pin-perch-links.sh rewrites them);
#   6. a Perch crate Cargo builds comes from anywhere but the submodule's
#      commit: a Perch git dependency in Cargo.toml at another rev, a
#      Cargo.lock entry resolved to another commit, or a path into
#      vendor/perch (scripts/repin-perch.sh moves the rev with the submodule).
#
# `just perch-infra` refuses any byte that doesn't match the manifest when it
# fetches; this check catches what changes afterwards (a submodule bump without
# a refetch, a stale target/, a hand-copied wasm). The SDK's `perch.TESTNET` is
# checked against the same manifest by packages/passkey-sdk/src/perch/
# deployment.test.ts.
#
# Usage: scripts/check-perch-drift.sh [--offline]   (run after `just perch-infra`
# and `just build-contracts`; safe from anywhere)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
offline=""
[ "${1:-}" = "--offline" ] && offline=1
network="${STELLAR_NETWORK:-testnet}"
manifest="vendor/perch/deployments/$network.json"
problems=()
problem() { problems+=("$*"); }

command -v jq >/dev/null || { echo "error: jq not found" >&2; exit 1; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# 1. The checkout is the recorded commit, unedited.
status="$(git submodule status vendor/perch)"
case "${status:0:1}" in
    " ") ;;
    "-") echo "error: vendor/perch is not checked out (git submodule update --init)" >&2; exit 1 ;;
    *) problem "vendor/perch is at $(git -C vendor/perch rev-parse --short HEAD), not the commit the superproject records ($(git rev-parse --short :vendor/perch))" ;;
esac
if [ -n "$(git -C vendor/perch status --porcelain --untracked-files=no)" ]; then
    problem "vendor/perch has local edits to tracked files: $(git -C vendor/perch status --porcelain --untracked-files=no | awk '{print $2}' | tr '\n' ' ')"
fi
# The pin as staged, which `git submodule status` also compares against: the
# checked-out commit's, or a re-pin's about to be committed.
pinned="$(git rev-parse :vendor/perch)"

# 2. The pinned commit is on the declared branch.
branch="$(git config -f .gitmodules submodule.vendor/perch.branch || true)"
if [ -z "$branch" ]; then
    problem ".gitmodules declares no branch for vendor/perch"
elif [ -z "$offline" ]; then
    # A shallow checkout (CI's) can't answer ancestry without the history.
    deepen=()
    [ "$(git -C vendor/perch rev-parse --is-shallow-repository)" = true ] && deepen=(--unshallow)
    if git -C vendor/perch fetch --quiet ${deepen[@]+"${deepen[@]}"} origin "$branch"; then
        git -C vendor/perch merge-base --is-ancestor "$pinned" FETCH_HEAD ||
            problem "the pinned commit ${pinned:0:7} is not on origin/$branch"
    else
        problem "could not fetch origin/$branch to check the pin (use --offline to skip)"
    fi
fi

# 3. Every consumed wasm is the manifest's.
[ -f "$manifest" ] || { echo "error: no manifest at $manifest" >&2; exit 1; }
want() { jq -r --arg n "$1" '.contracts[$n].sha256 // empty' "$manifest"; }
check() { # file contract-name
    local file="$1" name="$2" expected
    expected="$(want "$name")"
    [ -n "$expected" ] || { problem "$name is not in $manifest"; return; }
    if [ ! -f "$file" ]; then
        problem "$file is missing (just perch-infra)"
    elif [ "$(sha256 "$file")" != "$expected" ]; then
        problem "$file is not the manifest's $name ($expected)"
    fi
}
for name in perch-account perch-recovery perch-zk-pool perch-zk-adapter perch-doc-compiler \
            perch-interpreter perch-spending-limit perch-webauthn-verifier; do
    check "target/wasm32v1-none/contract/${name//-/_}.wasm" "$name"
done
# The smart account's build-time pins, as the Perch git dependency builds
# them: the submodule is at the same commit (check 6) with no local edits
# (check 1).
pins=vendor/perch/crates/perch-smart-account/wasm
for name in perch-doc-compiler perch-interpreter perch-spending-limit; do
    if [ "$(tr -d '[:space:]' < "$pins/$name.sha256" 2>/dev/null)" != "$(want "$name")" ]; then
        problem "$pins/$name.sha256 is not the manifest's $name ($(want "$name"))"
    fi
done
if [ "$(tr -d '[:space:]' < "$pins/stateless.id" 2>/dev/null)" != "$(jq -r .registry.id "$manifest")" ]; then
    problem "$pins/stateless.id is not the manifest's registry ($(jq -r .registry.id "$manifest"))"
fi
# The factory's pin, and the built factory that carries it as 32 raw bytes.
factory_pin=contracts/factory/wasm/perch-account.sha256
if [ "$(tr -d '[:space:]' < "$factory_pin" 2>/dev/null)" != "$(want perch-account)" ]; then
    problem "$factory_pin is not the manifest's perch-account ($(want perch-account)); run 'just perch-infra'"
fi
factory=target/wasm32v1-none/contract/nido_factory.wasm
if [ ! -f "$factory" ]; then
    problem "$factory is missing (just build-contracts)"
elif ! od -An -v -tx1 "$factory" | tr -d ' \n' | grep -q "$(want perch-account)"; then
    problem "$factory does not pin the manifest's perch-account ($(want perch-account)); rebuild it (just build-contracts)"
fi

# 4. npm resolves each vendored Perch package to the submodule, at the version
#    it carries (for each package the root workspace list includes).
for pkg in perch:perch-js perch-zk:perch-zk; do
    name="@stellar-registry/${pkg%%:*}"
    dir="vendor/perch/packages/${pkg##*:}"
    jq -e --arg d "$dir" '.workspaces | index($d)' package.json >/dev/null || continue
    resolved="$(jq -r --arg k "node_modules/$name" '.packages[$k].resolved // empty' package-lock.json)"
    [ "$resolved" = "$dir" ] || problem "package-lock.json resolves $name to '${resolved:-the registry}', not $dir"
    carried="$(jq -r .version "$dir/package.json")"
    sdk="$(jq -r --arg n "$name" '.dependencies[$n] // empty' packages/passkey-sdk/package.json)"
    [ -z "$sdk" ] || [ "$sdk" = "$carried" ] || problem "packages/passkey-sdk pins $name $sdk; vendor/perch carries $carried"
done

# 5. Every commit-pinned Perch link in Nido's documentation names the pinned
#    commit, so a reader on GitHub sees the Perch source this tree builds and
#    tests against (scripts/pin-perch-links.sh rewrites them after a bump).
while IFS= read -r hit; do
    problem "documentation links Perch at another commit (scripts/pin-perch-links.sh): $hit"
done < <(git grep -n -E 'github\.com/stellar-registry/perch/(blob|tree)/([0-9a-f]{40}|PERCH_SHA)' -- '*.md' ':!vendor' ':!docs/reviews' | grep -v "/$pinned/" || true)

# 6. Cargo's Perch is the submodule's commit.
perch_git=https://github.com/stellar-registry/perch
deps="$(grep -E "^perch-[a-z0-9-]+ = .*git = \"$perch_git\"" Cargo.toml || true)"
[ -n "$deps" ] || problem "Cargo.toml has no Perch git dependency on $perch_git"
while IFS= read -r dep; do
    [ -n "$dep" ] || continue
    [[ "$dep" == *"rev = \"$pinned\""* ]] || problem "Cargo.toml pins Perch at another rev than vendor/perch (${pinned:0:7}): $dep"
done <<<"$deps"
while IFS= read -r hit; do
    problem "a Perch crate is a path dependency into the submodule: $hit"
done < <(git grep -n 'path = "[^"]*vendor/perch' -- '*Cargo.toml' ':!vendor' || true)
locked="$(grep -F "source = \"git+$perch_git" Cargo.lock | sort -u || true)"
[ -n "$locked" ] || problem "Cargo.lock resolves no crate from $perch_git"
while IFS= read -r src; do
    [ -n "$src" ] || continue
    [ "$src" = "source = \"git+$perch_git?rev=$pinned#$pinned\"" ] ||
        problem "Cargo.lock resolves Perch at another commit than vendor/perch (${pinned:0:7}): $src"
done <<<"$locked"

if [ ${#problems[@]} -gt 0 ]; then
    echo "Perch drift (vendor/perch at ${pinned:0:7}, $manifest):" >&2
    printf '  - %s\n' "${problems[@]}" >&2
    exit 1
fi
echo "vendor/perch ${pinned:0:7} on $branch; Cargo's Perch crates at the same commit; consumed wasm, build-time pins, factory pin, and npm workspaces match $manifest"
