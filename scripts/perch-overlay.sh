#!/usr/bin/env bash
# This branch builds and tests against a Perch rehearsal deployment, one
# deployed in registries of its own: Perch's tree at the pinned commit plus
# the files that deployment changed (Perch docs/deploy/README.md, rehearsal
# mode), kept in perch-overlay/ at the same paths: its manifest, its dev
# registry.path and verifiers.path, and the build-time pins of its bytes.
#
#   1. Copies perch-overlay/ over vendor/perch, so `just perch-infra` fetches
#      that deployment by its manifest's hashes and content addresses and
#      the drift and factory checks read it.
#   2. Writes target/perch-overlay.toml, a Cargo `[patch]` building every
#      Perch crate Cargo.lock takes from the submodule's repository from the
#      overlaid submodule instead, so the registries and pins those crates
#      compile in are the deployment's. Pass it to the commands that run the
#      Perch stack (`cargo test --workspace --config target/perch-overlay.toml`).
#
# No-op without perch-overlay/. Usage: scripts/perch-overlay.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
[ -d perch-overlay ] || exit 0
[ -d vendor/perch/crates ] || { echo "error: vendor/perch is not checked out (git submodule update --init)" >&2; exit 1; }

(cd perch-overlay && find . -type f) | while IFS= read -r f; do
    cp "perch-overlay/$f" "vendor/perch/$f"
done

url="$(git config -f .gitmodules submodule.vendor/perch.url)"
mkdir -p target
python3 - "${url%.git}" > target/perch-overlay.toml <<'EOF'
import glob, os, re, sys
url = sys.argv[1]
dirs = {}
for manifest in glob.glob('vendor/perch/crates/*/Cargo.toml') + glob.glob('vendor/perch/vendor/*/Cargo.toml'):
    m = re.search(r'^\[package\][^\[]*?^name\s*=\s*"([^"]+)"', open(manifest).read(), re.M | re.S)
    if m:
        dirs[m.group(1)] = os.path.abspath(os.path.dirname(manifest))
# The Perch crates Cargo.lock takes from the repository, or from a patch
# like this one (a lock written while it applied has no source for them).
names = set()
for block in open('Cargo.lock').read().split('[[package]]'):
    m = re.search(r'name = "([^"]+)"', block)
    if m and (f'source = "git+{url}' in block or ('source = ' not in block and m.group(1) in dirs)):
        names.add(m.group(1))
names = sorted(names)
missing = [n for n in names if n not in dirs]
if missing:
    sys.exit(f"error: no crate in vendor/perch for {', '.join(missing)}")
print(f'[patch."{url}"]')
for n in names:
    print(f'{n} = {{ path = "{dirs[n]}" }}')
EOF
echo "perch-overlay: $(cd perch-overlay && find . -type f | wc -l | tr -d ' ') files over vendor/perch; target/perch-overlay.toml patches $(($(wc -l < target/perch-overlay.toml) - 1)) Perch crates" >&2
