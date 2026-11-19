import { describe, it, expect, vi } from 'vitest';
import { fundWallet, FundingStillConfirming, type FundWalletDeps, type FundingProgress, type TopUpStatus } from './fundWallet';

const DEST = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';

// A relayer + RPC where each /fund answers a fresh hash and a top-up's
// status (and the account's balance) is whatever the test says it is now.
function fakeNetwork() {
  const statuses = new Map<string, TopUpStatus | 'THROW'>();
  let balance = 0n;
  let next = 0;
  const deps = {
    requestFunding: vi.fn(async () => ({ hash: `tx${next++}`, status: 'PENDING', alreadyFunded: false })),
    topUpStatus: vi.fn(async (hash: string) => {
      const status = statuses.get(hash) ?? 'NOT_FOUND';
      if (status === 'THROW') throw new Error('RPC 503');
      return status;
    }),
    nativeBalance: vi.fn(async () => balance),
    sleep: vi.fn(async () => {}),
  } satisfies FundWalletDeps;
  return {
    deps,
    set: (hash: string, status: TopUpStatus | 'THROW') => statuses.set(hash, status),
    land(hash: string) {
      statuses.set(hash, 'SUCCESS');
      balance = 50_000_000n;
    },
    setBalance: (b: bigint) => (balance = b),
  };
}

describe('fundWallet (finalizing a new account)', () => {
  it('funds a fresh account once and waits for the top-up to land', async () => {
    const net = fakeNetwork();
    net.deps.topUpStatus.mockImplementationOnce(async () => 'NOT_FOUND');
    net.deps.topUpStatus.mockImplementationOnce(async () => {
      net.land('tx0');
      return 'SUCCESS';
    });

    expect(await fundWallet(DEST, { hash: null }, net.deps)).toBe('funded');
    expect(net.deps.requestFunding).toHaveBeenCalledTimes(1);
  });

  it('a retry after the confirmation poll gave up resumes the same top-up instead of asking for another', async () => {
    const net = fakeNetwork();
    const progress: FundingProgress = { hash: null };
    // The RPC errors on every read: the old step failed here and its retry
    // posted /fund again.
    net.set('tx0', 'THROW');
    await expect(fundWallet(DEST, progress, net.deps)).rejects.toBeInstanceOf(FundingStillConfirming);
    expect(progress.hash).toBe('tx0');

    // The top-up landed meanwhile; the retry only confirms it.
    net.land('tx0');
    expect(await fundWallet(DEST, progress, net.deps)).toBe('funded');
    expect(net.deps.requestFunding).toHaveBeenCalledTimes(1);
  });

  it('a retry while the top-up is still pending gets the same top-up back, not a second payment', async () => {
    const net = fakeNetwork();
    const progress: FundingProgress = { hash: null };
    await expect(fundWallet(DEST, progress, net.deps)).rejects.toBeInstanceOf(FundingStillConfirming);

    // The relayer's record still stands, so it hands back the same hash.
    net.deps.requestFunding.mockResolvedValueOnce({ hash: 'tx0', status: 'PENDING', alreadyFunded: true });
    await expect(fundWallet(DEST, progress, net.deps)).rejects.toBeInstanceOf(FundingStillConfirming);
    expect(progress.hash).toBe('tx0');
    expect(net.deps.requestFunding).toHaveBeenCalledTimes(2);

    net.land('tx0');
    expect(await fundWallet(DEST, progress, net.deps)).toBe('funded');
    expect(net.deps.requestFunding).toHaveBeenCalledTimes(2);
  });

  it('a retry after the pending top-up was dropped adopts the fresh one the relayer sends', async () => {
    const net = fakeNetwork();
    const progress: FundingProgress = { hash: null };
    await expect(fundWallet(DEST, progress, net.deps)).rejects.toBeInstanceOf(FundingStillConfirming);
    expect(progress.hash).toBe('tx0');

    // tx0's window closed without it landing: the relayer sends tx1.
    net.set('tx1', 'SUCCESS');
    expect(await fundWallet(DEST, progress, net.deps)).toBe('funded');
    expect(progress.hash).toBe('tx1');
    expect(net.deps.requestFunding).toHaveBeenCalledTimes(2);
  });

  it('a retry finishes on the relayer reporting the pending top-up landed, even when the client cannot read the chain', async () => {
    const net = fakeNetwork();
    const progress: FundingProgress = { hash: null };
    net.set('tx0', 'THROW');
    net.deps.nativeBalance.mockRejectedValue(new Error('RPC 503'));
    await expect(fundWallet(DEST, progress, net.deps)).rejects.toBeInstanceOf(FundingStillConfirming);

    net.deps.requestFunding.mockResolvedValueOnce({ hash: 'tx0', status: 'SUCCESS', alreadyFunded: true });
    expect(await fundWallet(DEST, progress, net.deps)).toBe('already-funded');
    expect(progress.hash).toBe('tx0');
  });

  it('does not ask for funding when the account already holds XLM', async () => {
    const net = fakeNetwork();
    net.setBalance(50_000_000n);

    expect(await fundWallet(DEST, { hash: null }, net.deps)).toBe('already-funded');
    expect(net.deps.requestFunding).not.toHaveBeenCalled();
  });

  it('accepts the relayer saying the account is already funded', async () => {
    const net = fakeNetwork();
    net.deps.requestFunding.mockResolvedValueOnce({ hash: null, status: 'FUNDED', alreadyFunded: true } as never);
    expect(await fundWallet(DEST, { hash: null }, net.deps)).toBe('already-funded');

    // ...or handing back the top-up it already sent, which it then waits on.
    net.deps.requestFunding.mockResolvedValueOnce({ hash: 'earlier', status: 'SUCCESS', alreadyFunded: true });
    net.set('earlier', 'SUCCESS');
    expect(await fundWallet(DEST, { hash: null }, net.deps)).toBe('already-funded');
  });

  it('asks again only after the earlier top-up failed on chain', async () => {
    const net = fakeNetwork();
    const progress: FundingProgress = { hash: null };
    net.set('tx0', 'FAILED');
    await expect(fundWallet(DEST, progress, net.deps)).rejects.toThrow('did not complete: FAILED');
    expect(progress.hash).toBeNull();

    net.set('tx1', 'SUCCESS');
    expect(await fundWallet(DEST, progress, net.deps)).toBe('funded');
    expect(net.deps.requestFunding).toHaveBeenCalledTimes(2);
  });
});
