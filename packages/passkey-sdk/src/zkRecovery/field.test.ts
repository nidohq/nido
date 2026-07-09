import { describe, it, expect } from 'vitest';
import {
  FIELD_ORDER,
  FIELD_ORDER_BE,
  reduce384,
  split16,
  u256FromU64,
  fieldToBytes32,
  bytesToFieldCanonical,
} from './field.js';

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('reduce384', () => {
  it('interprets 48 bytes as a BE 384-bit integer and reduces mod r', () => {
    // 48-byte block: 0x00..00 || 0x01 in the low byte -> value 1, well
    // below r, so reduction is a no-op.
    const okm = new Uint8Array(48);
    okm[47] = 1;
    expect(reduce384(okm)).toBe(1n);
  });

  it('reduces a value >= r', () => {
    // FIELD_ORDER_BE zero-padded to 48 bytes, plus 5 -> (r + 5) mod r === 5.
    const okm = new Uint8Array(48);
    okm.set(FIELD_ORDER_BE, 16);
    okm[47] += 5;
    expect(reduce384(okm)).toBe(5n);
  });

  it('throws on wrong length', () => {
    expect(() => reduce384(new Uint8Array(32))).toThrow();
  });
});

describe('split16', () => {
  it('places the source 16 bytes in the LOW 16 bytes of each 32-byte limb', () => {
    // b32 = 0x00..00(hi:16 bytes of 0x11) || (lo:16 bytes of 0x22)
    const hiSource = new Uint8Array(16).fill(0x11);
    const loSource = new Uint8Array(16).fill(0x22);
    const b32 = new Uint8Array(32);
    b32.set(hiSource, 0);
    b32.set(loSource, 16);

    const [hi, lo] = split16(b32);

    const expectedHi = new Uint8Array(32);
    expectedHi.set(hiSource, 16);
    const expectedLo = new Uint8Array(32);
    expectedLo.set(loSource, 16);

    expect(fieldToBytes32(hi)).toEqual(expectedHi);
    expect(fieldToBytes32(lo)).toEqual(expectedLo);
  });

  it('throws on wrong length', () => {
    expect(() => split16(new Uint8Array(31))).toThrow();
  });
});

describe('u256FromU64', () => {
  it('accepts bigint and number', () => {
    expect(u256FromU64(42)).toBe(42n);
    expect(u256FromU64(42n)).toBe(42n);
  });

  it('rejects values outside u64 range', () => {
    expect(() => u256FromU64(-1n)).toThrow();
    expect(() => u256FromU64(0xffffffffffffffffn + 1n)).toThrow();
  });
});

describe('bytesToFieldCanonical', () => {
  it('round-trips a value below r', () => {
    const b32 = hexToBytes('00'.repeat(31) + '2a');
    expect(bytesToFieldCanonical(b32)).toBe(42n);
  });

  it('throws on FIELD_ORDER_BE itself (>= r, non-canonical)', () => {
    expect(() => bytesToFieldCanonical(FIELD_ORDER_BE)).toThrow();
  });

  it('accepts FIELD_ORDER - 1 (canonical max)', () => {
    expect(bytesToFieldCanonical(fieldToBytes32(FIELD_ORDER - 1n))).toBe(FIELD_ORDER - 1n);
  });

  it('throws on wrong length', () => {
    expect(() => bytesToFieldCanonical(new Uint8Array(33))).toThrow();
  });
});

describe('fieldToBytes32', () => {
  it('throws on out-of-range values', () => {
    expect(() => fieldToBytes32(-1n)).toThrow();
    expect(() => fieldToBytes32(FIELD_ORDER)).toThrow();
  });
});
