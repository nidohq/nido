import { describe, it, expect } from 'vitest';
import { toHex } from './docPolicyFetch.js';

describe('toHex', () => {
  it('lowercase-hex-encodes with zero padding', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
  });
});
