import { describe, it, expect } from 'vitest';
import { withMinimumDuration } from './withMinimumDuration.js';

describe('withMinimumDuration', () => {
  it('does not resolve before the minimum-duration timer settles', async () => {
    let releaseSleep!: () => void;
    const sleep = () => new Promise<void>((r) => { releaseSleep = r; });
    let resolved: string | null = null;
    const p = withMinimumDuration(Promise.resolve('addr'), 2500, sleep)
      .then((v) => { resolved = v; return v; });

    // Let work's microtask flush; the (unresolved) sleep must still hold us.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(null);

    releaseSleep();
    await p;
    expect(resolved).toBe('addr');
  });

  it('waits for work even after the timer settles', async () => {
    let settleWork!: (v: string) => void;
    const work = new Promise<string>((r) => { settleWork = r; });
    let resolved: string | null = null;
    const p = withMinimumDuration(work, 0, () => Promise.resolve())
      .then((v) => { resolved = v; return v; });

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(null); // timer done, work not

    settleWork('late');
    await p;
    expect(resolved).toBe('late');
  });

  it('propagates rejection from work', async () => {
    await expect(
      withMinimumDuration(Promise.reject(new Error('boom')), 0, () => Promise.resolve()),
    ).rejects.toThrow('boom');
  });
});
