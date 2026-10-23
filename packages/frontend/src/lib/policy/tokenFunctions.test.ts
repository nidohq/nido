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
