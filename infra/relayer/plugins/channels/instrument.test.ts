import { describe, it, expect } from 'vitest';
import { foldStatus, phaseName, type Timeline } from './instrument';

describe('phaseName', () => {
  it('names the band between two statuses', () => {
    expect(phaseName('pending', 'submitted')).toBe('relayer.pending->submitted');
  });
});

describe('foldStatus', () => {
  it('records the first status with no phases yet', () => {
    const { timeline, phases, newlyClosed } = foldStatus(null, 'pending', 1000);
    expect(timeline.firstSeen).toEqual({ pending: 1000 });
    expect(phases).toEqual([]);
    expect(newlyClosed).toEqual([]);
  });

  it('derives a phase when a second status arrives', () => {
    const prev: Timeline = { firstSeen: { pending: 1000 } };
    const { timeline, phases, newlyClosed } = foldStatus(prev, 'submitted', 3500);
    expect(timeline.firstSeen).toEqual({ pending: 1000, submitted: 3500 });
    expect(phases).toEqual([{ phase: 'relayer.pending->submitted', durMs: 2500, ts: 3500 }]);
    // The band just closed → log it exactly once.
    expect(newlyClosed).toEqual([{ phase: 'relayer.pending->submitted', durMs: 2500, ts: 3500 }]);
  });

  it('only marks the NEWLY closed band on each transition (no re-logging)', () => {
    const prev: Timeline = { firstSeen: { pending: 1000, submitted: 3500 } };
    const { phases, newlyClosed } = foldStatus(prev, 'confirmed', 9000);
    // Cumulative phases include both bands...
    expect(phases).toEqual([
      { phase: 'relayer.pending->submitted', durMs: 2500, ts: 3500 },
      { phase: 'relayer.submitted->confirmed', durMs: 5500, ts: 9000 },
    ]);
    // ...but only the confirmed band is newly closed this call.
    expect(newlyClosed).toEqual([{ phase: 'relayer.submitted->confirmed', durMs: 5500, ts: 9000 }]);
  });

  it('is idempotent when the same status is re-observed (repeated polls)', () => {
    const prev: Timeline = { firstSeen: { pending: 1000, submitted: 3500 } };
    const { timeline, newlyClosed } = foldStatus(prev, 'submitted', 5000);
    // First-seen is preserved, not overwritten by the later poll.
    expect(timeline.firstSeen).toEqual({ pending: 1000, submitted: 3500 });
    expect(newlyClosed).toEqual([]);
  });

  it('ignores a null/absent status', () => {
    const prev: Timeline = { firstSeen: { pending: 1000 } };
    const { timeline, phases, newlyClosed } = foldStatus(prev, null, 2000);
    expect(timeline.firstSeen).toEqual({ pending: 1000 });
    expect(phases).toEqual([]);
    expect(newlyClosed).toEqual([]);
  });

  it('orders bands canonically even if statuses arrive out of order', () => {
    // 'submitted' observed before we ever recorded 'pending' (e.g. a late first
    // poll) — canonical STATUS_ORDER still sequences the bands correctly.
    const afterSubmitted = foldStatus(null, 'submitted', 4000);
    const afterPending = foldStatus(afterSubmitted.timeline, 'pending', 4200);
    expect(afterPending.phases).toEqual([
      { phase: 'relayer.pending->submitted', durMs: -200, ts: 4000 },
    ]);
  });
});
