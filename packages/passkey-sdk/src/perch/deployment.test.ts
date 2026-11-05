import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPerchManifest, MAINNET, TESTNET, type PerchManifest } from './deployment';

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

describe('a manifest that records perch/verifiers', () => {
  // The registry's copy of a verifier is no admin verifier (Perch M7): the
  // factory pins, and documents name, its instance in perch/verifiers.
  const withVerifiers: PerchManifest = {
    ...manifest,
    verifiers: {
      id: 'CDQG7KTWPERJ37HRQQCTMPTTQ3EO7OUUCRZBD5W7TMWS6ETPE7GZK4WO',
      contracts: {
        'perch-webauthn-verifier': {
          address: 'CA4Q6TWJLLMLHRDQ4ADAVNWKDDDZZXACZPXD4OHPT7VPPTU7HBTZVJQ3',
          name: 'perch-webauthn-verifier@0.1.2',
        },
      },
    },
  };

  it('takes the WebAuthn verifier, and its name, from perch/verifiers', () => {
    const d = fromPerchManifest(withVerifiers, TESTNET.factory);
    expect(d.webauthnVerifier).toBe('CA4Q6TWJLLMLHRDQ4ADAVNWKDDDZZXACZPXD4OHPT7VPPTU7HBTZVJQ3');
    expect(d.webauthnVerifierName).toBe('perch-webauthn-verifier@0.1.2');
  });

  it('keeps the registry copy and no name for a manifest without it', () => {
    const d = fromPerchManifest(manifest, TESTNET.factory);
    expect(d.webauthnVerifier).toBe(manifest.contracts['perch-webauthn-verifier']!.address);
    expect(d.webauthnVerifierName).toBeUndefined();
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

const mainnetManifest = JSON.parse(
  readFileSync(new URL('../../../../vendor/perch/deployments/mainnet.json', import.meta.url), 'utf8'),
) as PerchManifest;

const mainnetFactory = JSON.parse(
  readFileSync(new URL('./factory.mainnet.json', import.meta.url), 'utf8'),
) as {
  network_passphrase: string;
  factory: string;
  account_wasm_hash: string;
  pinned_verifier: string;
};

describe('MAINNET', () => {
  it("is Perch's mainnet manifest plus Nido's factory", () => {
    expect(fromPerchManifest(mainnetManifest, MAINNET.factory)).toEqual(MAINNET);
  });
});

describe("Nido's mainnet factory", () => {
  it('is the recorded factory', () => {
    expect(MAINNET.factory).toBe(mainnetFactory.factory);
    expect(mainnetFactory.network_passphrase).toBe(mainnetManifest.network_passphrase);
  });

  it("deploys the manifest's account and pins its verifier", () => {
    expect(mainnetFactory.account_wasm_hash).toBe(mainnetManifest.contracts['perch-account']?.sha256);
    expect(mainnetFactory.pinned_verifier).toBe(mainnetManifest.contracts['perch-webauthn-verifier']?.address);
  });
});
