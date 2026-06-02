import { describe, it, expect } from 'vitest';
import {
  credentialIdForLabel,
  privateKeyForCredentialId,
  publicKeyFromPrivate,
} from './vault';

const SEED = new Uint8Array(32).fill(7);

describe('vault', () => {
  it('derives a stable 32-byte credentialId per label', async () => {
    const a = await credentialIdForLabel(SEED, 'originator');
    const b = await credentialIdForLabel(SEED, 'originator');
    const c = await credentialIdForLabel(SEED, 'friend-a');
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
    expect(a).not.toEqual(c);
  });

  it('derives a valid, stable private key per credentialId', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const d1 = await privateKeyForCredentialId(SEED, id);
    const d2 = await privateKeyForCredentialId(SEED, id);
    expect(d1).toEqual(d2);
    expect(d1.length).toBe(32);
  });

  it('produces a 65-byte uncompressed public key (0x04 prefix)', async () => {
    const id = await credentialIdForLabel(SEED, 'originator');
    const d = await privateKeyForCredentialId(SEED, id);
    const pub = publicKeyFromPrivate(d);
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
  });
});
