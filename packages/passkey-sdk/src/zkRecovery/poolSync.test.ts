import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fieldToBytes32 } from './field.js';
import { computeRoot, DEPTH } from './merkle.js';
import { wrapLeafInner, wrapLeafStored } from './authHash.js';
import {
  mergeLeaves,
  rebuildRoot,
  verifyAgainstOnChainRoot,
  locateLeaf,
  type Leaf,
} from './poolSync.js';

// Single-leaf circuit vector, same fixture `merkle.test.ts` gates against --
// the authoritative source for what a real `leaf` byte value + root looks
// like (`tests/vectors/zk-recovery/vectors.json::circuit`).
const vectorsPath = fileURLToPath(
  new URL('../../../../tests/vectors/zk-recovery/vectors.json', import.meta.url),
);
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));
const circuit = vectors.circuit as {
  secret: string;
  acct_hi: string;
  acct_lo: string;
  root: string;
};

function accountId32FromHiLo(hiHex: string, loHex: string): Uint8Array {
  const halfBytes = (x: bigint): Uint8Array => {
    const out = new Uint8Array(16);
    let v = x;
    for (let i = 15; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  };
  const out = new Uint8Array(32);
  out.set(halfBytes(BigInt(hiHex)), 0);
  out.set(halfBytes(BigInt(loHex)), 16);
  return out;
}

function leafBytes(secret: bigint, tag: number): Uint8Array {
  // Distinct, deterministic per-index leaves for merge/sort/dedup tests
  // (not circuit-vector-derived -- those tests only care about index
  // bookkeeping, not real Poseidon2 parity).
  const accountId32 = new Uint8Array(32).fill(tag);
  const inner = wrapLeafInner(secret);
  return fieldToBytes32(wrapLeafStored(accountId32, inner));
}

describe('mergeLeaves', () => {
  it('merges a contiguous set (already sorted)', () => {
    const leaves: Leaf[] = [
      { index: 0, leaf: leafBytes(1n, 0x01) },
      { index: 1, leaf: leafBytes(2n, 0x02) },
      { index: 2, leaf: leafBytes(3n, 0x03) },
    ];
    const merged = mergeLeaves([], leaves);
    expect(merged.map((l) => l.index)).toEqual([0, 1, 2]);
  });

  it('sorts reordered input by index', () => {
    const l0 = leafBytes(1n, 0x01);
    const l1 = leafBytes(2n, 0x02);
    const l2 = leafBytes(3n, 0x03);
    const merged = mergeLeaves(
      [],
      [
        { index: 2, leaf: l2 },
        { index: 0, leaf: l0 },
        { index: 1, leaf: l1 },
      ],
    );
    expect(merged.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(merged[0].leaf).toEqual(l0);
    expect(merged[1].leaf).toEqual(l1);
    expect(merged[2].leaf).toEqual(l2);
  });

  it('dedups an identical duplicate (same index + bytes) into a single entry', () => {
    const l0 = leafBytes(1n, 0x01);
    const l1 = leafBytes(2n, 0x02);
    const known: Leaf[] = [{ index: 0, leaf: l0 }];
    const incoming: Leaf[] = [
      { index: 0, leaf: l0.slice() }, // identical bytes, different array instance
      { index: 1, leaf: l1 },
    ];
    const merged = mergeLeaves(known, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.map((l) => l.index)).toEqual([0, 1]);
  });

  it('throws on conflicting bytes at the same index', () => {
    const known: Leaf[] = [{ index: 0, leaf: leafBytes(1n, 0x01) }];
    const incoming: Leaf[] = [{ index: 0, leaf: leafBytes(2n, 0x02) }];
    expect(() => mergeLeaves(known, incoming)).toThrow();
  });

  it('throws when the merged set is not contiguous from 0 (a gap)', () => {
    const leaves: Leaf[] = [
      { index: 0, leaf: leafBytes(1n, 0x01) },
      { index: 2, leaf: leafBytes(3n, 0x03) }, // missing index 1
    ];
    expect(() => mergeLeaves([], leaves)).toThrow();
  });

  it('throws when the leaf set does not start at 0', () => {
    const leaves: Leaf[] = [{ index: 1, leaf: leafBytes(1n, 0x01) }];
    expect(() => mergeLeaves([], leaves)).toThrow();
  });
});

describe('rebuildRoot', () => {
  it('equals vectors.circuit.root for the single-leaf vector', () => {
    const accountId32 = accountId32FromHiLo(circuit.acct_hi, circuit.acct_lo);
    const inner = wrapLeafInner(BigInt(circuit.secret));
    const leaf = fieldToBytes32(wrapLeafStored(accountId32, inner));
    const root = rebuildRoot([{ index: 0, leaf }]);
    expect(root).toBe(BigInt(circuit.root));
  });
});

describe('verifyAgainstOnChainRoot', () => {
  const accountId32 = accountId32FromHiLo(circuit.acct_hi, circuit.acct_lo);
  const inner = wrapLeafInner(BigInt(circuit.secret));
  const leaf = fieldToBytes32(wrapLeafStored(accountId32, inner));
  const leaves: Leaf[] = [{ index: 0, leaf }];

  it('returns true when the rebuilt root matches the on-chain root', () => {
    expect(verifyAgainstOnChainRoot(leaves, BigInt(circuit.root))).toBe(true);
  });

  it('returns false when the on-chain root does not match', () => {
    expect(verifyAgainstOnChainRoot(leaves, BigInt(circuit.root) + 1n)).toBe(false);
  });
});

describe('locateLeaf', () => {
  it('returns a witness whose computeRoot(leaf, index, siblings) equals rebuildRoot', () => {
    const leaves: Leaf[] = [
      { index: 0, leaf: leafBytes(1n, 0x01) },
      { index: 1, leaf: leafBytes(2n, 0x02) },
      { index: 2, leaf: leafBytes(3n, 0x03) },
    ];
    const target = leaves[1].leaf;
    const witness = locateLeaf(leaves, target);
    expect(witness).not.toBeNull();
    expect(witness!.index).toBe(1);
    expect(witness!.siblings).toHaveLength(DEPTH);

    const root = rebuildRoot(leaves);
    const leafFr = BigInt(
      '0x' + Buffer.from(target).toString('hex'),
    );
    expect(computeRoot(leafFr, witness!.index, witness!.siblings)).toBe(root);
  });

  it('returns null when the leaf is absent from the set', () => {
    const leaves: Leaf[] = [{ index: 0, leaf: leafBytes(1n, 0x01) }];
    const absent = leafBytes(99n, 0xff);
    expect(locateLeaf(leaves, absent)).toBeNull();
  });
});
