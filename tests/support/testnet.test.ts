import { describe, it, expect } from 'vitest';
import { uniqueName, withRetry } from './testnet';

describe('uniqueName', () => {
  it('matches the registry name rule [a-z][a-z0-9]* and is <=15 chars', () => {
    const n = uniqueName('t', 1717200000000);
    expect(n).toMatch(/^[a-z][a-z0-9]*$/);
    expect(n.length).toBeLessThanOrEqual(15);
  });
  it('is distinct for distinct timestamps', () => {
    expect(uniqueName('t', 1)).not.toBe(uniqueName('t', 2));
  });
});

describe('withRetry', () => {
  it('retries until success and returns the value', async () => {
    let n = 0;
    const v = await withRetry(async () => { if (++n < 3) throw new Error('x'); return 'ok'; }, { tries: 5, baseMs: 1 });
    expect(v).toBe('ok');
    expect(n).toBe(3);
  });
  it('throws the last error after exhausting tries', async () => {
    await expect(withRetry(async () => { throw new Error('boom'); }, { tries: 2, baseMs: 1 }))
      .rejects.toThrow('boom');
  });
});
