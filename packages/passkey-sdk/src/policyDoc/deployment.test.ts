import { describe, it, expect } from 'vitest';
import { derivePerchContractId, perchTestnetAddresses, PERCH_STATELESS_REGISTRY_TESTNET, PERCH_WASM_HASHES, TESTNET_PASSPHRASE } from './deployment.js';

// The canonical addresses these pins must derive to — the interpreter is
// still the 0.2.1-generation instance; the doc-compiler is the 0.3.0
// generation (perch-doc-compiler wasm hash bumped for recovery-schema
// support). If this test fails after re-pinning PERCH_WASM_HASHES, update
// these to the new canonical deployment (and DEPLOYED.md) in the same
// change.
const PINNED = {
  interpreter: 'CDR2OTZIZYTAHEHHH5MBOL6RKLWKIEN5KLPIVOG7FVBVTFET552NTWL2',
  docCompiler: 'CAUAFGIAAN6KE4WPMKPVDMWYBG6PWS5EBG5P63ZWVOP4D57ELA6T46M6',
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
