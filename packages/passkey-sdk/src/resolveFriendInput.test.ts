import { describe, it, expect, vi } from 'vitest';
import { resolveFriendInput } from './resolveFriendInput.js';

// Valid strkey-encoded contract address (generated via StrKey.encodeContract)
const ALICE_CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

const fakeResolve = vi.fn(async (name: string) =>
  name === 'alice' ? ALICE_CONTRACT : null,
);

// Valid strkey-encoded addresses (not synthetic — pass StrKey checksum validation)
// CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW = StrKey.encodeContract(new Uint8Array(32).fill(0xab))
const VALID_CONTRACT = 'CCV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XK5LVOV2XMCW';
// GDG43TONZXG43TONZXG43TONZXG43TONZXG43TONZXG43TONZXG43AQY = StrKey.encodeEd25519PublicKey(new Uint8Array(32).fill(0xcd))
const VALID_ACCOUNT = 'GDG43TONZXG43TONZXG43TONZXG43TONZXG43TONZXG43TONZXG43AQY';

describe('resolveFriendInput', () => {
  it('accepts a g2c name and resolves via the registry', async () => {
    const r = await resolveFriendInput('alice', { resolveName: fakeResolve });
    expect(r).toEqual({
      kind: 'name',
      address: ALICE_CONTRACT,
      input: 'alice',
    });
  });

  it('accepts a C-address verbatim', async () => {
    const r = await resolveFriendInput(VALID_CONTRACT, { resolveName: fakeResolve });
    expect(r).toEqual({ kind: 'contract', address: VALID_CONTRACT, input: VALID_CONTRACT });
  });

  it('accepts a G-address verbatim', async () => {
    const r = await resolveFriendInput(VALID_ACCOUNT, { resolveName: fakeResolve });
    expect(r).toEqual({ kind: 'account', address: VALID_ACCOUNT, input: VALID_ACCOUNT });
  });

  it('returns null for unresolvable names', async () => {
    const r = await resolveFriendInput('nobody', { resolveName: fakeResolve });
    expect(r).toBeNull();
  });

  it('rejects nonsense input', async () => {
    const r = await resolveFriendInput('not-an-address!@#', { resolveName: fakeResolve });
    expect(r).toBeNull();
  });
});
