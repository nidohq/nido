#!/usr/bin/env bash
# When this branch tests a Perch stack built from the pinned source
# ([workspace.metadata.perch] stack = "build", `just perch-infra`), the
# native Perch crates must compile in the same build-time pins as that
# stack's wasm, which perch-infra writes into the fetched source
# (scripts/perch-src.sh), not the ones Perch commits. This writes
# target/perch-overlay.toml, a Cargo `[patch]` building every Perch crate
# Cargo.lock takes from the pinned repository from that source instead. Pass
# it to the commands that run the Perch stack
# (`cargo test --workspace $(scripts/perch-overlay-config.sh)`).
#
# No-op for a deployed stack. Usage: scripts/perch-overlay.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.."
[ "$(scripts/perch-src.sh --stack)" = build ] || exit 0
perch="$(scripts/perch-src.sh)"

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
