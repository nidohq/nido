import { describe, it, expect } from 'vitest';
import { buildSyntheticAssertion } from './syntheticAssertion.js';
import { generateSessionKey } from './sessionKey.js';

describe('buildSyntheticAssertion', () => {
  it('produces a 64-byte normalized signature over the spec digest', async () => {
    const key = await generateSessionKey();
    const payload = new Uint8Array(32);
    payload.fill(0xCD);
    const a = await buildSyntheticAssertion(key.privateKey, payload);
    expect(a.signature.byteLength).toBe(64);
    expect(a.authenticatorData.byteLength).toBe(37);
    expect(a.clientDataJSON).toBeInstanceOf(Uint8Array);
  });

  it('is deterministic for the same key + payload (RFC 6979)', async () => {
    const key = await generateSessionKey();
    const payload = new Uint8Array(32);
    payload.fill(0xAB);
    const a = await buildSyntheticAssertion(key.privateKey, payload);
    const b = await buildSyntheticAssertion(key.privateKey, payload);
    expect(Array.from(a.signature)).toEqual(Array.from(b.signature));
    expect(Array.from(a.clientDataJSON)).toEqual(Array.from(b.clientDataJSON));
  });

  it('rejects non-32-byte payloads', async () => {
    const key = await generateSessionKey();
    await expect(buildSyntheticAssertion(key.privateKey, new Uint8Array(31)))
      .rejects.toThrow(/32 bytes/);
  });
});
