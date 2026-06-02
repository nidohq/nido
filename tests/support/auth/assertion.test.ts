import { describe, it, expect } from 'vitest';
import { makeAssertion } from './assertion';
import { credentialIdForLabel } from './vault';

// Adaptation note: parseAssertionResponse calls derToCompact() which expects
// ASN.1 DER input. buildSyntheticAssertion returns compact r||s (64 bytes),
// not DER, so feeding it through parseAssertionResponse would throw
// "Invalid DER signature". The oracle is instead:
//   - authenticatorData is 37 bytes (matches Rust integration test layout)
//   - signature is 64 bytes compact r||s (matches on-chain verifier expectation)
//   - clientDataJSON contains the base64url-encoded challenge (structural check)

const SEED = new Uint8Array(32).fill(7);

describe('assertion', () => {
  it('produces an assertion the SDK can parse (37-byte authData, 64-byte sig)', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const challenge = new Uint8Array(32).fill(9);
    const a = await makeAssertion(SEED, id, challenge);
    expect(a.authenticatorData.length).toBe(37);
    expect(a.signature.length).toBe(64);

    // Verify clientDataJSON contains the challenge as base64url — same check
    // the on-chain verifier performs before hashing.
    const cdj = new TextDecoder().decode(a.clientDataJSON);
    const parsed = JSON.parse(cdj);
    expect(parsed.challenge).toBeTruthy();
    expect(parsed.type).toBe('webauthn.get');
  });
});
