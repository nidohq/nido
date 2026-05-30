#!/usr/bin/env bash
#
# Post-process contract bindings emitted by `stellar contract bindings
# typescript`. Run after every regeneration. Idempotent — running it again
# without an intervening regen is a no-op.
#
# What it fixes:
#
#   1. @stellar/stellar-sdk version. The generator hardcodes ^14.5.0 in each
#      bindings package.json. The frontend + passkey-sdk run on a newer major,
#      and npm hoists two parallel SDK copies when the bindings disagree. Two
#      copies make Operations built by the bindings unusable in the frontend's
#      TransactionBuilder ('e.sourceAccount is not a function'). We rewrite to
#      match whatever the frontend pins.
#
#   2. Missing `Context` import in multisig-policy bindings. The generator
#      emits code that references `Context` without importing it. We never
#      call enforce/can_enforce from JS, so an alias to `unknown` after the
#      imports compiles cleanly and lets the rest of the bindings type-check.
#
# Usage:
#   ./scripts/fix-bindings.sh
#
# Wire-up: call this immediately after running
#   `stellar contract bindings typescript --overwrite --output-dir packages/contract-bindings/<name> ...`

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BINDINGS_DIR="packages/contract-bindings"

# --- 1. Sync @stellar/stellar-sdk to the frontend's pin -----------------

target="$(python3 -c "
import json
p = json.load(open('packages/frontend/package.json'))
v = p.get('dependencies', {}).get('@stellar/stellar-sdk')
if not v:
    raise SystemExit('frontend does not pin @stellar/stellar-sdk')
print(v)
")"

echo "Target @stellar/stellar-sdk version: $target"

for pkg in "$BINDINGS_DIR"/*/package.json; do
    python3 - "$pkg" "$target" <<'PY'
import json, sys
path, target = sys.argv[1], sys.argv[2]
p = json.load(open(path))
deps = p.setdefault('dependencies', {})
current = deps.get('@stellar/stellar-sdk')
if current == target:
    print(f"  {path}: already {target}")
else:
    deps['@stellar/stellar-sdk'] = target
    with open(path, 'w') as f:
        json.dump(p, f, indent=2)
        f.write('\n')
    print(f"  {path}: {current} → {target}")
PY
done

# --- 2. Insert `type Context = unknown` shim in multisig-policy ---------

ms="$BINDINGS_DIR/multisig-policy/src/index.ts"
if [ -f "$ms" ]; then
    if grep -q '^type Context = unknown;' "$ms"; then
        echo "  $ms: Context shim already present"
    else
        python3 - "$ms" <<'PY'
import sys, re
path = sys.argv[1]
src = open(path).read()
shim = (
    "\n// Generated bindings reference `Context` but did not import it; we never\n"
    "// call enforce/can_enforce from JS, so an alias to `unknown` suffices.\n"
    "type Context = unknown;\n"
)
# Insert after the last `import ... from "..."` (or `} from "..."`) at top.
# Match the final import block — any line that ends with `from "...";` after a
# run of imports. We find the position after the last such line.
matches = list(re.finditer(r'^(?:import[^;]*;|}\s*from\s+["\'][^"\']+["\'];)\s*$', src, re.M))
if not matches:
    raise SystemExit(f"could not find imports in {path}")
end = matches[-1].end()
new = src[:end] + "\n" + shim + src[end:]
open(path, 'w').write(new)
print(f"  {path}: inserted Context shim")
PY
    fi
else
    echo "  (skipping Context shim: $ms not found)"
fi

echo "Done."
