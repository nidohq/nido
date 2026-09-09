import { describe, it, expect } from 'vitest';
import { derivePerchContractId, perchTestnetAddresses, PERCH_STATELESS_REGISTRY_TESTNET, PERCH_WASM_HASHES, TESTNET_PASSPHRASE } from './deployment.js';

// The canonical addresses these pins must derive to, mirrored from perch's
// CI-guarded crates/integration-tests/tests/testnet_pins.rs. If this test
// fails after re-pinning PERCH_WASM_HASHES, update these to the new canonical
// deployment (and DEPLOYED.md) in the same change.
const PINNED = {
  interpreter: 'CBYWKTO6IALDRI7LQM2IBHK7SDKXKO5JTMJCVQVKEI4XMJ724ZVJI2YM',
  docCompiler: 'CCUU7RYG23ZBZZCKS2PPSZ2GJIBTBYXF47GZCYG5PUBN54Z7AKQBF2SY',
  ed25519Verifier: 'CBVCTXCSF4HJJCQLLIM543CH5MJW3A2MMZ2T35GSCSN6QSC6BGSDJNNY',
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
