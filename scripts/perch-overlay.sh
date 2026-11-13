#!/usr/bin/env bash
# The native Perch crates must compile in the same build-time pins as the
# stack's wasm the tests run, which can differ from the ones Perch commits:
#
#   - a rehearsal deployment, one deployed in registries of its own (Perch
#     docs/deploy/README.md, rehearsal mode): perch-overlay/ holds the files
#     that deployment changed, at the same paths (its manifest, its dev
#     registry.path and verifiers.path, the build-time pins of its bytes),
#     and this copies them over Perch's source at the pin
#     (scripts/perch-src.sh), so `just perch-infra` fetches that deployment
#     by its manifest's hashes and content addresses and the drift and
#     factory checks read it;
#   - a stack built from the pinned source ([workspace.metadata.perch]
#     stack = "build"): `just perch-infra` writes its pins into that source.
#
# Either way it writes target/perch-overlay.toml, a Cargo `[patch]` building
# every Perch crate Cargo.lock takes from the pinned repository from that
# source instead. Pass it to the commands that run the Perch stack
# (`cargo test --workspace $(scripts/perch-overlay-config.sh)`).
#
# No-op for a stack Perch's own commit describes. Usage: scripts/perch-overlay.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
[ -d perch-overlay ] || [ "$(scripts/perch-src.sh --stack)" = build ] || exit 0
perch="$(scripts/perch-src.sh)"
if [ -d perch-overlay ]; then
    (cd perch-overlay && find . -type f) | while IFS= read -r f; do
        cp "perch-overlay/$f" "$perch/$f"
    done
fi

url="$(scripts/perch-src.sh --git)"
mkdir -p target
python3 - "${url%.git}" "$perch" > target/perch-overlay.toml <<'EOF'
import glob, os, re, sys
url, perch = sys.argv[1], sys.argv[2]
dirs = {}
for manifest in glob.glob(f'{perch}/crates/*/Cargo.toml') + glob.glob(f'{perch}/vendor/*/Cargo.toml'):
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
    sys.exit(f"error: no crate in {perch} for {', '.join(missing)}")
print(f'[patch."{url}"]')
for n in names:
    print(f'{n} = {{ path = "{dirs[n]}" }}')
EOF
echo "perch-overlay: target/perch-overlay.toml patches $(($(wc -l < target/perch-overlay.toml) - 1)) Perch crates to $perch" >&2
