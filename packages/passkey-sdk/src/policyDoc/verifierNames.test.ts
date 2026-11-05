import { describe, expect, it } from 'vitest';
import { buildPolicyDoc } from './build.js';
import { withVerifierNames } from './verifierNames.js';

const V = 'CDV5HBEG3UL2YUNYG4RD4J5CARTDVUPHJ7TAADQKIIIRNVHP4EEOAUIF';
const OTHER = 'CBHXTCLL7QRPKRMY7CUIRCMQAKKU3VC2SIFXL24RZTJSHQWXYQTHA22T';
const G = 'GAAWAHOT3SDRMH7EWZ7IYCQFXFBP7YIS6R3OZQPDVCMVX3LKOOVGJH2G';
const doc = buildPolicyDoc({
  network: 'Test SDF Network ; September 2015',
  signers: [
    { id: 'admin', kind: 'passkey', verifier: V, publicKey: '04' + 'ab'.repeat(64) },
    { id: 'other', kind: 'passkey', verifier: OTHER, publicKey: '04' + 'cd'.repeat(64) },
    { id: 'g', kind: 'delegated', address: G },
  ],
  permissions: [{ name: 'admin', on: 'self-admin', by: ['admin', 'other', 'g'] }],
});

describe('withVerifierNames', () => {
  it('names each signer of a mapped verifier, and only those', () => {
    const named = withVerifierNames(doc, { [V]: 'perch-webauthn-verifier@0.1.2' });
    expect(named.signers).toEqual([
      { ...doc.signers[0]!, 'verifier-name': 'perch-webauthn-verifier@0.1.2' },
      doc.signers[1],
      doc.signers[2],
    ]);
  });

  it('keeps a name already given, and returns the document itself when nothing changes', () => {
    const once = withVerifierNames(doc, { [V]: 'perch-webauthn-verifier@0.1.2' });
    expect(withVerifierNames(once, { [V]: 'other-name@1.0.0' })).toBe(once);
    expect(withVerifierNames(doc, {})).toBe(doc);
  });
});
