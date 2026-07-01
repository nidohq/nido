import { describe, it, expect } from 'vitest';
import { markName } from './schema';
import type { PerfMark } from './schema';
import {
  median,
  percentile,
  stitch,
  buildTrace,
  aggregate,
  toMarkdownTable,
} from './report';

/** Helper: a start+end mark pair for `phase` at the given absolute times. */
function pair(phase: string, start: number, end: number, txId?: string): PerfMark[] {
  return [
    { name: markName(phase, 'start'), startTime: start, detail: txId ? { txId } : null },
    { name: markName(phase, 'end'), startTime: end, detail: txId ? { txId } : null },
  ];
}

describe('stats helpers', () => {
  it('computes the median of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middle values for an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('returns 0 for an empty set', () => {
    expect(median([])).toBe(0);
    expect(percentile([], 95)).toBe(0);
  });
  it('computes a high percentile', () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 95)).toBeGreaterThanOrEqual(90);
    expect(percentile(xs, 95)).toBeLessThanOrEqual(100);
  });
});

describe('stitch', () => {
  it('pairs start/end marks into spans with durations', () => {
    const marks = [...pair('factory.simulate', 100, 350)];
    const spans = stitch(marks);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      phase: 'factory.simulate',
      where: 'browser',
      startMs: 100,
      endMs: 350,
      durMs: 250,
    });
  });

  it('orders spans by canonical phase order, not arrival order', () => {
    const marks = [
      ...pair('poll.confirm', 500, 600),
      ...pair('webauthn.create', 10, 50),
      ...pair('factory.simulate', 60, 90),
    ];
    const spans = stitch(marks);
    expect(spans.map((s) => s.phase)).toEqual([
      'webauthn.create',
      'factory.simulate',
      'poll.confirm',
    ]);
  });

  it('drops an unpaired start with no matching end', () => {
    const marks: PerfMark[] = [{ name: markName('relayer.submit', 'start'), startTime: 5 }];
    expect(stitch(marks)).toHaveLength(0);
  });

  it('pairs the latest start with the latest end (a failed auto-attempt then a real one)', () => {
    // The new-account subdomain auto-attempts the passkey (autopass) and, when
    // that rejects with no activation, the user taps register: webauthn.create
    // gets a dangling start, then a real start+end. The span must be the real
    // ceremony (8 - 5), not inflated from the abandoned start at 0.
    const marks: PerfMark[] = [
      { name: markName('webauthn.create', 'start'), startTime: 0 },
      { name: markName('webauthn.create', 'start'), startTime: 5 },
      { name: markName('webauthn.create', 'end'), startTime: 8 },
    ];
    const spans = stitch(marks);
    expect(spans).toHaveLength(1);
    expect(spans[0].durMs).toBe(3);
  });

  it('ignores marks outside the perf namespace', () => {
    const marks: PerfMark[] = [
      { name: 'navigationStart', startTime: 0 },
      ...pair('funding.drain', 1000, 1200),
    ];
    const spans = stitch(marks);
    expect(spans).toHaveLength(1);
    expect(spans[0].phase).toBe('funding.drain');
  });

  it('folds relayer-emitted server phases in as relayer-side spans', () => {
    const marks = [...pair('relayer.submit', 100, 140)];
    const spans = stitch(marks, [
      { phase: 'relayer.enforce', durMs: 800 },
      { phase: 'relayer.rpc.poll', durMs: 4200 },
    ]);
    const enforce = spans.find((s) => s.phase === 'relayer.enforce');
    expect(enforce?.where).toBe('relayer');
    expect(enforce?.durMs).toBe(800);
  });
});

describe('buildTrace', () => {
  it('uses the create-run span as the total wall clock', () => {
    const marks = [
      ...pair('create-run', 0, 10_000),
      ...pair('webauthn.create', 100, 1100),
      ...pair('poll.confirm', 2000, 9000),
    ];
    const trace = buildTrace({ runId: 'r1', txId: 'tx1', marks });
    expect(trace.totalMs).toBe(10_000);
    expect(trace.txId).toBe('tx1');
    expect(trace.spans.length).toBe(3);
  });

  it('falls back to browser span coverage when create-run is absent', () => {
    const marks = [...pair('webauthn.create', 100, 1100), ...pair('poll.confirm', 2000, 9000)];
    const trace = buildTrace({ runId: 'r1', txId: null, marks });
    expect(trace.totalMs).toBe(9000 - 100);
  });
});

describe('aggregate + markdown', () => {
  const traces = [1, 2, 3].map((n) =>
    buildTrace({
      runId: `r${n}`,
      txId: `tx${n}`,
      marks: [
        ...pair('create-run', 0, 1000 * n),
        ...pair('poll.confirm', 10, 10 + 800 * n),
        ...pair('factory.simulate', 0, 100 * n),
      ],
    }),
  );

  it('reports median/min/max per phase across runs', () => {
    const agg = aggregate(traces);
    expect(agg.runs).toBe(3);
    const poll = agg.phases.find((p) => p.phase === 'poll.confirm')!;
    expect(poll.count).toBe(3);
    expect(poll.minMs).toBe(800);
    expect(poll.maxMs).toBe(2400);
    expect(poll.medianMs).toBe(1600);
  });

  it('computes each phase as a percent of the total median', () => {
    const agg = aggregate(traces);
    expect(agg.totalMedianMs).toBe(2000);
    const poll = agg.phases.find((p) => p.phase === 'poll.confirm')!;
    // median poll 1600 / median total 2000 = 80%
    expect(Math.round(poll.pctOfTotal)).toBe(80);
  });

  it('renders a markdown table with a header and a row per phase', () => {
    const md = toMarkdownTable(aggregate(traces));
    expect(md).toContain('% of total');
    expect(md).toContain('poll.confirm');
    expect(md).toContain('factory.simulate');
    expect(md).toMatch(/\|\s*-+/); // separator row
  });

  it('tags a relayer-emitted phase (even one not in the taxonomy) as relayer-side', () => {
    // #132 emits dynamic band names like relayer.submitted->expired; the reporter
    // must attribute any relayer.* phase to the relayer, not default it to browser.
    const trace = buildTrace({
      runId: 'r',
      txId: 't',
      marks: [{ name: markName('create-run', 'start'), startTime: 0 }, { name: markName('create-run', 'end'), startTime: 1000 }],
      relayerPhases: [{ phase: 'relayer.submitted->expired', durMs: 400 }],
    });
    const agg = aggregate([trace]);
    const p = agg.phases.find((x) => x.phase === 'relayer.submitted->expired')!;
    expect(p.where).toBe('relayer');
  });
});
