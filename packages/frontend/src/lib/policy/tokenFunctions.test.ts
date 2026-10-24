import { describe, expect, it } from 'vitest';
import { TOKEN_MOVING_FUNCTIONS, canMoveTokens } from './tokenFunctions.js';

describe('canMoveTokens', () => {
  it('is false only for a named list with no token-moving function', () => {
    expect(canMoveTokens(['guess'])).toBe(false);
    expect(canMoveTokens(['guess', 'reveal'])).toBe(false);
  });

  it.each(TOKEN_MOVING_FUNCTIONS.map((f) => [f]))('is true when %s is allowed', (f) => {
    expect(canMoveTokens(['guess', f])).toBe(true);
  });

  it('is true for a rule allowing any function', () => {
    expect(canMoveTokens(undefined)).toBe(true);
    expect(canMoveTokens(null)).toBe(true);
    expect(canMoveTokens([])).toBe(true);
  });
});

describe('TOKEN_MOVING_FUNCTIONS', () => {
  // Pinned to Perch's TOKEN_MOVING_FUNCTIONS (crates/perch-ir/src/validate.rs,
  // stellar-registry/perch#160): the wallet's uncapped-confirmation rule and
  // Perch's cross-token cap refusal must name the same functions. A change
  // here without the same change in Perch (or the reverse) is a mismatch.
  it("is Perch's list, in order", () => {
    expect(TOKEN_MOVING_FUNCTIONS).toEqual([
      'transfer',
      'transfer_from',
      'approve',
      'burn',
      'burn_from',
      'mint',
      'clawback',
      'set_authorized',
      'set_admin',
    ]);
  });
});
