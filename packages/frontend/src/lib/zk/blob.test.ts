import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProofBlob } from './blob.js';

// Fixtures committed by the circuit build (Task 8 brief): a real proof +
// public_inputs pair for the zk_recovery circuit, produced by nargo/bb. These
// are the only artifacts this task can verify against without a browser —
// live in-browser proving is deferred to M4.
//
// NOTE: deliberately NOT `new URL('../relative', import.meta.url)` — under
// this project's jsdom vitest environment, Vite's static-asset transform
// rewrites that pattern to use `self.location` as the base, which isn't a
// `file:` URL in jsdom and throws. Resolving `import.meta.url` on its own
// first (a plain call, not the special two-arg form) sidesteps the rewrite.
const here = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(here, '../../../../../circuits/zk_recovery/target');
const publicInputsFixture = readFileSync(path.join(targetDir, 'public_inputs'));
const proofFixture = readFileSync(path.join(targetDir, 'proof'));

function splitPublicInputs(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length % 32 !== 0) {
    throw new Error(`public_inputs fixture length ${bytes.length} is not a multiple of 32`);
  }
  const pubs: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32) {
    pubs.push(bytes.subarray(offset, offset + 32));
  }
  return pubs;
}

describe('buildProofBlob', () => {
  it('matches the committed zk_recovery fixture (3 pubs + 6976B proof)', () => {
    expect(publicInputsFixture.length).toBe(96);
    expect(proofFixture.length).toBe(6976);

    const pubs = splitPublicInputs(publicInputsFixture);
    expect(pubs).toHaveLength(3);

    const blob = buildProofBlob(pubs, proofFixture);

    expect(blob.length).toBe(4 + 96 + 6976);
    expect(blob.length).toBe(7076);

    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    expect(view.getUint32(0, false)).toBe(3);

    expect(blob.slice(4, 100)).toEqual(new Uint8Array(publicInputsFixture));
    expect(blob.slice(100)).toEqual(new Uint8Array(proofFixture));
  });

  it('rejects a public input that is not exactly 32 bytes', () => {
    expect(() => buildProofBlob([new Uint8Array(31)], new Uint8Array(0))).toThrow();
  });

  it('produces an empty-pubs blob when there are no public inputs', () => {
    const proof = new Uint8Array([1, 2, 3]);
    const blob = buildProofBlob([], proof);
    expect(blob.length).toBe(4 + 3);
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    expect(view.getUint32(0, false)).toBe(0);
    expect(blob.slice(4)).toEqual(proof);
  });
});
