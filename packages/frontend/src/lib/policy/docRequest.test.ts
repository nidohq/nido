import { describe, it, expect } from 'vitest';
import { parseDocDelegateParams } from './docRequest.js';

const TARGET = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const SIGNER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

function params(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    origin: 'https://dapp.example',
    target: TARGET,
    signer: SIGNER,
    functions: 'udpate_message',
    duration: '24h',
    label: 'status-note-session',
    return: 'https://dapp.example/page?x=1',
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...overrides })) {
    if (v !== null) p.set(k, v);
  }
  return p;
}

describe('parseDocDelegateParams', () => {
  it('parses a complete request', () => {
    const r = parseDocDelegateParams(params());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.req).toMatchObject({
      origin: 'https://dapp.example',
      target: TARGET,
      signer: SIGNER,
      functions: ['udpate_message'],
      duration: '24h',
      label: 'status-note-session',
      limitStroops: null,
    });
  });

  it('defaults duration to 30d and label to "session"', () => {
    const r = parseDocDelegateParams(params({ duration: 'bogus', label: null }));
    expect(r.ok && r.req.duration).toBe('30d');
    expect(r.ok && r.req.label).toBe('session');
  });

  it('treats absent functions as any-function', () => {
    const r = parseDocDelegateParams(params({ functions: null }));
    expect(r.ok && r.req.functions).toBeUndefined();
  });

  it('parses a decimal-XLM limit to stroops and tolerates a malformed one', () => {
    const good = parseDocDelegateParams(params({ limit: '2.5', limit_period: 'week' }));
    expect(good.ok && good.req.limitStroops).toBe('25000000');
    expect(good.ok && good.req.limitPeriod).toBe('week');
    const bad = parseDocDelegateParams(params({ limit: 'lots' }));
    expect(bad.ok && bad.req.limitStroops).toBeNull();
  });

  it.each([
    ['origin', 'Missing origin'],
    ['target', 'Invalid target'],
    ['signer', 'Invalid session signer'],
    ['return', 'Missing return'],
  ] as const)('rejects a missing/invalid %s', (key, msg) => {
    const r = parseDocDelegateParams(params({ [key]: key === 'origin' || key === 'return' ? null : 'nope' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(msg);
  });
});
