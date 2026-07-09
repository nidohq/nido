//! Client-side depth-24 Poseidon2 Merkle tree, mirroring
//! `contracts/zk-recovery/src/merkle.rs`'s incremental frontier algorithm and
//! `circuits/zk_recovery/src/main.nr`'s `compute_root`. Interior nodes use
//! the raw (DOM-free) 2-to-1 hash `P2_2(a, b)` -- leaves are already
//! `DOM_BIND`-tagged (`authHash.ts::wrapLeafStored`), so they can't collide
//! with an interior node even though interior hashing itself carries no
//! domain tag.
//!
//! Bit convention (must match `merkle.rs::insert_leaf` and
//! `main.nr::compute_root` exactly): at level `i`, `bit = (index >> i) & 1`.
//! `bit === 0` means the running node is the LEFT child at this level (the
//! sibling is on the right); `bit === 1` means it is the RIGHT child (the
//! sibling is on the left).
import { p2 } from './poseidon.js';
import type { Fr } from './field.js';

/** Tree depth (spec §3.4: every account burns one leaf at creation, plus re-enrollments). */
export const DEPTH = 24;

/**
 * `ZEROS[0] = 0` (the empty-leaf value); `ZEROS[i+1] = P2_2(ZEROS[i],
 * ZEROS[i])`. Length `DEPTH + 1`; `ZEROS[DEPTH]` is the empty-tree root.
 * Matches `merkle.rs::zero_chain` byte-for-byte (gated by `merkle.test.ts`
 * against `tests/vectors/zk-recovery/vectors.json`'s
 * `circuit.path_siblings_zero_hash_chain`).
 */
export const ZEROS: Fr[] = (() => {
  const zeros: Fr[] = [0n];
  for (let i = 0; i < DEPTH; i++) {
    zeros.push(p2([zeros[i], zeros[i]]));
  }
  return zeros;
})();

/**
 * Recomputes a Merkle root from a `leaf` at `index` given its `siblings`
 * path (length `DEPTH`, one per level), using the bit convention documented
 * above. Matches `main.nr::compute_root` and the on-chain frontier's
 * per-level combine exactly.
 */
export function computeRoot(leaf: Fr, index: number, siblings: Fr[]): Fr {
  if (siblings.length !== DEPTH) {
    throw new Error(`computeRoot: expected ${DEPTH} siblings, got ${siblings.length}`);
  }
  let cur = leaf;
  for (let level = 0; level < DEPTH; level++) {
    const bit = (index >> level) & 1;
    const sib = siblings[level];
    cur = bit === 0 ? p2([cur, sib]) : p2([sib, cur]);
  }
  return cur;
}

/**
 * A client-side, in-memory depth-24 incremental Merkle tree. Holds every
 * inserted leaf and rebuilds the binary-tree layers on demand (`root()`,
 * `pathFor()`) rather than maintaining a storage-optimized frontier like the
 * on-chain contract does -- the SDK only ever needs to track the leaves
 * relevant to sync (`poolSync.ts`), not the full 2^24-leaf tree, so
 * simplicity is preferred over the contract's frontier optimization. Both
 * constructions compute the same standard Merkle root for a given leaf set
 * (proven for the single-leaf case in `merkle.test.ts` against the circuit
 * vector, and by cross-check against `computeRoot` for a small multi-leaf
 * tree).
 */
export class IncrementalTree {
  private leaves: Fr[] = [];

  /** Appends `leaf` at the next index, returning that index. */
  insert(leaf: Fr): number {
    const index = this.leaves.length;
    this.leaves.push(leaf);
    return index;
  }

  /** The current root, or `ZEROS[DEPTH]` (the empty-tree root) if no leaf has been inserted. */
  root(): Fr {
    if (this.leaves.length === 0) {
      return ZEROS[DEPTH];
    }
    const layers = this.buildLayers();
    return layers[DEPTH][0];
  }

  /**
   * The Merkle path for the leaf at `index`: `siblings` (length `DEPTH`,
   * defaulting to `ZEROS[level]` past the populated frontier) and `bits`
   * (`bits[level] = (index >> level) & 1`), consumable by `computeRoot`.
   */
  pathFor(index: number): { siblings: Fr[]; bits: number[] } {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`pathFor: index ${index} out of range (0..${this.leaves.length})`);
    }
    const layers = this.buildLayers();
    const siblings: Fr[] = [];
    const bits: number[] = [];
    let idx = index;
    for (let level = 0; level < DEPTH; level++) {
      const bit = idx & 1;
      bits.push(bit);
      const siblingIndex = bit === 0 ? idx + 1 : idx - 1;
      const layer = layers[level];
      siblings.push(layer[siblingIndex] ?? ZEROS[level]);
      idx = idx >> 1;
    }
    return { siblings, bits };
  }

  /**
   * Builds every layer from the current leaves up to (and including) the
   * root layer (`layers[DEPTH]`, length 1). Positions beyond the populated
   * portion of a layer are treated as `ZEROS[level]` (read via `?? ZEROS[level]`
   * rather than materialized), matching the zero-subtree convention
   * `merkle.rs`/`main.nr` use.
   */
  private buildLayers(): Fr[][] {
    const layers: Fr[][] = [this.leaves.slice()];
    let layer = layers[0];
    for (let level = 0; level < DEPTH; level++) {
      const width = Math.ceil(layer.length / 2);
      const next: Fr[] = new Array(width);
      for (let i = 0; i < width; i++) {
        const left = layer[2 * i] ?? ZEROS[level];
        const right = layer[2 * i + 1] ?? ZEROS[level];
        next[i] = p2([left, right]);
      }
      layers.push(next);
      layer = next;
    }
    return layers;
  }
}
