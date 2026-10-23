import { describe, expect, it } from 'vitest';
import { canTransfer, capText, ruleRecipient } from './reviewText.js';

describe('capText', () => {
  it.each([
    ['20000000', 17280, 'Up to 2 XLM per day'],
    ['25000000', 120960, 'Up to 2.5 XLM per week'],
    ['1', 518400, 'Up to 0.0000001 XLM per 30 days'],
    ['50000000', 1000, 'Up to 5 XLM per 1,000 ledgers'],
  ])('reads %s stroops / %i ledgers as %j', (stroops, ledgers, text) => {
    expect(capText(stroops, ledgers)).toBe(text);
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
