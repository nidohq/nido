import { fetchRpcRecent } from "./rpcSource.js";
import type { ActivityItem, ActivityPage } from "./types.js";

function dedupSort(items: ActivityItem[]): ActivityItem[] {
  const seen = new Map<string, ActivityItem>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Load the wallet's recent activity (the last ~7 days) from Soroban RPC, deduped
 * and sorted newest-first.
 *
 * Stellar Expert's full-history `/tx` endpoint is gated to its own origin
 * (CORS-blocked cross-origin, 402 server-side), so RPC's retained event window is
 * the source of truth for this feature.
 */
export async function loadActivityPage(opts: { address: string }): Promise<ActivityPage> {
  const page = await fetchRpcRecent(opts.address);
  return { items: dedupSort(page.items) };
}
