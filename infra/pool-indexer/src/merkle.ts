//! Minimal depth-24 Poseidon2 Merkle root rebuild, mirroring
//! `contracts/zk-recovery/src/merkle.rs` (interior hashing) and
//! `circuits/zk_recovery/src/main.nr` (membership check) exactly -- this is
//! the ONLY thing that makes the indexer's published `/snapshot.root`
//! trustworthy as a *convenience*: clients independently recompute the same
//! root from the raw leaves themselves and compare it to the contract's
//! on-chain `current_root`/`is_known_root` (the actual authority). If this
//! file ever drifts from the contract, the indexer's root simply stops being
//! useful -- it can never let a bad root be accepted, because nothing here
//! is trusted.
//!
//! Uses the SAME Poseidon2 library the SDK/circuit are proven against
//! (`@zkpassport/poseidon2`, arity-generic over its input array length) so
//! the published root matches on-chain byte-for-byte. Domain constants +
//! field order per `docs/superpowers/plans/2026-07-03-zk-recovery-m3-sdk-prover-infra.md`
//! `## Global Constraints`.
import { poseidon2Hash } from "@zkpassport/poseidon2";

/** A canonical BN254 scalar-field element: `0 <= x < FIELD_ORDER`. */
export type Fr = bigint;

/**
 * BN254 scalar field order `r`, byte-identical to
 * `contracts/zk-recovery/src/pool.rs:57-60`'s `FIELD_ORDER_BE` /
 * `packages/passkey-sdk/src/zkRecovery/field.ts`'s `FIELD_ORDER`.
 */
export const FIELD_ORDER: Fr =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

/** Merkle depth (spec: 16.7M leaves), identical to `merkle.rs::DEPTH`. */
export const DEPTH = 24;

function reduceMod(x: Fr): Fr {
  const m = x % FIELD_ORDER;
  return m < 0n ? m + FIELD_ORDER : m;
}

/**
 * Raw (DOM-free) 2-to-1 interior hash, `P2_2(a, b)` -- exactly
 * `merkle.rs::hash2` / circuit `main.nr::hash2`. Leaves fed into this tree
 * are already `DOM_BIND`-tagged `stored` values (the on-chain `LeafInserted`
 * event payload), so they can't collide with an interior node even though
 * interior hashing itself carries no domain tag.
 */
function p2raw(a: Fr, b: Fr): Fr {
  return poseidon2Hash([reduceMod(a), reduceMod(b)]);
}

/**
 * `zero[0] = 0`; `zero[i+1] = P2_2(zero[i], zero[i])`, length `depth + 1`.
 * `zero[depth]` is the empty-tree root. Matches
 * `merkle.rs::zero_chain`/`vectors.json.circuit.path_siblings_zero_hash_chain`.
 */
export function computeZeros(depth: number = DEPTH): Fr[] {
  const zeros: Fr[] = [0n];
  for (let i = 0; i < depth; i++) {
    zeros.push(p2raw(zeros[i], zeros[i]));
  }
  return zeros;
}

/** Precomputed zero-hash chain at the production depth (length `DEPTH + 1`). */
export const ZEROS: Fr[] = computeZeros(DEPTH);

/**
 * Rebuilds the depth-24 incremental-Merkle root from a contiguous,
 * 0-indexed leaf array (already `DOM_BIND`-wrapped `stored` values from
 * `LeafInserted` events -- fed directly in, NOT re-wrapped). Mirrors
 * `merkle.rs::insert_leaf`'s frontier algorithm bit-for-bit: leaf `idx`'s
 * bit `level` selects whether it becomes the left sibling (bit 0, paired
 * with `zero[level]` for now) or is combined with the frontier's saved left
 * sibling (bit 1). An empty `leaves` array is the empty-tree root
 * (`zero[depth]`).
 */
export function rebuildRoot(leaves: Fr[], depth: number = DEPTH): Fr {
  const zeros = depth === DEPTH ? ZEROS : computeZeros(depth);
  if (leaves.length === 0) return zeros[depth];

  const frontier: Fr[] = new Array(depth).fill(0n);
  let root = zeros[depth];
  for (let idx = 0; idx < leaves.length; idx++) {
    let cur = reduceMod(leaves[idx]);
    for (let level = 0; level < depth; level++) {
      const bit = (idx >> level) & 1;
      if (bit === 0) {
        frontier[level] = cur;
        cur = p2raw(cur, zeros[level]);
      } else {
        cur = p2raw(frontier[level], cur);
      }
    }
    root = cur;
  }
  return root;
}

/** Parses a `0x`-prefixed 32-byte hex string into a canonical `Fr`. Throws (rather than
 * silently reducing) on a value `>= FIELD_ORDER`, matching the contract's
 * `require_canonical` -- a non-canonical leaf can never be a real Poseidon2
 * output, so it indicates a corrupt event/store entry. */
export function hexToFr(hex: string): Fr {
  const s = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(s)) {
    throw new Error(`hexToFr: expected a 0x-prefixed 32-byte hex string, got ${JSON.stringify(hex)}`);
  }
  const value = BigInt(`0x${s}`);
  if (value >= FIELD_ORDER) {
    throw new Error(`hexToFr: value >= field order (non-canonical): ${hex}`);
  }
  return value;
}

/** BE 32-byte hex encoding of a canonical `Fr`, `0x` + 64 lowercase hex digits. */
export function frToHex(x: Fr): string {
  if (x < 0n || x >= FIELD_ORDER) {
    throw new Error(`frToHex: value out of canonical range: ${x}`);
  }
  return `0x${x.toString(16).padStart(64, "0")}`;
}
