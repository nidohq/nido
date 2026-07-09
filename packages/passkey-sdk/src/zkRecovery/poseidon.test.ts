import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOM_LEAF, DOM_BIND, DOM_NULL, DOM_AUTH } from './field.js';
import { p2 } from './poseidon.js';

// Parity gate: the SDK's Poseidon2 must reproduce, byte-for-byte, the
// vectors generated from Noir's Poseidon2::hash (noir-lang/poseidon v0.2.0)
// -- the same construction the on-chain contract and circuit use. If any
// case here fails, every downstream ZK-recovery module built on top of
// `p2` is untrustworthy; do not paper over a mismatch.
const vectorsPath = fileURLToPath(
  new URL('../../../../tests/vectors/zk-recovery/vectors.json', import.meta.url),
);
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8'));

describe('domain constants match vectors.json', () => {
  it('DOM_LEAF/DOM_BIND/DOM_NULL/DOM_AUTH', () => {
    expect(DOM_LEAF).toBe(BigInt(vectors.domain_constants.DOM_LEAF));
    expect(DOM_BIND).toBe(BigInt(vectors.domain_constants.DOM_BIND));
    expect(DOM_NULL).toBe(BigInt(vectors.domain_constants.DOM_NULL));
    expect(DOM_AUTH).toBe(BigInt(vectors.domain_constants.DOM_AUTH));
  });
});

describe('p2 matches Poseidon2 parity vectors', () => {
  for (const vector of vectors.poseidon2 as Array<{
    name: string;
    inputs: string[];
    output: string;
  }>) {
    it(vector.name, () => {
      const inputs = vector.inputs.map((hex) => BigInt(hex));
      expect(p2(inputs)).toBe(BigInt(vector.output));
    });
  }
});
