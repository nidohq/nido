#!/usr/bin/env bash
# Detect drift between Nido's Perch pin (the rev of the root Cargo.toml's
# Perch git dependencies) and what Nido builds, tests, and ships against it.
# Perch's source at the pin is scripts/perch-src.sh's checkout. Fails, listing
# every mismatch, when:
#
#   1. that checkout isn't the pinned commit, or has local edits to tracked
#      files;
#   2. the pinned commit isn't on the Perch branch Cargo.toml's
#      [workspace.metadata.perch] declares (a rewritten or deleted branch);
#      skipped with --offline;
#   3. a Perch wasm Nido consumes isn't the manifest's
#      (deployments/$STELLAR_NETWORK.json at the pin, default testnet): the
#      fetched stack in target/wasm32v1-none/contract/, the build-time pins
#      the smart account compiles in (committed in Perch, read here from the
#      checkout; the registry its registry.path derives, by Perch's
#      scripts/derive-id.py), and the account hash the factory pins (its
#      committed contracts/factory/wasm/perch-account.sha256, which `just
#      perch-infra` writes, and the built nido_factory.wasm);
#   4. npm resolves an unbundled Perch package (today only perch-zk, which
#      Perch's npm packages do not carry) to another version than the pinned
#      source carries, or the SDK pins another. Perch's main package
#      (@stellar-registry/perch) comes from npm by its own version.
#   5. a commit-pinned Perch link in Nido's documentation names another commit
#      than the pinned one (scripts/pin-perch-links.sh rewrites them);
#   6. a Perch crate Cargo builds comes from anywhere but the pinned commit: a
#      Perch git dependency in Cargo.toml at another repository or rev, a
#      Cargo.lock entry resolved to another commit, or a path dependency into
#      the fetched source (scripts/repin-perch.sh moves every rev together).
#
# `just perch-infra` refuses any byte that doesn't match the manifest when it
# fetches; this check catches what changes afterwards (a re-pin without a
# refetch, a stale target/, a hand-copied wasm). The SDK's `perch.TESTNET` is
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
problems=()
problem() { problems+=("$*"); }

for tool in git jq python3; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

pinned="$(scripts/perch-src.sh --rev)"
perch_git="$(scripts/perch-src.sh --git)"
branch="$(scripts/perch-src.sh --branch)"
perch="$(scripts/perch-src.sh)"
manifest="$perch/deployments/$network.json"
# The repository Cargo.toml's Perch comes from: upstream Perch, or a fork
# whose branch holds the pin. Documentation links name it too.
perch_repo="${perch_git#https://github.com/}"
perch_repo="${perch_repo%.git}"

# 1. The checkout is the pinned commit, unedited, except perch-overlay/'s
# files exactly as it holds them: the rehearsal deployment this branch builds
# against (scripts/perch-overlay.sh).
if ! head="$(git -C "$perch" rev-parse HEAD 2>/dev/null)"; then
    problem "$perch is not a Perch git checkout"
else
    [ "$head" = "$pinned" ] || problem "$perch is at ${head:0:7}, not the pinned ${pinned:0:7}"
    edited=()
    while IFS= read -r f; do
        [ -n "$f" ] || continue
        [ -f "perch-overlay/$f" ] && cmp -s "perch-overlay/$f" "$perch/$f" || edited+=("$f")
    done < <(git -C "$perch" status --porcelain --untracked-files=no | awk '{print $2}')
    [ ${#edited[@]} -eq 0 ] || problem "$perch has local edits to tracked files: ${edited[*]}"
fi

# 2. The pinned commit is on the declared branch. The checkout is shallow;
# its branch's commits alone (no trees or blobs) answer ancestry.
if [ -z "$offline" ]; then
    if git -C "$perch" fetch --quiet --unshallow --filter=tree:0 origin "$branch" 2>/dev/null ||
        git -C "$perch" fetch --quiet --filter=tree:0 origin "$branch"; then
        git -C "$perch" merge-base --is-ancestor "$pinned" FETCH_HEAD ||
            problem "the pinned commit ${pinned:0:7} is not on $perch_git $branch"
    else
        problem "could not fetch $perch_git $branch to check the pin (use --offline to skip)"
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
# them: the checkout is the same commit (check 6) with no local edits
# (check 1).
pins="$perch/crates/perch-smart-account/wasm"
for name in perch-doc-compiler perch-interpreter perch-spending-limit; do
    if [ "$(tr -d '[:space:]' < "$pins/$name.sha256" 2>/dev/null)" != "$(want "$name")" ]; then
        problem "$pins/$name.sha256 is not the manifest's $name ($(want "$name"))"
    fi
done
# The registry the account derives its infra from. Perch compiles in no
# registry id, only registry.path (the Stellar Registry root's deployer and
# salt, then named deploys below it); Perch's derive-id.py runs the account's
# derivation under the manifest's network passphrase, one hop per line from
# the root. Its root and its last hop must be the manifest's. A pin from
# before registry.path (Perch #146) committed the id itself, in stateless.id.
registry="$(jq -r .registry.id "$manifest")"
if [ -f "$pins/registry.path" ]; then
    if ! chain="$(python3 "$perch/scripts/derive-id.py" chain "$(jq -r .network_passphrase "$manifest")" "$pins/registry.path" 2>&1)"; then
        problem "could not derive the registry from $pins/registry.path: $chain"
    else
        [ "$(tail -n1 <<<"$chain")" = "$registry" ] ||
            problem "$pins/registry.path derives registry $(tail -n1 <<<"$chain") on $network, not the manifest's ($registry)"
        root="$(jq -r '.registry.root // empty' "$manifest")"
        [ -z "$root" ] || [ "$(head -n1 <<<"$chain")" = "$root" ] ||
            problem "$pins/registry.path derives the Stellar Registry root $(head -n1 <<<"$chain") on $network, not the manifest's ($root)"
    fi
elif [ "$(tr -d '[:space:]' < "$pins/stateless.id" 2>/dev/null)" != "$registry" ]; then
    problem "$pins has neither a registry.path deriving the manifest's registry nor a stateless.id naming it ($registry)"
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

# 4. npm resolves perch-zk at the version the pinned source carries, from
#    the npm registry, and the SDK and frontend pin the same.
name=@stellar-registry/perch-zk
carried="$(jq -r .version "$perch/packages/perch-zk/package.json")"
locked="$(jq -r --arg k "node_modules/$name" '.packages[$k] | "\(.version) \(.resolved)"' package-lock.json)"
[[ "$locked" == "$carried https://registry.npmjs.org/"* ]] ||
    problem "package-lock.json resolves $name to '$locked', not $carried from the npm registry (Perch ${pinned:0:7} carries $carried)"
for consumer in packages/passkey-sdk packages/frontend; do
    want="$(jq -r --arg n "$name" '.dependencies[$n] // empty' "$consumer/package.json")"
    [ -z "$want" ] || [ "$want" = "$carried" ] || problem "$consumer pins $name $want; Perch ${pinned:0:7} carries $carried"
done

# 5. Every commit-pinned Perch link in Nido's documentation names the pinned
#    commit, so a reader on GitHub sees the Perch source this tree builds and
#    tests against (scripts/pin-perch-links.sh rewrites them after a bump).
while IFS= read -r hit; do
    problem "documentation links Perch at another commit (scripts/pin-perch-links.sh): $hit"
done < <(git grep -n -E "github\.com/(stellar-registry/perch|${perch_repo//./\\.})/(blob|tree)/([0-9a-f]{40}|PERCH_SHA)" -- '*.md' ':!docs/reviews' | grep -v "github\.com/$perch_repo/[a-z]*/$pinned/" || true)

# 6. Cargo's Perch is the pinned commit: every git dependency on a Perch
#    repository (the Perch crates, and the crates Perch vendors).
deps="$(grep -E 'git = "https://github\.com/[^"]*perch(\.git)?"' Cargo.toml || true)"
[ -n "$deps" ] || problem "Cargo.toml has no Perch git dependency"
while IFS= read -r dep; do
    [ -n "$dep" ] || continue
    [[ "$dep" == *"git = \"$perch_git\", rev = \"$pinned\""* ]] ||
        problem "Cargo.toml pins a Perch crate elsewhere than perch-account ($perch_git at ${pinned:0:7}): $dep"
done <<<"$deps"
while IFS= read -r hit; do
    problem "a Perch crate is a path dependency into the fetched source: $hit"
done < <(git grep -n 'path = "[^"]*perch-src' -- '*Cargo.toml' || true)
locked="$(grep -F "source = \"git+$perch_git" Cargo.lock | sort -u || true)"
[ -n "$locked" ] || problem "Cargo.lock resolves no crate from $perch_git"
while IFS= read -r src; do
    [ -n "$src" ] || continue
    [ "$src" = "source = \"git+$perch_git?rev=$pinned#$pinned\"" ] ||
        problem "Cargo.lock resolves Perch at another commit than the pin (${pinned:0:7}): $src"
done <<<"$locked"

if [ ${#problems[@]} -gt 0 ]; then
    echo "Perch drift (pin ${pinned:0:7}, $manifest):" >&2
    printf '  - %s\n' "${problems[@]}" >&2
    exit 1
fi
echo "Perch ${pinned:0:7} on $branch; Cargo's Perch crates and lock at that commit; consumed wasm, build-time pins, factory pin, and npm's perch-zk match $manifest"
