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
import { PERF_PREFIX, parseMarkName, type PerfMark } from './schema';

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

/**
 * Capture CDP network timings for `/relay` requests. Call before driving the
 * flow; `stop()` returns everything seen so far. Best-effort — a failure to
 * enable the domain leaves the collector empty rather than failing the run.
 */
export async function startRelayCapture(cdp: CDPSession): Promise<{ stop(): RelayNetworkTiming[] }> {
  const inflight = new Map<string, { url: string; method: string; start: number; status?: number }>();
  const done: RelayNetworkTiming[] = [];

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
    done.push({
      requestId: e.requestId,
      url: r.url,
      method: r.method,
      status: r.status,
      durMs: (e.timestamp - r.start) * 1000, // CDP timestamps are seconds
    });
    inflight.delete(e.requestId);
  });

  try {
    await cdp.send('Network.enable');
  } catch {
    /* best effort — leave the capture empty */
  }
  return { stop: () => done };
}
