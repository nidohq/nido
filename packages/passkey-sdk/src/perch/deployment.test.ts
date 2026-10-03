import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPerchManifest, TESTNET, type PerchManifest } from './deployment';

// The submodule's manifest is the source of truth; TESTNET is Nido's copy of
// it plus Nido's factory. A Perch redeploy (or a testnet reset) fails here
// until TESTNET follows.
const manifest = JSON.parse(
  readFileSync(new URL('../../../../vendor/perch/deployments/testnet.json', import.meta.url), 'utf8'),
) as PerchManifest;

describe('TESTNET', () => {
  it("is Perch's testnet manifest plus Nido's factory", () => {
    expect(fromPerchManifest(manifest, TESTNET.factory)).toEqual(TESTNET);
  });

  it('refuses a manifest missing a contract', () => {
    const partial = { ...manifest, contracts: { ...manifest.contracts } };
    delete partial.contracts['perch-recovery'];
    expect(() => fromPerchManifest(partial, TESTNET.factory)).toThrow(/perch-recovery/);
  });
});
