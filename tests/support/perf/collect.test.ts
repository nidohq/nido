import { describe, it, expect } from 'vitest';
import { markName } from './schema';
import type { PerfMark } from './schema';
import { txIdFromMarks } from './collect';

describe('txIdFromMarks', () => {
  it('pulls the transactionId off a correlated mark detail', () => {
    const marks: PerfMark[] = [
      { name: markName('relayer.submit', 'start'), startTime: 1 },
      { name: markName('relayer.submit', 'end'), startTime: 2, detail: { txId: 'abc-123' } },
    ];
    expect(txIdFromMarks(marks)).toBe('abc-123');
  });

  it('prefers a poll.confirm txId (the canonical correlation key)', () => {
    const marks: PerfMark[] = [
      { name: markName('relayer.submit', 'end'), startTime: 2, detail: { txId: 'from-submit' } },
      { name: markName('poll.confirm', 'start'), startTime: 3, detail: { txId: 'from-poll' } },
    ];
    expect(txIdFromMarks(marks)).toBe('from-poll');
  });

  it('returns null when no mark carries a txId', () => {
    const marks: PerfMark[] = [{ name: markName('webauthn.create', 'start'), startTime: 1 }];
    expect(txIdFromMarks(marks)).toBeNull();
  });
});
