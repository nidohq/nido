import { describe, expect, it } from 'vitest';
import { NATIVE_SAC_ID } from '../network.js';
import { canTransfer, capText, capToken, ruleRecipient } from './reviewText.js';

const USDC = 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75';

describe('capText', () => {
  it.each([
    ['20000000', 17280, 'Up to 2 XLM per day'],
    ['25000000', 120960, 'Up to 2.5 XLM per week'],
    ['1', 518400, 'Up to 0.0000001 XLM per 30 days'],
    ['50000000', 1000, 'Up to 5 XLM per 1,000 ledgers'],
  ])('reads %s stroops / %i ledgers of the XLM contract as %j', (stroops, ledgers, text) => {
    expect(capText(stroops, ledgers, NATIVE_SAC_ID)).toBe(text);
  });

  // A cap meters its own token: another token's limit is not XLM, and its
  // decimals are not known here.
  it("names another token's limit in its smallest units, never as XLM", () => {
    const text = capText('20000000', 17280, USDC);
    expect(text).toBe('Up to 20000000 (smallest units) of token CCW67T…SJMI75 per day');
    expect(text).not.toContain('XLM');
  });

  it('names no unit for a cap with no token', () => {
    expect(capText('20000000', 17280, null)).toBe('Up to 20000000 (smallest units) per day');
  });
});

describe('capToken', () => {
  it("is the cap's token, else the rule's contract", () => {
    const scope = { type: 'contract', address: USDC } as const;
    expect(capToken({ scope, cap: { limit: '1', 'period-ledgers': 1 } })).toBe(USDC);
    expect(capToken({ scope, cap: { token: NATIVE_SAC_ID, limit: '1', 'period-ledgers': 1 } })).toBe(NATIVE_SAC_ID);
    expect(capToken({ scope: { type: 'self-admin' }, cap: { limit: '1', 'period-ledgers': 1 } })).toBeNull();
  });
});

describe('ruleRecipient', () => {
  const GAME = 'CCA7QAA6OD6LQJTU2MKN6EAS5I52QIFPAYMMQYSU7KHWTGT26AN6N2AL';
  it("is transfer's `to`, an address-eq on argument 1", () => {
    expect(ruleRecipient({ args: [{ index: 1, pred: { type: 'address-eq', address: GAME } }] })).toBe(GAME);
  });
  it('is null without one', () => {
    expect(ruleRecipient({})).toBeNull();
    expect(ruleRecipient({ args: [{ index: 0, pred: { type: 'address-eq', address: GAME } }] })).toBeNull();
    expect(ruleRecipient({ args: [{ index: 1, pred: { type: 'is-self' } }] })).toBeNull();
  });
});

describe('canTransfer', () => {
  it('is true when transfer, or any function, is allowed', () => {
    expect(canTransfer(['transfer'])).toBe(true);
    expect(canTransfer(['guess', 'transfer'])).toBe(true);
    expect(canTransfer(undefined)).toBe(true);
    expect(canTransfer(['guess'])).toBe(false);
    expect(canTransfer(['approve'])).toBe(false);
  });
});
