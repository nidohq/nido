import { handler as baseHandler } from '@openzeppelin/relayer-plugin-channels';
import { foldStatus, type Timeline } from './instrument';

/**
 * Handler-boundary perf instrumentation for the Channels plugin.
 *
 * Wraps the upstream handler and, for any transaction-bearing response, folds
 * the current status into a per-transactionId timeline persisted in the plugin
 * kv (Redis-backed). It then:
 *
 *  (a) attaches a cumulative `phases` array to the response the browser polls
 *      via `getTransaction` — the correlated harvest path (no log-scrape in the
 *      happy case); and
 *  (b) emits one structured JSON log line per newly-closed band
 *      `{evt:"channels.phase", txId, phase, durMs, ts}` — the monitoring-
 *      foundation log format for a future relayer dashboard.
 *
 * Fully backward-compatible: instrumentation is best-effort and wrapped in
 * try/catch, so it can never alter the shape the relayer depends on or break the
 * flow it measures. See instrument.ts for why a STATUS TIMELINE (not per-phase
 * spans) is what the boundary can observe under skipWait=true.
 */

const KV_TTL_SEC = 3600; // throwaway perf txs — keep each timeline ~1h
const kvKey = (txId: string): string => `perf:phases:${txId}`;

// The PluginContext shape (api, kv, params, ...) — typed loosely so this file
// never fails to load on an SDK type drift; the wrapper is defensive regardless.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handler(context: any): Promise<any> {
  const result = await baseHandler(context);
  try {
    const txId: unknown = result?.transactionId;
    const status: unknown = result?.status;
    if (typeof txId === 'string' && txId && typeof status === 'string' && status && context?.kv) {
      const key = kvKey(txId);
      const prev = (await context.kv.get(key)) as Timeline | null;
      const now = Date.now();
      const { timeline, phases, newlyClosed } = foldStatus(prev, status, now);
      await context.kv.set(key, timeline, { ttlSec: KV_TTL_SEC });
      // (a) correlated harvest — attach the cumulative phases to the payload.
      if (result && typeof result === 'object') result.phases = phases;
      // (b) monitoring-foundation structured log — one line per closed band.
      for (const p of newlyClosed) {
        console.log(
          JSON.stringify({ evt: 'channels.phase', txId, phase: p.phase, durMs: p.durMs, ts: p.ts }),
        );
      }
    }
  } catch (err) {
    // Timing must never break the relayer flow it measures.
    console.warn(
      `[channels-perf] instrumentation skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return result;
}
