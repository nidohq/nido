#!/usr/bin/env bash
# Pack @stellar-registry/perch (perch-js) from Perch's source at Nido's pin
# (scripts/perch-src.sh) into perch-npm/, for a pin whose perch-js npm has no
# published version of: the SDK depends on that tarball (`file:`), so an
# install needs neither Perch's source nor a build of it. The tarball is named
# for the package version and the pinned commit,
# perch-npm/stellar-registry-perch-<version>-<rev7>.tgz, and replaces any
# other perch-js tarball there.
#
# The build is the package's own (`tsc -p tsconfig.build.json`, then `npm
# pack`), with the TypeScript and dependencies of Nido's install, so run it
# after `npm install`.
#
#   scripts/perch-js-pack.sh           write the tarball, print its path
#   scripts/perch-js-pack.sh --check   fail unless the committed tarball's
#                                      files equal a fresh pack's
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
check=""
[ "${1:-}" = "--check" ] && check=1
perch="$("$repo_root/scripts/perch-src.sh")"
rev="$("$repo_root/scripts/perch-src.sh" --rev)"
src="$perch/packages/perch-js"
version="$(jq -r .version "$src/package.json")"
name="stellar-registry-perch-$version-${rev:0:7}.tgz"
[ -x "$repo_root/node_modules/.bin/tsc" ] || { echo "error: no TypeScript in node_modules (npm install first)" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/pkg" "$work/out"
(cd "$src" && tar cf - --exclude ./node_modules --exclude ./dist .) | (cd "$work/pkg" && tar xf -)
ln -s "$repo_root/node_modules" "$work/pkg/node_modules"
(cd "$work/pkg" && ./node_modules/.bin/tsc -p tsconfig.build.json)
(cd "$work/pkg" && npm pack --ignore-scripts --silent --pack-destination "$work/out" >/dev/null)
packed="$(ls "$work/out"/*.tgz)"

if [ -n "$check" ]; then
    committed="$repo_root/perch-npm/$name"
    [ -f "$committed" ] || { echo "error: no $name in perch-npm/ (scripts/perch-js-pack.sh)" >&2; exit 1; }
    mkdir "$work/a" "$work/b"
    tar xzf "$committed" -C "$work/a"
    tar xzf "$packed" -C "$work/b"
    diff -r "$work/a" "$work/b" >&2 ||
        { echo "error: perch-npm/$name is not perch-js as Perch ${rev:0:7} builds it (scripts/perch-js-pack.sh)" >&2; exit 1; }
    echo "perch-npm/$name: perch-js $version as Perch ${rev:0:7} builds it"
    exit 0
fi

mkdir -p "$repo_root/perch-npm"
find "$repo_root/perch-npm" -name 'stellar-registry-perch-*.tgz' -delete
cp "$packed" "$repo_root/perch-npm/$name"
echo "perch-npm/$name"
