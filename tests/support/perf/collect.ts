/**
 * Browser-side perf collection for a create-run.
 *
 * Two sources, both correlated by `transactionId`:
 *  - page `performance` marks (the always-on app seams), harvested after the
 *    flow settles;
 *  - CDP `Network.*` timings for the `/relay` request(s), as a cross-check on
 *    the browser↔relayer hop.
 *
 * Only `txIdFromMarks` is pure (unit-tested in `collect.test.ts`); the rest is
 * thin Playwright/CDP glue exercised live by the perf spec.
 */
import type { Page, CDPSession } from '@playwright/test';
import { PERF_PREFIX, parseMarkName, type PerfMark, type RelayerPhase } from './schema';

/**
 * The create-run's transactionId, read off whichever mark carried it. Prefer
 * `poll.confirm` (the canonical correlation key the relayer also keys on), then
 * `relayer.submit`, then any mark with a txId. Null if none correlated.
 */
export function txIdFromMarks(marks: PerfMark[]): string | null {
  const preferred = ['poll.confirm', 'relayer.submit'];
  for (const phase of preferred) {
    for (const m of marks) {
      const parsed = parseMarkName(m.name);
      if (parsed?.phase === phase && m.detail?.txId) return m.detail.txId;
    }
  }
  for (const m of marks) {
    if (m.detail?.txId) return m.detail.txId;
  }
  return null;
}

/** Harvest the page's `nido:perf:*` marks (name, time, detail) after the run. */
export async function collectPerfMarks(page: Page): Promise<PerfMark[]> {
  return page.evaluate((prefix) => {
    return performance
      .getEntriesByType('mark')
      .filter((e) => e.name.startsWith(prefix))
      .map((e) => ({
        name: e.name,
        startTime: e.startTime,
        // PerformanceMark carries structured-cloneable detail; null if unset.
        detail: ((e as PerformanceMark).detail as { txId?: string } | null) ?? null,
      }));
  }, PERF_PREFIX);
}

/** One captured `/relay` request's timing. */
export interface RelayNetworkTiming {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  durMs: number;
}

/** Pull the relayer phase array off a parsed `/relay` response body, if present. */
function phasesFromBody(parsed: unknown): RelayerPhase[] {
  // The relayer wraps the plugin payload as {success, data:{...}} or
  // {success, data:{result:{...}}}; the phases live on the ChannelAccountsResponse.
  const data = (parsed as { data?: unknown })?.data ?? parsed;
  const payload = (data as { result?: unknown })?.result ?? data;
  const phases = (payload as { phases?: unknown })?.phases;
  if (!Array.isArray(phases)) return [];
  return phases.filter(
    (p): p is RelayerPhase =>
      !!p && typeof (p as RelayerPhase).phase === 'string' && typeof (p as RelayerPhase).durMs === 'number',
  );
}

/**
 * Capture CDP network timings AND server-side phase arrays for `/relay`
 * requests. Call before driving the flow. `stop()` awaits any in-flight body
 * reads, then returns the timings plus the most-complete `phases` array seen
 * (the final `getTransaction` poll carries the full status timeline — see the
 * relayer instrumentation). Best-effort: empty until the relayer emits phases.
 */
export async function startRelayCapture(
  cdp: CDPSession,
): Promise<{ stop(): Promise<{ timings: RelayNetworkTiming[]; relayerPhases: RelayerPhase[] }> }> {
  const inflight = new Map<string, { url: string; method: string; start: number; status?: number }>();
  const timings: RelayNetworkTiming[] = [];
  const bodyReads: Promise<void>[] = [];
  let relayerPhases: RelayerPhase[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cdp.on('Network.requestWillBeSent', (e: any) => {
    if (typeof e?.request?.url === 'string' && e.request.url.includes('/relay')) {
      inflight.set(e.requestId, { url: e.request.url, method: e.request.method, start: e.timestamp });
    }
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cdp.on('Network.responseReceived', (e: any) => {
    const r = inflight.get(e.requestId);
    if (r) r.status = e?.response?.status;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cdp.on('Network.loadingFinished', (e: any) => {
    const r = inflight.get(e.requestId);
    if (!r) return;
    timings.push({
      requestId: e.requestId,
      url: r.url,
      method: r.method,
      status: r.status,
      durMs: (e.timestamp - r.start) * 1000, // CDP timestamps are seconds
    });
    inflight.delete(e.requestId);
    // Harvest the response body for the relayer phase timeline. Keep the longest
    // array seen — the final confirmed poll carries the complete set.
    bodyReads.push(
      cdp
        .send('Network.getResponseBody', { requestId: e.requestId })
        .then((res: { body: string; base64Encoded: boolean }) => {
          const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
          const phases = phasesFromBody(JSON.parse(text));
          if (phases.length > relayerPhases.length) relayerPhases = phases;
        })
        .catch(() => {}),
    );
  });

  try {
    await cdp.send('Network.enable');
  } catch {
    /* best effort — leave the capture empty */
  }
  return {
    async stop() {
      await Promise.all(bodyReads);
      return { timings, relayerPhases };
    },
  };
}
