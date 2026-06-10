import { scValToNative } from "@stellar/stellar-sdk";
import { NATIVE_SAC_ID } from "../network.js";
import { fetchAccountEvents, type RawEvent } from "../activity/rpcSource.js";
import type { AssetCandidate } from "./types.js";

/**
 * Fold raw transfer events into deduped candidate tokens. A SAC transfer's
 * topic[3] carries the classic asset name ("CODE:ISSUER" or "native"), which
 * gives code/issuer for free; events without it are treated as non-SAC
 * SEP-41 tokens (probed via simulation instead of a Balance ledger key).
 * The native SAC is skipped — XLM is added unconditionally elsewhere.
 * Pure — exported for tests.
 */
export function extractTokenCandidates(raw: RawEvent[], self: string): AssetCandidate[] {
  const byId = new Map<string, AssetCandidate>();
  for (const e of raw) {
    const cid = typeof e.contractId === "string" ? e.contractId : e.contractId?.toString?.();
    if (!cid || cid === NATIVE_SAC_ID || byId.has(cid)) continue;
    const topics = e.topic.map((t) => {
      try {
        return scValToNative(t) as unknown;
      } catch {
        return null;
      }
    });
    if (topics[0] !== "transfer") continue;
    if (String(topics[1]) !== self && String(topics[2]) !== self) continue;
    const t3 = topics.length > 3 ? topics[3] : undefined;
    const sep11 = typeof t3 === "string" && t3.includes(":") ? t3.split(":") : null;
    byId.set(cid, {
      contractId: cid,
      // || not ?? : a malformed ":ISSUER" topic yields "" which must not win
      // downstream code fallbacks.
      code: sep11?.[0] || undefined,
      issuer: sep11?.[1] || undefined,
      sac: sep11 !== null || t3 === "native",
      source: "events",
    });
  }
  return [...byId.values()];
}

// An event spray (anyone can emit transfer events naming the account) must
// not balloon the balance probe; the curated list + store stay the durable
// sources, so capping fresh finds per load only delays the long tail.
const MAX_DISCOVERED = 100;

/**
 * Best-effort discovery: scan the last ~day of ledgers (2 chunks of the
 * shallow home-card walk; RPC retention caps any walk at ~7 days) for token
 * contracts that moved value to/from the account. The walk is shared with
 * the activity feed (fetchAccountEvents memoizes per page load) — its
 * filters already cover every transfer shape involving the account (the
 * pinned own-events walk is activity's own, separate request; see
 * transferFilters). The short window is why confirmed finds are persisted
 * (store.ts) and merged with the curated list. Errors yield [] : discovery
 * is additive and must never blank the assets card.
 */
export async function discoverFromEvents(address: string, maxChunks = 2): Promise<AssetCandidate[]> {
  try {
    const raw = await fetchAccountEvents(address, maxChunks);
    return extractTokenCandidates(raw, address).slice(0, MAX_DISCOVERED);
  } catch {
    return [];
  }
}
