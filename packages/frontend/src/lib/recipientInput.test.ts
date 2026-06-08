import { describe, it, expect, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import { normalizeRecipientInput, resolveSendRecipient } from './recipientInput.js';

// A valid testnet contract + ed25519 strkey for passthrough assertions.
const C = StrKey.encodeContract(Buffer.alloc(32, 0xbb));
const G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0xcd));

describe('normalizeRecipientInput', () => {
  it('strips a trailing .nido suffix to the bare label', () => {
    expect(normalizeRecipientInput('alice.nido')).toBe('alice');
  });
  it('strips a trailing .nido.fyi suffix', () => {
    expect(normalizeRecipientInput('alice.nido.fyi')).toBe('alice');
  });
  it('strips a trailing .localhost suffix (dev)', () => {
    expect(normalizeRecipientInput('alice.localhost')).toBe('alice');
  });
  it('lowercases when stripping a suffix', () => {
    expect(normalizeRecipientInput('ALICE.NIDO')).toBe('alice');
  });
  it('passes a bare label through unchanged (trimmed)', () => {
    expect(normalizeRecipientInput('  alice  ')).toBe('alice');
  });
  it('passes a C-address through unchanged (case preserved)', () => {
    expect(normalizeRecipientInput(C)).toBe(C);
  });
  it('passes a G-address through unchanged', () => {
    expect(normalizeRecipientInput(G)).toBe(G);
  });
  it('leaves an unknown dotted string alone', () => {
    expect(normalizeRecipientInput('alice.example')).toBe('alice.example');
  });
  it('normalizes a suffix-only input to empty string', () => {
    expect(normalizeRecipientInput('.nido')).toBe('');
  });
});

describe('resolveSendRecipient', () => {
  it("resolves a name (after suffix strip) via resolveName", async () => {
    const resolveName = vi.fn().mockResolvedValue(C);
    const res = await resolveSendRecipient('alice.nido', { resolveName });
    expect(resolveName).toHaveBeenCalledWith('alice');
    expect(res).toEqual({ kind: 'name', address: C, input: 'alice' });
  });
  it('returns null for an unregistered name', async () => {
    const resolveName = vi.fn().mockResolvedValue(null);
    expect(await resolveSendRecipient('ghost', { resolveName })).toBeNull();
  });
  it('returns a contract without calling resolveName', async () => {
    const resolveName = vi.fn();
    const res = await resolveSendRecipient(C, { resolveName });
    expect(resolveName).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'contract', address: C, input: C });
  });
  it('returns a G-address account without calling resolveName', async () => {
    const resolveName = vi.fn();
    const res = await resolveSendRecipient(G, { resolveName });
    expect(resolveName).not.toHaveBeenCalled();
    expect(res).toEqual({ kind: 'account', address: G, input: G });
  });
  it('returns null for garbage input', async () => {
    const resolveName = vi.fn();
    expect(await resolveSendRecipient('!!!', { resolveName })).toBeNull();
  });
});
