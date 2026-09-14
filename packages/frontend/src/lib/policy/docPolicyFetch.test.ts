import { describe, it, expect } from 'vitest';
import { docJsonFromEventValue, toHex } from './docPolicyFetch.js';

const JSON_TEXT = '{"version":1,"signers":[],"rules":[]}';
const JSON_BYTES = new TextEncoder().encode(JSON_TEXT);

describe('docJsonFromEventValue', () => {
  it('decodes the generated event map shape { doc_json: Bytes }', () => {
    expect(docJsonFromEventValue({ doc_json: JSON_BYTES })).toBe(JSON_TEXT);
  });

  it('decodes a bare bytes payload', () => {
    expect(docJsonFromEventValue(JSON_BYTES)).toBe(JSON_TEXT);
  });

  it('rejects payloads without bytes', () => {
    expect(docJsonFromEventValue(null)).toBeNull();
    expect(docJsonFromEventValue('not-bytes')).toBeNull();
    expect(docJsonFromEventValue({ other: 1 })).toBeNull();
  });

  it('rejects invalid UTF-8 rather than yielding replacement chars', () => {
    expect(docJsonFromEventValue(new Uint8Array([0xff, 0xfe, 0x80]))).toBeNull();
  });
});

describe('toHex', () => {
  it('lowercase-hex-encodes with zero padding', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
  });
});
