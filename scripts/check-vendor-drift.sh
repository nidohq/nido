#!/usr/bin/env bash
# Detect drift in contracts/vendor/ultrahonk-soroban-verifier/src/ -- a
# verbatim copy of an unaudited third-party crate that nothing in this repo
# should ever hand-edit. Computes a deterministic, sorted sha256 manifest of
# that tree and compares it against the committed sibling
# CHECKSUMS.sha256. Any content change, added file, removed file, or rename
# under src/ shows up as a mismatch and fails the check.
#
# Usage: scripts/check-vendor-drift.sh   (safe to run from anywhere -- it
# cd's to the repo root itself, based on this script's own location)
#
# Regenerating the baseline (only when a vendor bump/update is deliberate
# and has been reviewed):
#   find contracts/vendor/ultrahonk-soroban-verifier/src -type f | LC_ALL=C sort \
#     | xargs sha256sum > contracts/vendor/ultrahonk-soroban-verifier/CHECKSUMS.sha256
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

VENDOR_DIR="contracts/vendor/ultrahonk-soroban-verifier"
SRC_DIR="${VENDOR_DIR}/src"
CHECKSUMS_FILE="${VENDOR_DIR}/CHECKSUMS.sha256"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "[!] vendored source dir not found: ${SRC_DIR}" >&2
  exit 1
fi

if [[ ! -f "${CHECKSUMS_FILE}" ]]; then
  echo "[!] checksum baseline not found: ${CHECKSUMS_FILE}" >&2
  exit 1
fi

ACTUAL_FILE="$(mktemp)"
trap 'rm -f "${ACTUAL_FILE}"' EXIT

find "${SRC_DIR}" -type f | LC_ALL=C sort | xargs sha256sum > "${ACTUAL_FILE}"

if diff -q "${CHECKSUMS_FILE}" "${ACTUAL_FILE}" >/dev/null 2>&1; then
  echo "[ok] vendored verifier tree (${SRC_DIR}) matches ${CHECKSUMS_FILE} -- no drift."
  exit 0
fi

echo "[!] VENDOR DRIFT DETECTED under ${SRC_DIR}" >&2
echo "[!] tree no longer matches ${CHECKSUMS_FILE}. Offending entries:" >&2
diff "${CHECKSUMS_FILE}" "${ACTUAL_FILE}" | grep -E '^[<>]' | while read -r marker _hash path; do
  case "${marker}" in
    "<") echo "    baseline has (missing/changed in tree): ${path}" >&2 ;;
    ">") echo "    tree has (unexpected/changed vs baseline): ${path}" >&2 ;;
  esac
done
echo "[!] If this vendor bump is deliberate and has been reviewed, regenerate the baseline:" >&2
echo "    find ${SRC_DIR} -type f | LC_ALL=C sort | xargs sha256sum > ${CHECKSUMS_FILE}" >&2
exit 1
