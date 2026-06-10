import { fetchRpcRecent } from "./rpcSource.js";
import { fetchCuratedSacIds } from "../assets/curated.js";
import type { ActivityItem, ActivityPage } from "./types.js";

function dedupSort(items: ActivityItem[]): ActivityItem[] {
  const seen = new Map<string, ActivityItem>();
  for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
  return [...seen.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Load the wallet's recent activity from Soroban RPC, deduped and sorted
 * newest-first. Coverage is the most recent contiguous span the RPC can scan
 * (a few days at most — see `fetchRpcRecent`); `maxChunks` caps how far back to
 * scan, so the compact home card can load faster than the full activity page.
 *
 * Stellar Expert's full-history `/tx` endpoint is gated to its own origin
 * (CORS-blocked cross-origin, 402 server-side), so RPC's retained event window is
 * the source of truth for this feature.
 */
export async function loadActivityPage(opts: { address: string; maxChunks?: number }): Promise<ActivityPage> {
  // Curated SAC ids let classify tag payment rows whose (genuine) SAC isn't
  // the canonical one for its code — a scam "USDC" must not render like the
  // real one. Best-effort: on list failure only XLM counts as curated.
  const knownSacIds = await fetchCuratedSacIds();
  const page = await fetchRpcRecent(opts.address, opts.maxChunks, knownSacIds);
  return { items: dedupSort(page.items) };
}
