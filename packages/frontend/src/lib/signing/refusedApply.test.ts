import { describe, expect, it } from 'vitest';
import { refusedApplyOutcome } from './refusedApply.js';

const REQUESTED = 'ab'.repeat(32);

describe('refusedApplyOutcome', () => {
  it('is applied when the account holds the requested document', () => {
    expect(refusedApplyOutcome(REQUESTED, REQUESTED)).toBe('applied');
    expect(refusedApplyOutcome(REQUESTED.toUpperCase(), REQUESTED)).toBe('applied');
  });

  it('is not applied when the account holds another document, or none', () => {
    expect(refusedApplyOutcome('cd'.repeat(32), REQUESTED)).toBe('not-applied');
    expect(refusedApplyOutcome(null, REQUESTED)).toBe('not-applied');
  });

  it('is unknown when the account could not be read', () => {
    expect(refusedApplyOutcome(undefined, REQUESTED)).toBe('unknown');
  });
});
