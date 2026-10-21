import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPerchManifest, TESTNET, type PerchManifest } from './deployment';

// The submodule's manifest is the source of truth; TESTNET is Nido's copy of
// it plus Nido's factory. A Perch redeploy (or a testnet reset) fails here
// until TESTNET follows.
const manifest = JSON.parse(
  readFileSync(new URL('../../../../vendor/perch/deployments/testnet.json', import.meta.url), 'utf8'),
) as PerchManifest;

// What `scripts/deploy-factory.sh` read back from the factory it deployed.
// `scripts/check-factory.sh` checks it against the chain.
const factory = JSON.parse(readFileSync(new URL('./factory.testnet.json', import.meta.url), 'utf8')) as {
  network_passphrase: string;
  factory: string;
  account_wasm_hash: string;
  pinned_verifier: string;
};

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

describe("Nido's testnet factory", () => {
  it('is the recorded factory', () => {
    expect(TESTNET.factory).toBe(factory.factory);
    expect(factory.network_passphrase).toBe(manifest.network_passphrase);
  });

  // A re-pin moves the manifest's account and verifier; this fails until the
  // factory is redeployed around them (`just deploy-factory`) and its record
  // committed with the re-pin.
  it("deploys the manifest's account and pins its verifier", () => {
    expect(factory.account_wasm_hash).toBe(manifest.contracts['perch-account']?.sha256);
    expect(factory.pinned_verifier).toBe(manifest.contracts['perch-webauthn-verifier']?.address);
  });
});
