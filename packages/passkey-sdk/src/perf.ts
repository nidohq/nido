/**
 * Always-on performance timing seams.
 *
 * `perfMark` emits `performance.mark()` pairs under one namespace so the e2e
 * perf harness can stitch a create-run timeline AND so the same marks double as
 * future real-user-monitoring telemetry. It is a thin, env-agnostic wrapper:
 * like `fetch`/`setTimeout` (already used across this SDK), `performance` is a
 * platform primitive available in both the browser and node, so this keeps the
 * "no environment coupling" contract — no config, no globals beyond the
 * standard timing API, and a no-op where that API is absent.
 *
 * Naming is the cross-boundary contract the reporter parses; it lives here (the
 * lowest common dependency) so production seams and the test reporter share one
 * source of truth. See `tests/support/perf/schema.ts` (taxonomy) and
 * `report.ts` (stitch/aggregate).
 */

/** Namespace every perf mark shares: `nido:perf:<phase>:<start|end>`. */
export const PERF_PREFIX = "nido:perf:";

export type Edge = "start" | "end";

/** Build the mark name for a phase edge. */
export function markName(phase: string, edge: Edge): string {
  return `${PERF_PREFIX}${phase}:${edge}`;
}

/** Parse a perf mark name into its phase + edge, or null if it isn't one. */
export function parseMarkName(name: string): { phase: string; edge: Edge } | null {
  if (!name.startsWith(PERF_PREFIX)) return null;
  const rest = name.slice(PERF_PREFIX.length);
  const idx = rest.lastIndexOf(":");
  if (idx <= 0) return null; // no edge, or empty phase
  const phase = rest.slice(0, idx);
  const edge = rest.slice(idx + 1);
  if (edge !== "start" && edge !== "end") return null;
  return { phase, edge };
}

/**
 * Emit one perf mark. `detail` (e.g. `{ txId }`) rides along for cross-boundary
 * correlation and is readable via `performance.getEntriesByType('mark')`.
 * Never throws — timing instrumentation must not break the flow it measures.
 */
export function perfMark(phase: string, edge: Edge, detail?: Record<string, unknown>): void {
  try {
    if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
    performance.mark(markName(phase, edge), detail ? { detail } : undefined);
  } catch {
    /* timing must never break the measured flow */
  }
}

/** Clear all `nido:perf:*` marks (run isolation for the collector). No-op if unsupported. */
export function clearPerfMarks(): void {
  try {
    if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return;
    for (const entry of performance.getEntriesByType("mark")) {
      if (entry.name.startsWith(PERF_PREFIX)) performance.clearMarks(entry.name);
    }
  } catch {
    /* best effort */
  }
}
