import { describe, it, expect } from 'vitest';
import { credentialFor } from './seed';

const SEED = '07'.repeat(32);

describe('credentialFor', () => {
  it('returns a base64url credentialId + 130-hex-char uncompressed pubkey, stable per label', async () => {
    const a = await credentialFor(SEED, 'originator');
    const b = await credentialFor(SEED, 'originator');
    expect(a).toEqual(b);
    expect(a.credentialIdB64u).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.publicKeyHex).toMatch(/^04[0-9a-f]{128}$/);
    expect((await credentialFor(SEED, 'friend-a')).publicKeyHex).not.toBe(a.publicKeyHex);
  });
});
