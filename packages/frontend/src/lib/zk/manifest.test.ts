import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { manifestCheck, MANIFEST } from './manifest.js';
import { verifyAndParseCircuit } from './prover.worker.js';

// See blob.test.ts for why `import.meta.url` is resolved as a plain call first, rather than the
// `new URL('../relative', import.meta.url)` form: under this project's jsdom vitest environment,
// Vite's static-asset transform rewrites the two-arg form to use `self.location` as the base,
// which isn't a `file:` URL in jsdom and throws.
const here = path.dirname(fileURLToPath(import.meta.url));
const circuitTargetDir = path.resolve(here, '../../../../../circuits/zk_recovery/target');
const circuitBytes = readFileSync(path.join(circuitTargetDir, 'zk_recovery.json'));

describe('manifestCheck', () => {
  it('passes silently when the fetched sha matches the expected sha', () => {
    expect(() => manifestCheck('abc123', 'abc123')).not.toThrow();
  });

  it('is case- and whitespace-insensitive', () => {
    expect(() => manifestCheck('  ABC123\n', 'abc123')).not.toThrow();
  });

  it('throws on a sha mismatch', () => {
    expect(() => manifestCheck('deadbeef', 'abc123')).toThrow(/zk manifest mismatch/);
  });
});

describe('verifyAndParseCircuit', () => {
  it('parses the real committed zk_recovery.json circuit when its sha matches the manifest', () => {
    // Sanity check that the fixture on disk is still the one MANIFEST.circuitSha256 pins — if this
    // fails, MANIFEST is stale relative to the committed circuit artifact, not a bug in the check.
    const circuit = verifyAndParseCircuit(new Uint8Array(circuitBytes)) as { bytecode: unknown };
    expect(typeof circuit.bytecode).toBe('string');
  });

  it('throws instead of parsing when the bytes have been tampered with (sha no longer matches)', () => {
    const tampered = new Uint8Array(circuitBytes);
    tampered[0] = tampered[0] ^ 0xff;
    expect(() => verifyAndParseCircuit(tampered)).toThrow(/zk manifest mismatch/);
  });

  it('throws instead of parsing a stale circuit (different content, same MANIFEST pin)', () => {
    const stale = new TextEncoder().encode(JSON.stringify({ bytecode: 'stale-old-build' }));
    expect(() => verifyAndParseCircuit(stale)).toThrow(/zk manifest mismatch/);
    expect(MANIFEST.circuitSha256).not.toBe('');
  });
});
