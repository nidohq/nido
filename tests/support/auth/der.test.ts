import { describe, it, expect } from 'vitest';
import { compactToDer } from './der';
import { derToCompact } from '../../../packages/passkey-sdk/src/signature';
import { makeAssertion } from './assertion';
import { credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('der', () => {
  it('compact→DER round-trips through the SDK derToCompact', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const a = await makeAssertion(SEED, id, new Uint8Array(32).fill(9));
    const der = compactToDer(a.signature);
    expect(der[0]).toBe(0x30); // SEQUENCE — what a real authenticator returns
    // a.signature is already low-S, so derToCompact recovers it byte-for-byte.
    expect(Array.from(derToCompact(der))).toEqual(Array.from(a.signature));
  });
});
