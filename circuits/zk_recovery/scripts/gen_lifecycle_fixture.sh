#!/usr/bin/env bash
# Generate the M1 "lifecycle" fixture: a REAL bb-generated proof for the
# pinned witness documented in crates/integration-tests/src/zk_fixture.rs
# (account=[0x11;32], controller=[0x22;32], the Test SDF Network passphrase,
# nonce=1, timelock_secs=1_209_600, a deterministic P-256 pubkey, single-leaf
# depth-24 tree at index 0). The same circuit + VK as M0 are reused
# unchanged -- only the witness (Prover.toml) differs.
#
# Flow:
#   1. Run the `print_lifecycle_prover_toml` generator test (in
#      crates/integration-tests/tests/it/zk_fixture.rs), which computes
#      root/nullifier/auth_hash/etc. for the pinned witness using the exact
#      soroban_poseidon::poseidon2_hash construction that zk_vectors.rs
#      already proved matches Noir's Poseidon2::hash (arity 2, 4, 15) --
#      so these values are guaranteed to match what the circuit computes.
#   2. Temporarily swap circuits/zk_recovery/Prover.toml for the computed
#      lifecycle witness (restored via trap on exit, so the M0 default
#      Prover.toml checked into git is never modified).
#   3. Reuse gen_artifacts.sh (nargo compile/execute + bb write_vk/prove,
#      with the same docker fallback for old-glibc hosts) to produce a real
#      proof + public_inputs for that witness.
#   4. Copy proof/public_inputs into circuits/zk_recovery/fixtures/lifecycle/
#      and write prover_inputs.json (the computed witness, for provenance).
#   5. Assert public_inputs == root || nullifier || auth_hash byte-for-byte.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUIT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CIRCUIT_DIR}/../.." && pwd)"
FIXTURE_DIR="${CIRCUIT_DIR}/fixtures/lifecycle"

cd "${REPO_ROOT}"

echo "[1/5] computing pinned lifecycle witness (cargo test generator)"
GEN_OUTPUT="$(cargo test -p nido-integration-tests --test it \
    zk_fixture::print_lifecycle_prover_toml -- --ignored --nocapture 2>&1)"

if ! grep -q '###PROVER_TOML_BEGIN###' <<<"${GEN_OUTPUT}"; then
  echo "[!] generator did not produce the expected markers; full output:" >&2
  echo "${GEN_OUTPUT}" >&2
  exit 1
fi

PROVER_TOML="$(sed -n '/###PROVER_TOML_BEGIN###/,/###PROVER_TOML_END###/p' <<<"${GEN_OUTPUT}" \
    | sed '1d;$d')"
PROVER_JSON="$(sed -n '/###PROVER_JSON_BEGIN###/,/###PROVER_JSON_END###/p' <<<"${GEN_OUTPUT}" \
    | sed '1d;$d')"

mkdir -p "${FIXTURE_DIR}"
printf '%s\n' "${PROVER_JSON}" > "${FIXTURE_DIR}/prover_inputs.json"
echo "[i] wrote ${FIXTURE_DIR}/prover_inputs.json"

echo "[2/5] swapping in the lifecycle witness as circuits/zk_recovery/Prover.toml (temporary)"
PROVER_TOML_PATH="${CIRCUIT_DIR}/Prover.toml"
PROVER_TOML_BACKUP="$(mktemp)"
cp "${PROVER_TOML_PATH}" "${PROVER_TOML_BACKUP}"
restore_prover_toml() {
  cp "${PROVER_TOML_BACKUP}" "${PROVER_TOML_PATH}"
  rm -f "${PROVER_TOML_BACKUP}"
}
trap restore_prover_toml EXIT

cat > "${PROVER_TOML_PATH}" <<EOF
# GENERATED (temporarily, by gen_lifecycle_fixture.sh) -- do not edit or commit.
# This file is restored to the M0 default witness (single_leaf_membership_succeeds)
# when the script exits. Source of truth: the pinned constants in
# crates/integration-tests/src/zk_fixture.rs and the print_lifecycle_prover_toml
# generator in crates/integration-tests/tests/it/zk_fixture.rs.
${PROVER_TOML}
EOF

echo "[3/5] running gen_artifacts.sh (nargo + bb, same mechanics as \`just build-circuits\`)"
bash "${SCRIPT_DIR}/gen_artifacts.sh"

echo "[4/5] staging proof + public_inputs as the lifecycle fixture"
cp "${CIRCUIT_DIR}/target/proof" "${FIXTURE_DIR}/proof"
cp "${CIRCUIT_DIR}/target/public_inputs" "${FIXTURE_DIR}/public_inputs"

# gen_artifacts.sh overwrites circuits/zk_recovery/target/{proof,public_inputs}
# and public/circuits/manifest.json, but those are the M0 default-witness
# artifacts and are git-tracked (unlike the rest of target/, which is
# gitignored) -- restore them now that the lifecycle proof/public_inputs are
# safely copied out, so this script never leaves the M0 fixtures dirty.
echo "[i] restoring M0's tracked target/ + manifest.json artifacts"
git -C "${REPO_ROOT}" checkout -- \
  circuits/zk_recovery/target/proof \
  circuits/zk_recovery/target/public_inputs \
  circuits/zk_recovery/public/circuits/manifest.json

echo "[5/5] verifying public_inputs == root || nullifier || auth_hash"
python3 - "${FIXTURE_DIR}/prover_inputs.json" "${FIXTURE_DIR}/public_inputs" <<'PYEOF'
import json, sys

with open(sys.argv[1]) as f:
    inputs = json.load(f)
with open(sys.argv[2], "rb") as f:
    public_inputs = f.read()

assert len(public_inputs) == 96, f"expected 96-byte public_inputs, got {len(public_inputs)}"

def h(s):
    return bytes.fromhex(s[2:] if s.startswith("0x") else s)

root, nullifier, auth_hash = h(inputs["root"]), h(inputs["nullifier"]), h(inputs["auth_hash"])
assert public_inputs[0:32] == root, "public_inputs[0:32] != root"
assert public_inputs[32:64] == nullifier, "public_inputs[32:64] != nullifier"
assert public_inputs[64:96] == auth_hash, "public_inputs[64:96] != auth_hash"
print("[ok] public_inputs matches root || nullifier || auth_hash")
PYEOF

echo "[ok] lifecycle fixture written:"
ls -la "${FIXTURE_DIR}"
