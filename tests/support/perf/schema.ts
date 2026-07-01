/**
 * Canonical trace schema for the e2e create-run perf harness.
 *
 * One create-run produces a set of `performance.mark()` pairs in real app code
 * (browser side) plus, once the Channels plugin is instrumented, a set of
 * server-side phase durations harvested from the relayer. This module owns the
 * shared vocabulary both sides agree on: the mark-name namespace and the
 * ordered phase taxonomy. The reporter (`report.ts`) consumes it; the app
 * timing seams emit it. Keep this dependency-free so it imports cleanly from
 * both vitest (node) and the browser bundle.
 */

// Naming is the cross-boundary contract production seams emit; it lives in the
// SDK's `perf.ts` so app code and this reporter share ONE source of truth. We
// import that source module directly (it has zero transitive imports) rather
// than the package index, so test loading never drags the browser-coupled SDK
// bundle in.
export { PERF_PREFIX, markName, parseMarkName } from '../../../packages/passkey-sdk/src/perf';
export type { Edge } from '../../../packages/passkey-sdk/src/perf';

/** Which side of the browser/relayer boundary a phase is measured on. */
export type Where = 'browser' | 'relayer';

export interface PhaseDef {
  /** Stable key embedded in mark names, e.g. `factory.simulate`. */
  key: string;
  /** Human label for the report table. */
  label: string;
  where: Where;
}

/** The wall-clock span that bounds a whole create-run; the % base. */
export const TOTAL_PHASE = 'create-run';

/**
 * Ordered create-run phase taxonomy. Browser phases are emitted today via
 * `performance.mark()` seams; relayer phases land once the Channels plugin is
 * instrumented (handler-boundary wrap) and surface its phase array. Order is
 * the natural timeline so the report reads top-to-bottom like the flow.
 */
export const CREATE_PHASES: PhaseDef[] = [
  { key: TOTAL_PHASE, label: 'create-run (wall clock)', where: 'browser' },
  { key: 'webauthn.create', label: 'WebAuthn create ceremony', where: 'browser' },
  { key: 'factory.simulate', label: 'factory simulate (RPC)', where: 'browser' },
  { key: 'assemble.extract', label: 'assemble + extract XDR', where: 'browser' },
  { key: 'relayer.submit', label: 'relayer submit (HTTP)', where: 'browser' },
  // Server-side status bands, emitted by the Channels plugin instrumentation and
  // harvested off the getTransaction payload (see relayer PR). Names are dynamic
  // (`relayer.<from>-><to>`); the common happy-path bands are listed here for
  // ordering + labels, and `defaultWhere` catches any other `relayer.*` band.
  { key: 'relayer.pending->submitted', label: 'relayer: build→submit', where: 'relayer' },
  { key: 'relayer.submitted->confirmed', label: 'relayer: ledger confirm', where: 'relayer' },
  { key: 'poll.confirm', label: 'browser poll → confirmed', where: 'browser' },
  { key: 'funding.drain', label: 'funding drain', where: 'browser' },
];

const PHASE_INDEX = new Map(CREATE_PHASES.map((p, i) => [p.key, i]));

/** Look up a phase definition by key (undefined for ad-hoc phases). */
export function phaseDef(key: string): PhaseDef | undefined {
  const i = PHASE_INDEX.get(key);
  return i === undefined ? undefined : CREATE_PHASES[i];
}

/**
 * Side for a phase not in the taxonomy. Relayer bands are emitted with dynamic
 * `relayer.<from>-><to>` names, so prefix-match them to the relayer; everything
 * else is browser-side.
 */
export function defaultWhere(key: string): Where {
  return key.startsWith('relayer.') ? 'relayer' : 'browser';
}

/**
 * Canonical sort rank for a phase key. Known phases keep taxonomy order;
 * unknown (ad-hoc) phases sort after all known ones, stably.
 */
export function phaseRank(key: string): number {
  const i = PHASE_INDEX.get(key);
  return i === undefined ? CREATE_PHASES.length : i;
}

/** A `performance.mark()` entry as harvested from the page. */
export interface PerfMark {
  name: string;
  /** Absolute time on the page's performance timeline, in ms. */
  startTime: number;
  detail?: { txId?: string } | null;
}

/** A server-side relayer phase duration (from the Channels plugin payload). */
export interface RelayerPhase {
  phase: string;
  durMs: number;
  /** Optional server timestamp (ms epoch) for absolute placement. */
  ts?: number;
}

/** A single stitched phase span within one create-run. */
export interface Span {
  phase: string;
  where: Where;
  /** Absolute start on the run's timeline (0 for relayer-supplied durations). */
  startMs: number;
  endMs: number;
  durMs: number;
}

/** One create-run's correlated timeline. */
export interface Trace {
  runId: string;
  txId: string | null;
  startedAt: string | null;
  totalMs: number;
  spans: Span[];
}

/** Aggregated stats for one phase across N runs. */
export interface PhaseStat {
  phase: string;
  where: Where;
  label: string;
  count: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  /** Phase median as a percent of the total (create-run) median. */
  pctOfTotal: number;
}

/** Aggregate across all runs of an invocation. */
export interface Aggregate {
  runs: number;
  totalMedianMs: number;
  phases: PhaseStat[];
}
