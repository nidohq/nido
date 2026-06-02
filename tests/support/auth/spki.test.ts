import { describe, it, expect } from 'vitest';
import { buildSpki } from './spki';
import { extractPublicKey } from '../../../packages/passkey-sdk/src/webauthn';
import { publicKeyFromPrivate, privateKeyForCredentialId, credentialIdForLabel } from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('spki', () => {
  it('wraps a point so the SDK extractPublicKey returns it', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const pub = publicKeyFromPrivate(await privateKeyForCredentialId(SEED, id));
    const spki = buildSpki(pub);
    // The SDK's extractPublicKey consumes an object with getPublicKey().
    const got = extractPublicKey({
      getPublicKey: () => spki.buffer.slice(spki.byteOffset, spki.byteOffset + spki.byteLength),
      attestationObject: new ArrayBuffer(0),
    } as unknown as Parameters<typeof extractPublicKey>[0]);
    expect(Array.from(got)).toEqual(Array.from(pub));
  });
});
