import { describe, it, expect } from 'vitest';
import { generateSessionKey } from './sessionKey.js';

describe('generateSessionKey', () => {
  it('returns a 65-byte SEC1 uncompressed public key', async () => {
    const out = await generateSessionKey();
    expect(out.publicKey).toBeInstanceOf(Uint8Array);
    expect(out.publicKey.byteLength).toBe(65);
    expect(out.publicKey[0]).toBe(0x04); // SEC1 uncompressed prefix
    expect(out.privateKey).toBeInstanceOf(Uint8Array);
    expect(out.privateKey.byteLength).toBe(32);
    expect(typeof out.credentialId).toBe('string');
    expect(out.credentialId.length).toBeGreaterThan(0);
  });

  it('produces distinct keys on each call', async () => {
    const a = await generateSessionKey();
    const b = await generateSessionKey();
    expect(a.publicKey).not.toEqual(b.publicKey);
  });
});
