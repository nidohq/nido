/**
 * Pure trace reporter: stitch perf marks (+ relayer phases) into ordered
 * spans, build a per-run trace, aggregate across runs into median/min/max/p95
 * and `% of total`, and render a markdown table. No I/O, no DOM — every
 * function is deterministic and unit-tested in `report.test.ts`. The runner
 * (`run-perf.mjs`) does the file/console I/O around these.
 */
import {
  CREATE_PHASES,
  TOTAL_PHASE,
  defaultWhere,
  parseMarkName,
  phaseDef,
  phaseRank,
  type Aggregate,
  type PerfMark,
  type PhaseStat,
  type RelayerPhase,
  type Span,
  type Trace,
  type Where,
} from './schema';

/** Median of a numeric set (0 for empty). Does not mutate its input. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolated percentile (0 for empty). p in [0, 100]. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

function whereOf(phase: string): Where {
  return phaseDef(phase)?.where ?? defaultWhere(phase);
}

/**
 * Pair start/end marks by phase into spans. Unpaired marks are dropped,
 * non-perf marks ignored. Relayer-supplied phase durations (server side) fold
 * in as relayer spans with no absolute placement. Output is sorted by the
 * canonical taxonomy order.
 */
export function stitch(marks: PerfMark[], relayerPhases: RelayerPhase[] = []): Span[] {
  // Pair the LATEST start with the LATEST end per phase. The new-account
  // subdomain auto-attempts the passkey (autopass) and, if that rejects, the
  // user taps register — leaving a dangling earlier start. Taking the latest of
  // each measures the ceremony that actually completed, not the abandoned one.
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  for (const m of marks) {
    const parsed = parseMarkName(m.name);
    if (!parsed) continue;
    const bucket = parsed.edge === 'start' ? starts : ends;
    const prev = bucket.get(parsed.phase);
    if (prev === undefined || m.startTime > prev) bucket.set(parsed.phase, m.startTime);
  }

  const spans: Span[] = [];
  for (const [phase, startMs] of starts) {
    const endMs = ends.get(phase);
    if (endMs === undefined || endMs < startMs) continue; // unpaired / mis-ordered
    spans.push({ phase, where: whereOf(phase), startMs, endMs, durMs: endMs - startMs });
  }
  for (const rp of relayerPhases) {
    spans.push({
      phase: rp.phase,
      where: whereOf(rp.phase),
      startMs: rp.ts ?? 0,
      endMs: (rp.ts ?? 0) + rp.durMs,
      durMs: rp.durMs,
    });
  }

  spans.sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.startMs - b.startMs);
  return spans;
}

/**
 * Build one create-run trace. Total wall clock is the `create-run` span if
 * present, else the coverage of the browser spans (relayer spans have no
 * absolute placement, so they're excluded from the fallback span).
 */
export function buildTrace(input: {
  runId: string;
  txId: string | null;
  marks: PerfMark[];
  relayerPhases?: RelayerPhase[];
  startedAt?: string | null;
}): Trace {
  const spans = stitch(input.marks, input.relayerPhases ?? []);
  const total = spans.find((s) => s.phase === TOTAL_PHASE);
  let totalMs = total?.durMs ?? 0;
  if (!total) {
    const browser = spans.filter((s) => s.where === 'browser');
    if (browser.length > 0) {
      const lo = Math.min(...browser.map((s) => s.startMs));
      const hi = Math.max(...browser.map((s) => s.endMs));
      totalMs = hi - lo;
    }
  }
  return {
    runId: input.runId,
    txId: input.txId,
    startedAt: input.startedAt ?? null,
    totalMs,
    spans,
  };
}

/**
 * Aggregate per-phase stats across runs. `% of total` is each phase's median
 * over the median total wall clock — phases overlap (funding drains while the
 * deploy polls), so percentages intentionally do not sum to 100; the table
 * answers "what is taking the longest", not "where did the wall clock go".
 */
export function aggregate(traces: Trace[]): Aggregate {
  const totalMedianMs = median(traces.map((t) => t.totalMs));

  const byPhase = new Map<string, number[]>();
  for (const t of traces) {
    for (const s of t.spans) {
      if (s.phase === TOTAL_PHASE) continue; // the total is its own row's base, not a phase
      const arr = byPhase.get(s.phase) ?? [];
      arr.push(s.durMs);
      byPhase.set(s.phase, arr);
    }
  }

  const phases: PhaseStat[] = [];
  for (const [phase, durs] of byPhase) {
    const def = phaseDef(phase);
    const med = median(durs);
    phases.push({
      phase,
      where: def?.where ?? defaultWhere(phase),
      label: def?.label ?? phase,
      count: durs.length,
      medianMs: med,
      minMs: Math.min(...durs),
      maxMs: Math.max(...durs),
      p95Ms: percentile(durs, 95),
      pctOfTotal: totalMedianMs > 0 ? (med / totalMedianMs) * 100 : 0,
    });
  }
  phases.sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.phase.localeCompare(b.phase));

  return { runs: traces.length, totalMedianMs, phases };
}

const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const fmtPct = (p: number): string => `${p.toFixed(1)}%`;

/** Render the aggregate as a markdown table sorted by the canonical timeline. */
export function toMarkdownTable(agg: Aggregate): string {
  const header = `### Create-run perf — ${agg.runs} run(s), total median ${fmtMs(agg.totalMedianMs)}`;
  const cols = ['phase', 'where', 'median', 'min', 'max', 'p95', '% of total'];
  const sep = cols.map(() => '---');
  const rows = agg.phases.map((p) => [
    p.phase,
    p.where,
    fmtMs(p.medianMs),
    fmtMs(p.minMs),
    fmtMs(p.maxMs),
    fmtMs(p.p95Ms),
    fmtPct(p.pctOfTotal),
  ]);
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [header, '', line(cols), line(sep), ...rows.map(line)].join('\n');
}

export { CREATE_PHASES };
