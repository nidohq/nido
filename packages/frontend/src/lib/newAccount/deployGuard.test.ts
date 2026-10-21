import { describe, it, expect } from 'vitest';
import { newAccountRefusal, setupAddressMismatch } from './deployGuard';

const A = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
const B = 'CDVVRZAVXTUQLS5LCGUP3H26RGOIUFKNE2UEJ6CAWYMBWY5LNORF6POX';

describe('setupAddressMismatch (setup-link substitution guard)', () => {
  it('allows setup when the salt-derived address equals the hostname account', () => {
    expect(setupAddressMismatch(A, A)).toBeNull();
  });

  it('refuses setup when the salt derives a DIFFERENT address than the hostname', () => {
    // The attack: hostname account A (attacker-owned) paired with a salt that
    // derives to B. Deploying/funding must be refused.
    const err = setupAddressMismatch(B, A);
    expect(err).not.toBeNull();
    expect(err).toContain('inconsistent');
  });

  it('refuses when the hostname has no account', () => {
    expect(setupAddressMismatch(A, null)).not.toBeNull();
  });

  it('refuses when the derived address could not be computed', () => {
    expect(setupAddressMismatch(null, A)).not.toBeNull();
  });
});

describe('newAccountRefusal', () => {
  it('offers a retry only for an account that has not shown up yet', () => {
    expect(newAccountRefusal('missing').retry).toBe(true);
    for (const problem of ['code', 'configured', 'infra', 'rules', 'verifier', 'key'] as const) {
      const refusal = newAccountRefusal(problem);
      expect(refusal.retry).toBe(false);
      expect(refusal.message).toContain('Nothing was moved into it');
      expect(refusal.message).toContain('new address');
    }
  });

  it('says another passkey controls a claimed address', () => {
    expect(newAccountRefusal('key').message).toContain('passkey this setup did not create');
  });
});
