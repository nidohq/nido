import { describe, it, expect } from 'vitest';
import { derivePerchContractId, perchTestnetAddresses, PERCH_STATELESS_REGISTRY_TESTNET, PERCH_WASM_HASHES, TESTNET_PASSPHRASE } from './deployment.js';

// The canonical addresses these pins must derive to — the interpreter and
// doc compiler Perch's testnet deployment manifest records (their `address`
// fields in vendor/perch/deployments/testnet.json). If this test fails after
// re-pinning PERCH_WASM_HASHES, update these to the new canonical
// deployment (and DEPLOYED.md) in the same change.
const PINNED = {
  interpreter: 'CA5JLPEVA3E5X7YEDVABMEM3TML33ZS3I6WL5NDBFIZZAXFYNZPBBWTO',
  docCompiler: 'CCYSZHRHY7GKT2OYXF6JW332GA2BL6ZKPAWIV6RVC5JW2RNPHQPSW5ZI',
};

describe('perch canonical deployment', () => {
  it('derives the pinned testnet addresses from registry + wasm hashes', () => {
    expect(perchTestnetAddresses()).toEqual(PINNED);
  });

  it('derivation is network-specific', () => {
    expect(
      derivePerchContractId(
        'Public Global Stellar Network ; September 2015',
        PERCH_STATELESS_REGISTRY_TESTNET,
        PERCH_WASM_HASHES.interpreter,
      ),
    ).not.toBe(PINNED.interpreter);
    expect(
      derivePerchContractId(
        TESTNET_PASSPHRASE,
        PERCH_STATELESS_REGISTRY_TESTNET,
        PERCH_WASM_HASHES.interpreter,
      ),
    ).toBe(PINNED.interpreter);
  });

  it('rejects a malformed wasm hash', () => {
    expect(() =>
      derivePerchContractId(TESTNET_PASSPHRASE, PERCH_STATELESS_REGISTRY_TESTNET, 'abcd'),
    ).toThrow(/32 bytes/);
  });
});
