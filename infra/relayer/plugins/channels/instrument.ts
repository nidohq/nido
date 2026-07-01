/**
 * Pure timing core for the Channels plugin's handler-boundary instrumentation.
 *
 * Why a status timeline (not per-phase spans): the create submit is
 * `skipWait=true`, so the plugin QUEUES the transaction and returns `pending`
 * immediately — the expensive work (enforce re-sim, channel pick, fee-bump, rpc
 * submit, ledger-close confirm) runs in a background job, invisible to any
 * single handler call. What IS observable at the boundary is the transaction's
 * status as it advances across the browser's `getTransaction` polls. Recording
 * the first time each status is seen (persisted in the plugin kv, keyed by
 * transactionId) lets us derive the wall-clock spent in each status band —
 * `pending → submitted` (build/sign/channel/fee-bump/rpc submit) and
 * `submitted → confirmed` (ledger close) — the coarse relayer breakdown, with no
 * fork of the upstream module.
 *
 * This module is dependency-free and unit-tested (`instrument.test.ts`); the
 * `index.ts` wrapper wires it to the real handler, `context.kv`, `Date.now`, and
 * `console.log`.
 */

/** Channels statuses in canonical timeline order (terminal states last). */
export const STATUS_ORDER = [
  'pending',
  'sent',
  'submitted',
  'confirmed',
  'failed',
  'expired',
] as const;

export interface Timeline {
  /** First epoch-ms each status was observed for this transactionId. */
  firstSeen: Record<string, number>;
}

export interface Phase {
  /** e.g. `relayer.pending->submitted`. */
  phase: string;
  durMs: number;
  /** epoch-ms the closing status was first seen. */
  ts: number;
}

/** Phase key for the band between two consecutive observed statuses. */
export function phaseName(from: string, to: string): string {
  return `relayer.${from}->${to}`;
}

/**
 * Fold a freshly-observed status into the timeline and derive the phase
 * durations between consecutive observed statuses. Pure: the caller supplies
 * `now` and the previous timeline (from kv). Returns the updated timeline, the
 * cumulative phases so far, and the phase(s) NEWLY closed by this observation
 * (for one-shot structured logging — so each band is logged exactly once).
 */
export function foldStatus(
  prev: Timeline | null | undefined,
  status: string | null | undefined,
  now: number,
): { timeline: Timeline; phases: Phase[]; newlyClosed: Phase[] } {
  const firstSeen: Record<string, number> = { ...(prev?.firstSeen ?? {}) };
  const isNew = !!status && firstSeen[status] === undefined;
  if (status && isNew) firstSeen[status] = now;

  const seen = STATUS_ORDER.filter((s) => firstSeen[s] !== undefined).map((s) => ({
    s,
    ts: firstSeen[s],
  }));
  const phases: Phase[] = [];
  for (let i = 1; i < seen.length; i++) {
    phases.push({
      phase: phaseName(seen[i - 1].s, seen[i].s),
      durMs: seen[i].ts - seen[i - 1].ts,
      ts: seen[i].ts,
    });
  }

  // A band is "newly closed" when THIS call is the first to see the band's
  // closing status — i.e. the closing status was just added.
  const newlyClosed = isNew && status ? phases.filter((p) => p.ts === firstSeen[status]) : [];
  return { timeline: { firstSeen }, phases, newlyClosed };
}
