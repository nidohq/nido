import { describe, it, expect } from 'vitest';
import { buildPickerRows, truncateAddress } from './friendPicker.js';

describe('buildPickerRows', () => {
  const f1 = 'CFRIEND1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const f2 = 'CFRIEND2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  it('labels by name, truncates fallback, flags signed', () => {
    const rows = buildPickerRows([f1, f2], new Map([[f1, 'alice']]), new Set([f2]));
    expect(rows[0]).toEqual({ address: f1, label: 'alice', signed: false });
    expect(rows[1]).toEqual({ address: f2, label: truncateAddress(f2), signed: true });
  });
});
