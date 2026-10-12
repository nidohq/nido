// `authDigestScheme` reads the account's `capabilities().auth_digest`, narrows
// it to the two dialects the wallet signs, and memoizes per account so a
// redeployed account (addr_oz_v1) and one minted before the redeploy
// (oz_rule_ids) each sign their own digest without a read per signature.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const capabilities = vi.fn();
vi.mock('@nidohq/perch-account', () => ({
  Client: class {
    capabilities = capabilities;
  },
}));
vi.mock('@nidohq/perch-doc-compiler', () => ({ Client: class {} }));

import { authDigestScheme } from './account.js';

const NET = 'Test SDF Network ; September 2015';
const args = (account: string) => ({ account, rpcUrl: 'https://rpc', networkPassphrase: NET });

describe('authDigestScheme', () => {
  // The mock is module-scoped; clear its call history (each test uses a distinct
  // account, so the per-account memo never collides across tests).
  beforeEach(() => capabilities.mockReset());

  it('returns oz_rule_ids for an account minted before the redeploy', async () => {
    capabilities.mockResolvedValueOnce({ result: { auth_digest: 'oz_rule_ids' } });
    await expect(authDigestScheme(args('ACC_OLD'))).resolves.toBe('oz_rule_ids');
  });

  it('returns addr_oz_v1 for a redeployed account', async () => {
    capabilities.mockResolvedValueOnce({ result: { auth_digest: 'addr_oz_v1' } });
    await expect(authDigestScheme(args('ACC_NEW'))).resolves.toBe('addr_oz_v1');
  });

  it('treats an unrecognized scheme as addr_oz_v1 (the current scheme)', async () => {
    capabilities.mockResolvedValueOnce({ result: { auth_digest: 'future_v9' } });
    await expect(authDigestScheme(args('ACC_FUTURE'))).resolves.toBe('addr_oz_v1');
  });

  it('memoizes per account (one read for repeated signatures)', async () => {
    capabilities.mockResolvedValueOnce({ result: { auth_digest: 'oz_rule_ids' } });
    const a = args('ACC_CACHED');
    const [first, second] = await Promise.all([authDigestScheme(a), authDigestScheme(a)]);
    expect(first).toBe('oz_rule_ids');
    expect(second).toBe('oz_rule_ids');
    await expect(authDigestScheme(a)).resolves.toBe('oz_rule_ids');
    // Three resolutions, one capabilities read for this account.
    expect(capabilities).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed read', async () => {
    capabilities.mockRejectedValueOnce(new Error('rpc down'));
    await expect(authDigestScheme(args('ACC_RETRY'))).rejects.toThrow(/rpc down/);
    capabilities.mockResolvedValueOnce({ result: { auth_digest: 'addr_oz_v1' } });
    await expect(authDigestScheme(args('ACC_RETRY'))).resolves.toBe('addr_oz_v1');
  });
});
