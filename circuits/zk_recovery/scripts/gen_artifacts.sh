#!/usr/bin/env bash
# Generate zk_recovery circuit artifacts: compile the ACIR, solve the
# checked-in Prover.toml witness, and run bb to produce a VK + proof +
# public inputs at verifier_target=evm-no-zk. Adapted from
# ../../../zk/rs-soroban-ultrahonk/tornado_classic/circuit/scripts/gen_artifacts.sh
# (same nargo/bb version guard, write_vk/prove flags, and dir-to-file
# flattening), pointed at circuits/zk_recovery and extended to assert the
# public-input count and to emit public/circuits/manifest.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PATH="$HOME/.nargo/bin:$HOME/.bb:${SCRIPT_DIR}:${PATH}"
cd "${PROJECT_ROOT}"

REQUIRED_NARGO_VERSION="1.0.0-beta.18"
PROJECT_NAME="zk_recovery"

NARGO_BIN="${NARGO:-$(command -v nargo || echo "${HOME}/.nargo/bin/nargo")}"
BB_BIN="${BB:-$(command -v bb || echo "${HOME}/.bb/bb")}"

if ! command -v "${NARGO_BIN}" >/dev/null 2>&1; then
  echo "[!] nargo not found at ${NARGO_BIN}. Set NARGO=/path/to/nargo" >&2
  exit 1
fi

NARGO_VERSION_RAW="$("${NARGO_BIN}" --version 2>/dev/null | head -n1)"
if [[ "${NARGO_VERSION_RAW}" != *"${REQUIRED_NARGO_VERSION}"* ]]; then
  echo "[!] Expected nargo ${REQUIRED_NARGO_VERSION}, but got '${NARGO_VERSION_RAW}'" >&2
  exit 1
fi

echo "[i] Using NARGO='${NARGO_BIN}', BB='${BB_BIN}', NAME='${PROJECT_NAME}'"

# Rootless dockerd maps container root to a fixed host uid via a subuid
# range that is *not* the invoking user's real uid, so files bb writes via
# docker (see run_bb below) end up owned by that other uid, with no write
# bit for anyone else. That breaks a subsequent *native* re-run of `nargo
# compile`/`nargo execute` (can't recreate target/zk_recovery.json, can't
# create target/zk_recovery.gz) and even `rm -rf target`. Defensively widen
# permissions on any pre-existing target/ before touching it, using docker
# itself if we don't own it natively.
if [[ -d target ]] && ! find target -maxdepth 0 -writable | grep -q .; then
  if command -v docker >/dev/null 2>&1; then
    echo "[i] target/ is left over from a previous docker-based build (different host uid) -- widening permissions via docker"
    docker run --rm -v "${PROJECT_ROOT}:/work" -w /work ubuntu:24.04 chmod -R a+rwX target
  else
    echo "[!] target/ is not writable and docker is unavailable to fix it. Remove it manually." >&2
    exit 1
  fi
fi

echo "[1/5] nargo compile"
"${NARGO_BIN}" compile

ACIR="target/${PROJECT_NAME}.json"
if [[ ! -f "${ACIR}" ]]; then
  echo "[!] ACIR not found: ${ACIR}" >&2
  exit 1
fi

echo "[i] asserting public-input count == 3 (root, nullifier, auth_hash)"
python3 -c "
import json
abi = json.load(open('${ACIR}'))['abi']
n = sum(1 for p in abi['parameters'] if p['visibility'] == 'public')
print('[i] public inputs:', n)
assert n == 3, f'expected 3 public inputs, got {n}'
"

echo "[2/5] nargo execute (solve witness from Prover.toml)"
"${NARGO_BIN}" execute

WIT="target/${PROJECT_NAME}.gz"
if [[ ! -f "${WIT}" ]]; then
  echo "[!] Witness not found: ${WIT}" >&2
  ls -la target || true
  exit 1
fi

# bb 3.x requires glibc >= 2.38 (e.g. fails with "GLIBC_2.38 not found" on
# Ubuntu/Pop!_OS 22.04's glibc 2.35). If the local bb can't even print its
# version, fall back to running the bb steps inside a throwaway Ubuntu 24.04
# container built from scripts/Dockerfile.
bb_native_ok() {
  "${BB_BIN}" --version >/dev/null 2>&1
}

USE_DOCKER_BB=0
if ! bb_native_ok; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "[!] bb at ${BB_BIN} does not run natively (glibc mismatch?) and docker is unavailable." >&2
    "${BB_BIN}" --version || true
    exit 1
  fi
  echo "[i] bb does not run natively here (likely a glibc mismatch) -- using docker" >&2
  USE_DOCKER_BB=1
  BB_DOCKER_IMAGE="zk-recovery-circuits:${REQUIRED_NARGO_VERSION}"
  if ! docker image inspect "${BB_DOCKER_IMAGE}" >/dev/null 2>&1; then
    echo "[i] building ${BB_DOCKER_IMAGE}"
    docker build -q -t "${BB_DOCKER_IMAGE}" -f "${SCRIPT_DIR}/Dockerfile" "${SCRIPT_DIR}" >/dev/null
  fi
fi

run_bb() {
  if [[ "${USE_DOCKER_BB}" == "1" ]]; then
    docker run --rm -v "${PROJECT_ROOT}:/work" -w /work "${BB_DOCKER_IMAGE}" bb "$@"
    # bb writes as a (rootless-docker-remapped) uid that is not the host
    # user, so chown-to-host-uid can't work across the namespace boundary.
    # Widen permissions instead, from inside the same container (which does
    # own the files it just wrote), so the flatten logic below and later
    # native re-runs of this script can read/overwrite/delete them.
    docker run --rm -v "${PROJECT_ROOT}:/work" -w /work "${BB_DOCKER_IMAGE}" \
      chmod -R a+rwX /work/target
  else
    "${BB_BIN}" "$@"
  fi
}

echo "[3/5] bb write_vk --verifier_target evm-no-zk"
rm -rf target/vk
run_bb write_vk \
  --verifier_target evm-no-zk \
  --bytecode_path "${ACIR}" \
  --output_path target

# bb may write directories; flatten to files.
if [[ -d target/vk && -f target/vk/vk ]]; then
  mv target/vk/vk target/vk.tmp
  rmdir target/vk
  mv target/vk.tmp target/vk
fi

echo "[4/5] bb prove --verifier_target evm-no-zk"
run_bb prove \
  --verifier_target evm-no-zk \
  --bytecode_path "${ACIR}" \
  --witness_path "${WIT}" \
  --output_path target

if [[ -d target/proof && -f target/proof/proof ]]; then
  mv target/proof/proof target/proof.tmp
  rmdir target/proof
  mv target/proof.tmp target/proof
fi
if [[ -d target/public_inputs && -f target/public_inputs/public_inputs ]]; then
  mv target/public_inputs/public_inputs target/public_inputs.tmp
  rmdir target/public_inputs
  mv target/public_inputs.tmp target/public_inputs
fi

for f in vk proof public_inputs; do
  if [[ ! -f "target/${f}" ]]; then
    echo "[!] expected artifact target/${f} not found" >&2
    ls -la target || true
    exit 1
  fi
done

echo "[5/5] writing public/circuits/manifest.json"
mkdir -p public/circuits
CIRCUIT_SHA256="$(sha256sum "${ACIR}" | cut -d' ' -f1)"
VK_SHA256="$(sha256sum target/vk | cut -d' ' -f1)"
NARGO_VER="$("${NARGO_BIN}" --version 2>/dev/null | head -n1)"
if [[ "${USE_DOCKER_BB}" == "1" ]]; then
  BB_VER="$(docker run --rm "${BB_DOCKER_IMAGE}" bb --version 2>/dev/null | head -n1)"
else
  BB_VER="$("${BB_BIN}" --version 2>/dev/null | head -n1)"
fi
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > public/circuits/manifest.json <<EOF
{
  "circuitSha256": "${CIRCUIT_SHA256}",
  "vkSha256": "${VK_SHA256}",
  "nargo": "${NARGO_VER}",
  "bb": "${BB_VER}",
  "builtAt": "${BUILT_AT}"
}
EOF

echo "[ok] Artifacts generated under ./target:"
ls -la target | sed 's/^/  /'
echo "[ok] Manifest:"
cat public/circuits/manifest.json | sed 's/^/  /'
