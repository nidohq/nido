import { describe, expect, it } from 'vitest';
import { defaultRuleSinglePasskeyBlockReason } from './defaultRuleSigning.js';

const signer = { kind: 'external' as const, verifier: 'C'.repeat(56), publicKey: new Uint8Array(65) };

describe('defaultRuleSinglePasskeyBlockReason', () => {
  it('allows a single signer with no policies', () => {
    expect(defaultRuleSinglePasskeyBlockReason({ signers: [signer], policies: [] })).toBeNull();
  });

  it('allows multiple signers when a policy is installed', () => {
    expect(
      defaultRuleSinglePasskeyBlockReason({
        signers: [signer, signer],
        policies: ['C'.repeat(56)],
      }),
    ).toBeNull();
  });

  it('blocks multiple signers with no policy', () => {
    expect(
      defaultRuleSinglePasskeyBlockReason({ signers: [signer, signer], policies: [] }),
    ).toMatch(/1-of-N threshold policy/);
  });
});
