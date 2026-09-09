import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { canonicalJson, docHash, parsePolicyDoc } from './index.js';

// doc_hash parity against perch's frozen golden vectors (CANON v1), vendored
// at packages/perch/testdata (see packages/perch/VENDORED.md for provenance).
// Mirrors upstream's packages/perch-js/test/parity.test.ts: the hash a
// reviewer approves off-chain must match what the Rust compiler and on-chain
// state commit to, byte for byte.

const here = dirname(fileURLToPath(import.meta.url));
const td = (n: string) => resolve(here, '../../../perch/testdata', n);

describe('perch golden parity: ci-publish fixture', () => {
  const doc = parsePolicyDoc(JSON.parse(readFileSync(td('ci-publish.json'), 'utf8')));

  it('canonical JSON is byte-identical to the Rust canonical form', () => {
    const committed = readFileSync(td('ci-publish.canonical.json'), 'utf8').replace(/\n+$/, '');
    expect(canonicalJson(doc)).toBe(committed);
  });

  it('doc_hash matches the committed and pinned Rust hash', () => {
    expect(docHash(doc)).toBe(readFileSync(td('ci-publish.doc-hash'), 'utf8').trim());
    expect(docHash(doc)).toBe('27cb38ef07bd8e4f86f07bef4d9272c070c2d9f05063d4c1ad1d4769b1d74a98');
  });
});

describe('perch golden parity: ci-publish-delegated fixture', () => {
  const doc = parsePolicyDoc(JSON.parse(readFileSync(td('ci-publish-delegated.json'), 'utf8')));

  it('canonical JSON is byte-identical to the Rust canonical form', () => {
    const committed = readFileSync(td('ci-publish-delegated.canonical.json'), 'utf8').replace(
      /\n+$/,
      '',
    );
    expect(canonicalJson(doc)).toBe(committed);
  });

  it('doc_hash matches the committed and pinned Rust hash', () => {
    expect(docHash(doc)).toBe(readFileSync(td('ci-publish-delegated.doc-hash'), 'utf8').trim());
    expect(docHash(doc)).toBe('0e2f8e7c826d8252ce0bec1528a079e21ba6b628649762a7cae3fb823e6155ea');
  });
});
