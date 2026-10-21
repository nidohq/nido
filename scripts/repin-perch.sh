#!/usr/bin/env bash
# Re-pin Nido to a Perch commit and regenerate everything derived from the
# pin, leaving the result as working-tree changes for review:
#
#   1. vendor/perch moves to <perch-commit>, refused unless that commit is on
#      the branch .gitmodules declares and carries deployments/<network>.json,
#      and the Perch git dependencies in Cargo.toml move to the same rev
#      (Cargo.lock follows), so the crates Nido builds and the manifest it
#      fetches by come from one Perch commit;
#   2. `just perch-infra` writes the factory's account pin
#      (contracts/factory/wasm/perch-account.sha256) from the manifest and
#      fetches the stack by the manifest's hashes and content addresses
#      (Perch's fetch-infra-wasm.sh refuses any other byte; nothing is
#      resolved by name), then `just build-contracts` rebuilds the factory
#      around that pin;
#   3. `just bindings-perch` regenerates packages/contract-bindings/perch-*;
#   4. scripts/repin-perch-pins.mjs rewrites the SDK's Perch pins from the
#      manifest (`perch.TESTNET`, except Nido's own factory, and the policyDoc
#      registry/wasm-hash pins), and package-lock.json follows the submodule's
#      npm workspaces;
#   5. `just check-vendor-drift` checks the result against the manifest;
#   6. the SDK's validate-differential corpus is regenerated from the new
#      perch_ir::validate (its generator is seeded, so an unchanged validator
#      leaves it byte-identical); a changed verdict is for the SDK's
#      validate.ts to match, which its vitest suite checks; the new-account
#      reads the SDK's newAccount test replays are regenerated from the new
#      account wasm too;
#   7. `cargo test --workspace` runs every Rust suite against the new stack,
#      which also refreshes Cargo.lock.
#
# Nido's factory is not redeployed. When the manifest moves `perch-account`
# or `perch-webauthn-verifier`, the SDK's deployment.test.ts fails until the
# factory is: run `just deploy-factory` on the re-pin's branch and commit the
# record it writes, with `perch.TESTNET.factory`, before the re-pin merges.
#
# Exit status: 0 when everything passes, 3 when the re-pin is complete but
# `cargo test` failed (the changes are still written, for a human to adapt),
# anything else when the re-pin itself failed and the tree is not a usable
# re-pin.
#
# Usage: scripts/repin-perch.sh <perch-commit> [--network testnet] [--summary <file>]
#   <perch-commit>  full 40-hex Perch commit
#   --network       the manifest to pin (deployments/<network>.json); Nido
#                   carries pins for testnet only
#   --summary       write a Markdown summary of the re-pin (old and new pin,
#                   every manifest entry that changed, test result) to <file>
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
commit=""
network=testnet
summary=""
while [ $# -gt 0 ]; do
    case "$1" in
        --network) network="$2"; shift 2 ;;
        --summary) summary="$2"; shift 2 ;;
        -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "unknown option: $1" >&2; exit 1 ;;
        *) commit="$1"; shift ;;
    esac
done
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo "error: expected a full 40-hex Perch commit, got '$commit'" >&2; exit 1; }
[ "$network" = testnet ] || { echo "error: Nido carries Perch pins for testnet only, not '$network'" >&2; exit 1; }
for tool in git jq just node npm cargo stellar; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done
export STELLAR_NETWORK="$network"
manifest="vendor/perch/deployments/$network.json"

[ "$(git submodule status vendor/perch | cut -c1)" != "-" ] || git submodule update --init vendor/perch
old="$(git ls-tree HEAD vendor/perch | awk '{print $3}')"
old_manifest="$(mktemp)"
trap 'rm -f "$old_manifest"' EXIT
git -C vendor/perch show "$old:deployments/$network.json" >"$old_manifest" 2>/dev/null || echo '{}' >"$old_manifest"

# 1. Move the submodule, only to a commit on its declared branch.
branch="$(git config -f .gitmodules submodule.vendor/perch.branch)"
# A shallow checkout (CI's) can't answer ancestry without the history.
deepen=()
[ "$(git -C vendor/perch rev-parse --is-shallow-repository)" = true ] && deepen=(--unshallow)
git -C vendor/perch fetch --quiet ${deepen[@]+"${deepen[@]}"} origin "$commit" "+refs/heads/$branch:refs/remotes/origin/$branch"
git -C vendor/perch merge-base --is-ancestor "$commit" "origin/$branch" ||
    { echo "error: Perch commit $commit is not on origin/$branch" >&2; exit 1; }
git -C vendor/perch checkout --quiet --detach "$commit"
git add vendor/perch
[ -f "$manifest" ] || { echo "error: Perch $commit has no $manifest" >&2; exit 1; }
# The Perch crates, at the submodule's commit. `cargo fetch` re-resolves only
# the moved git source (and whatever its crates newly depend on) in Cargo.lock.
perl -pi -e "s{(git = \"https://github\.com/stellar-registry/perch\", rev = \")[0-9a-f]{40}\"}{\${1}$commit\"}g" Cargo.toml
grep -q "stellar-registry/perch\", rev = \"$commit\"" Cargo.toml ||
    { echo "error: no Perch git dependency in Cargo.toml to move to $commit" >&2; exit 1; }
cargo fetch --quiet
echo "vendor/perch: ${old:0:7} -> ${commit:0:7} ($manifest, deployed from $(jq -r .source.commit "$manifest" | cut -c1-7))" >&2

# 2-3. The stack by hash, Nido's contracts around it, the Perch bindings.
just perch-infra
just build-contracts
just bindings-perch

# 4. The SDK pins and the npm workspace lock.
node scripts/repin-perch-pins.mjs "$manifest"
npm install --package-lock-only --ignore-scripts --no-audit --no-fund

# 5. The documentation links to the new pin, and everything consumed
# matches the manifest.
scripts/pin-perch-links.sh
just check-vendor-drift

# 6. perch_ir's verdicts on the SDK's differential corpus. A suite that no
# longer builds is step 7's failure to report, not a failed re-pin.
corpus=packages/passkey-sdk/src/policyDoc/testdata/validate-differential.json
NIDO_WRITE_VALIDATE_CORPUS=1 cargo test -p nido-integration-tests --test it validate_differential ||
    echo "warning: could not regenerate $corpus" >&2
corpus_changed=false
git diff --quiet -- "$corpus" || corpus_changed=true
NIDO_WRITE_NEW_ACCOUNT_READS=1 cargo test -p nido-integration-tests --test it new_account_reads ||
    echo "warning: could not regenerate packages/passkey-sdk/src/perch/testdata/new-account-reads.json" >&2

# 7. The Rust suites against the new stack.
tests=passed
cargo test --workspace --no-fail-fast || tests=failed

if [ -n "$summary" ]; then
    {
        echo "| | Perch commit | Deployed from |"
        echo "|---|---|---|"
        echo "| Before | \`$old\` | \`$(jq -r '.source.commit // "?"' "$old_manifest")\` |"
        echo "| After | \`$commit\` | \`$(jq -r .source.commit "$manifest")\` |"
        echo
        echo "Manifest entries that changed (\`$manifest\`):"
        echo
        echo "| Entry | Before | After |"
        echo "|---|---|---|"
        jq -r --slurpfile old "$old_manifest" '
            def named: {"registry.id": .registry.id}
                + ([.contracts | to_entries[] | {(.key + " address"): .value.address}, {(.key + " sha256"): .value.sha256}] | add)
                + {"zk.circuit_id": .zk.circuit_id, "zk.tree_depth": .zk.tree_depth};
            ($old[0] | if . == {} then {} else named end) as $before | named as $after
            | ($before + $after | keys_unsorted)[] as $k
            | select($before[$k] != $after[$k])
            | "| \($k) | `\($before[$k] // "—")` | `\($after[$k] // "—")` |"
        ' "$manifest"
        echo
        if [ "$corpus_changed" = true ]; then
            echo "**\`perch_ir::validate\` changed its verdicts:** \`$corpus\` is regenerated. Port the change to \`packages/passkey-sdk/src/policyDoc/validate.ts\` until \`validate.test.ts\` passes."
            echo
        fi
        if [ "$tests" = passed ]; then
            echo "\`cargo test --workspace\` passed against the new stack."
        else
            echo "**\`cargo test --workspace\` failed against the new stack.** The re-pin is complete, but Nido needs code changes to adopt it; push them to this branch (a re-dispatch for the same Perch commit then leaves the branch alone)."
        fi
    } >"$summary"
fi

[ "$tests" = passed ] || exit 3
