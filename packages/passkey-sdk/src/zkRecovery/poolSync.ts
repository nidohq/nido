//! Trust-free client-side reconstruction of the pool's Merkle state from
//! whatever leaves an indexer (or any other untrusted source) hands back.
//! The indexer is convenience-only: it can omit, reorder, or duplicate
//! leaves, but `verifyAgainstOnChainRoot` (comparing the rebuilt root
//! against the contract's OWN on-chain root) is the only thing a caller may
//! actually trust before using a `locateLeaf` witness in a proof. A leaf
//! set that disagrees with itself (conflicting bytes at one index, or a gap
//! in the index sequence) is rejected outright -- there is no "best effort"
//! merge of self-inconsistent data.
import { bytesToFieldCanonical, type Fr } from './field.js';
import { IncrementalTree } from './merkle.js';

/**
 * One pool leaf: `index` is the contract's `LeafInserted` topic index;
 * `leaf` is the on-chain-wrapped `stored` value (`P2_4(DOM_BIND, acct_hi,
 * acct_lo, inner)`, i.e. the actual Merkle tree leaf) as raw 32-byte BE
 * bytes -- the SAME field name the on-chain event and the pool-indexer both
 * use (`infra/pool-indexer/src/scanner.ts::LeafEvent`), never `commitment`
 * (that name is reserved for the pre-wrap `inner` value the SDK submits at
 * enrollment; see `enrollment.ts`).
 */
export type Leaf = { index: number; leaf: Uint8Array };

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Merges `known` (already-trusted/previously-synced leaves) with `incoming`
 * (freshly fetched, untrusted leaves) into a single index-sorted array.
 * - Identical duplicates (same index, same bytes) collapse to one entry.
 * - Conflicting bytes at the same index THROW (the source disagrees with
 *   itself -- never silently pick a side).
 * - The merged set must be contiguous from index 0 (no gaps) or this
 *   THROWS -- a gap means the indexer hasn't caught up yet, and building a
 *   root from a partial/discontiguous set would silently desync every
 *   index past the gap.
 */
export function mergeLeaves(known: Leaf[], incoming: Leaf[]): Leaf[] {
  const byIndex = new Map<number, Uint8Array>();
  for (const { index, leaf } of [...known, ...incoming]) {
    const existing = byIndex.get(index);
    if (existing !== undefined) {
      if (!bytesEqual(existing, leaf)) {
        throw new Error(`mergeLeaves: conflicting leaf bytes at index ${index}`);
      }
      continue;
    }
    byIndex.set(index, leaf);
  }

  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      throw new Error(
        `mergeLeaves: non-contiguous leaf set -- expected index ${i}, got ${indices[i]} (gap or missing genesis leaf)`,
      );
    }
  }

  return indices.map((index) => ({ index, leaf: byIndex.get(index)! }));
}

/**
 * Rebuilds the Merkle root from `leaves` by feeding each leaf's already
 * `DOM_BIND`-wrapped bytes into a fresh `IncrementalTree`, in index order.
 * Validates the set the same way `mergeLeaves` does (dedup/conflict/gap)
 * before inserting -- there is no code path that computes a root from a
 * leaf set that hasn't passed that check.
 */
export function rebuildRoot(leaves: Leaf[]): Fr {
  const merged = mergeLeaves([], leaves);
  const tree = new IncrementalTree();
  for (const { leaf } of merged) {
    tree.insert(bytesToFieldCanonical(leaf));
  }
  return tree.root();
}

/**
 * The ONLY authority a caller may rely on: does the leaf set's rebuilt root
 * match the contract's own on-chain root? The indexer that produced
 * `leaves` is never trusted on its own -- this is the check that makes it
 * safe to use anyway.
 */
export function verifyAgainstOnChainRoot(leaves: Leaf[], onChainRoot: Fr): boolean {
  return rebuildRoot(leaves) === onChainRoot;
}

/**
 * Finds `myStoredLeaf` (the caller's own `DOM_BIND`-wrapped leaf bytes --
 * see `authHash.ts::wrapLeafStored`) within `leaves` and returns its
 * membership witness (`index`, `siblings`, `bits`), or `null` if absent.
 * The witness is produced by rebuilding the same tree `rebuildRoot` would
 * build (via `IncrementalTree.pathFor`), so `computeRoot(leaf, index,
 * siblings)` is guaranteed to equal `rebuildRoot(leaves)`.
 */
export function locateLeaf(
  leaves: Leaf[],
  myStoredLeaf: Uint8Array,
): { index: number; siblings: Fr[]; bits: number[] } | null {
  const merged = mergeLeaves([], leaves);
  const tree = new IncrementalTree();
  let foundIndex: number | null = null;
  for (const { leaf } of merged) {
    const insertedIndex = tree.insert(bytesToFieldCanonical(leaf));
    if (bytesEqual(leaf, myStoredLeaf)) {
      foundIndex = insertedIndex;
    }
  }
  if (foundIndex === null) {
    return null;
  }
  const { siblings, bits } = tree.pathFor(foundIndex);
  return { index: foundIndex, siblings, bits };
}
