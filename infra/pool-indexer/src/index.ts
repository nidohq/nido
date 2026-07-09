import { handlePoolIndexer, type PoolEnv } from "./handler.js";
import { runScan, SorobanEventsSource } from "./scanner.js";

export interface Env extends PoolEnv {
  POOL_CONTRACT_ID?: string;
  RPC_URL?: string;
  POOL_START_LEDGER?: string;
}

const RPC_CURSOR_KEY = "meta/rpcCursor";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handlePoolIndexer(request, env);
  },

  /**
   * Cron entry point (`wrangler.toml`'s `[triggers].crons`): scans the pool
   * contract's `LeafInserted` events since the last-persisted RPC cursor and
   * appends them idempotently. Persists the RPC's own next pagination
   * cursor in KV (`meta/rpcCursor`) so the ~7d `getEvents` retention window
   * never loses leaves across invocations (see `scanner.ts`'s doc comment).
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.POOL_CONTRACT_ID || !env.RPC_URL) {
      console.error("pool-indexer: scheduled scan skipped -- POOL_CONTRACT_ID/RPC_URL not configured");
      return;
    }
    ctx.waitUntil(
      (async () => {
        const startLedger = Number(env.POOL_START_LEDGER ?? "1");
        const source = new SorobanEventsSource({
          rpcUrl: env.RPC_URL!,
          contractId: env.POOL_CONTRACT_ID!,
          startLedger,
        });
        const cursor = await env.POOL_LEAVES.get(RPC_CURSOR_KEY);
        await runScan(env, source, cursor);
        const nextCursor = source.getLastCursor();
        if (nextCursor) {
          await env.POOL_LEAVES.put(RPC_CURSOR_KEY, nextCursor);
        }
      })(),
    );
  },
};
