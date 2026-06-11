import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import { identifyAssertionSigner } from './assertionMatch.js';
import { buildSyntheticAssertion } from './syntheticAssertion.js';
import type { PasskeySignature } from './types.js';

async function assertionFor(priv: Uint8Array, payloadFill: number): Promise<PasskeySignature> {
  const a = await buildSyntheticAssertion(priv, new Uint8Array(32).fill(payloadFill));
  return {
    authenticatorData: a.authenticatorData,
    clientDataJson: a.clientDataJSON,
    signature: a.signature,
  };
}

describe('identifyAssertionSigner', () => {
  it('finds the candidate key that produced the assertion', async () => {
    const privs = [
      p256.utils.randomSecretKey(),
      p256.utils.randomSecretKey(),
      p256.utils.randomSecretKey(),
    ];
    const pubs = privs.map((d) => p256.getPublicKey(d, false));

    const sig = await assertionFor(privs[1], 0x3a);
    expect(await identifyAssertionSigner(sig, pubs)).toBe(1);
  });

  it('returns null when no candidate matches', async () => {
    const signer = p256.utils.randomSecretKey();
    const others = [p256.utils.randomSecretKey(), p256.utils.randomSecretKey()].map(
      (d) => p256.getPublicKey(d, false),
    );
    const sig = await assertionFor(signer, 0x5c);
    expect(await identifyAssertionSigner(sig, others)).toBe(null);
  });

  it('tolerates malformed candidate keys without throwing', async () => {
    const priv = p256.utils.randomSecretKey();
    const pub = p256.getPublicKey(priv, false);
    const sig = await assertionFor(priv, 0x11);
    const garbage = new Uint8Array(65); // all zeros — not a curve point
    expect(await identifyAssertionSigner(sig, [garbage, pub])).toBe(1);
  });
});
