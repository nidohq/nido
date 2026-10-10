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
#      fetched stack in target/wasm32v1-none/contract/, the account's pin
#      cache in the submodule, and the account wasm the factory embedded;
#   4. npm doesn't resolve a Perch package the root workspace list vendors
#      (today only perch-zk, which Perch hasn't published) to the submodule,
#      or the SDK pins another version than it carries. Published Perch
#      packages (@stellar-registry/perch) come from npm by version.
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
    *) problem "vendor/perch is at $(git -C vendor/perch rev-parse --short HEAD), not the commit the superproject records ($(git ls-tree HEAD vendor/perch | awk '{print substr($3,1,7)}'))" ;;
esac
if [ -n "$(git -C vendor/perch status --porcelain --untracked-files=no)" ]; then
    problem "vendor/perch has local edits to tracked files: $(git -C vendor/perch status --porcelain --untracked-files=no | awk '{print $2}' | tr '\n' ' ')"
fi
pinned="$(git ls-tree HEAD vendor/perch | awk '{print $3}')"

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
cache=vendor/perch/crates/perch-smart-account/wasm
for name in perch-doc-compiler perch-interpreter perch-spending-limit; do
    check "$cache/$name.wasm" "$name"
done
if [ "$(tr -d '[:space:]' < "$cache/stateless.id" 2>/dev/null)" != "$(jq -r .registry.id "$manifest")" ]; then
    problem "$cache/stateless.id is not the manifest's registry ($(jq -r .registry.id "$manifest"))"
fi
staged=(target/stellar/*/perch_account.wasm)
if [ -e "${staged[0]}" ]; then
    for file in "${staged[@]}"; do check "$file" perch-account; done
else
    problem "no factory build has staged perch_account.wasm under target/stellar/ (just build-contracts)"
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

if [ ${#problems[@]} -gt 0 ]; then
    echo "Perch drift (vendor/perch at ${pinned:0:7}, $manifest):" >&2
    printf '  - %s\n' "${problems[@]}" >&2
    exit 1
fi
echo "vendor/perch ${pinned:0:7} on $branch; consumed wasm, pin cache, factory embed, and npm workspaces match $manifest"
