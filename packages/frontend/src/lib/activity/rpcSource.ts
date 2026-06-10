import { rpc, scValToNative, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { RPC_URL } from "../network.js";
import { groupTxRows } from "./classify.js";
import type { ActivityPage, DecodedEvent, DecodedTx } from "./types.js";

// `getEvents` only scans a bounded span (~9k ledgers) per request and returns
// events ASCENDING from `startLedger`, so a single wide query never reaches the
// most-recent activity at the chain tip. And a dense range (the busy testnet
// SACs) can trip the RPC's `[-32001] processing limit`. So we walk fixed
// ledger chunks BACKWARD from the tip (newest first), each a single bounded
// request, and stop as soon as a dense range trips the limit — keeping
// whatever contiguous recent span we could fetch. The explorer link covers older
// history. (This is why the in-app view is "latest activity", not full history.)
const CHUNK_LEDGERS = 9_000;      // ≈ 12.5 h at ~5s/ledger; the largest span that reliably scans
const MIN_CHUNK_LEDGERS = 1_000;  // shrink a chunk down to this on -32001 before giving up
const MAX_CHUNKS = 6;             // upper bound on requests (~3 days of coverage when the SAC allows)
const PAGE_LIMIT = 1000;

export type RawEvent = {
  contractId?: { toString(): string } | string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  txHash: string;
  ledgerClosedAt: string;
};

/** Decode one raw RPC event (already-parsed ScVals) into a normalized DecodedEvent. */
function toDecoded(e: RawEvent): DecodedEvent {
  const cid = typeof e.contractId === "string" ? e.contractId : e.contractId?.toString?.() ?? null;
  return {
    contractId: cid,
    topics: e.topic.map((t) => { try { return scValToNative(t); } catch { return null; } }),
    data: (() => { try { return scValToNative(e.value); } catch { return null; } })(),
  };
}

/** Group raw RPC events by tx hash and classify them. Exposed for unit testing. */
export function mapRpcEvents(raw: RawEvent[], self: string, knownSacIds?: Set<string>): ActivityPage {
  const byTx = new Map<string, DecodedTx>();
  for (const e of raw) {
    const ts = Math.floor(new Date(e.ledgerClosedAt).getTime() / 1000);
    const tx = byTx.get(e.txHash) ?? { txHash: e.txHash, ts, events: [] };
    tx.events.push(toDecoded(e));
    byTx.set(e.txHash, tx);
  }
  const items = [...byTx.values()].flatMap((tx) => groupTxRows(tx, self, knownSacIds));
  items.sort((a, b) => b.timestamp - a.timestamp);
  return { items };
}

/** Filter for the account's own contract events (signer/policy/rule changes). */
export function ownEventsFilter(address: string): rpc.Api.EventFilter[] {
  return [{ type: "contract", contractIds: [address] }];
}

/**
 * Unpinned filter matching `transfer` events involving the account from ANY
 * token contract — not just the native SAC, so USDC and other token deposits
 * show up. EventFilter.topics is string[][] — each segment a base64 ScVal or
 * "*" (any one segment); a topic filter only matches events with the same
 * segment count, so both the 4-topic SAC shape [transfer, from, to, asset]
 * and the 3-topic bare SEP-41 shape are listed. Because the filter is
 * unpinned, anything it returns is attacker-emittable — classify only
 * renders rows whose emitting contract provably IS the named asset's SAC
 * (see paymentRow), and asset discovery (lib/assets) verifies balances.
 *
 * IMPORTANT: this must stay in its OWN getEvents request. stellar-rpc
 * narrows a request's scan to the union of every contractIds mentioned by
 * ANY of its filters, so combining this unpinned filter with a pinned one
 * (e.g. ownEventsFilter) silently drops all events from unmentioned
 * contracts (verified live against soroban-testnet.stellar.org, 2026-06-10:
 * pinned+unpinned returned only the pinned contract's events; the same
 * unpinned filter alone returned everything).
 */
export function transferFilters(address: string): rpc.Api.EventFilter[] {
  const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
  const selfTopic = Address.fromString(address).toScVal().toXDR("base64");
  return [
    {
      type: "contract",
      topics: [
        [transferTopic, "*", selfTopic, "*"], // incoming, SAC shape
        [transferTopic, selfTopic, "*", "*"], // outgoing, SAC shape
        [transferTopic, "*", selfTopic],      // incoming, bare SEP-41 shape
        [transferTopic, selfTopic, "*"],      // outgoing, bare SEP-41 shape
      ],
    },
  ];
}

/**
 * Scan fixed ledger chunks backward from the chain tip (newest first) for
 * events matching `filters`. Each chunk is one bounded request; if a dense
 * range trips the RPC's `[-32001]` processing limit we shrink that chunk's
 * span and retry, and if even the smallest span fails we stop — returning
 * whatever contiguous recent span we could fetch. Shared by the activity feed
 * and asset discovery (lib/assets), which differ only in their filters.
 */
export async function walkEventChunks(filters: rpc.Api.EventFilter[], maxChunks = MAX_CHUNKS): Promise<RawEvent[]> {
  const server = new rpc.Server(RPC_URL);
  const { sequence: latest } = await server.getLatestLedger();

  const raw: RawEvent[] = [];
  let endLedger = latest;
  for (let chunk = 0; chunk < maxChunks && endLedger > 1; chunk++) {
    let span = CHUNK_LEDGERS;
    let fetched = false;
    let startLedger = Math.max(1, endLedger - span + 1);
    let lastError: unknown;
    while (span >= MIN_CHUNK_LEDGERS) {
      startLedger = Math.max(1, endLedger - span + 1);
      try {
        const res = await server.getEvents({ startLedger, endLedger, filters, limit: PAGE_LIMIT });
        if (res.events.length >= PAGE_LIMIT) {
          // A full page means the RPC truncated the chunk — and since events
          // come ASCENDING, what's missing is the chunk's NEWEST span. With
          // unpinned filters an event spray could fill the page budget to
          // hide real payments, so never accept a truncated chunk: shrink it
          // like a [-32001] until it fits (or the chunk fails honestly).
          lastError = new Error("getEvents page overflow");
          span = Math.floor(span / 3);
          continue;
        }
        raw.push(...(res.events as unknown as RawEvent[]));
        fetched = true;
        break;
      } catch (e) {
        // Most likely [-32001] (dense range): shrink and retry. Any other
        // error (e.g. range older than retention) also ends this chunk.
        lastError = e;
        span = Math.floor(span / 3);
      }
    }
    if (!fetched) {
      // Couldn't fetch even the NEWEST chunk → this is a real RPC failure, not an
      // empty account. Surface it so the UI shows its error/retry state instead of
      // a misleading "no recent activity". Failures on an older chunk just stop the
      // walk; we keep the recent span we already have.
      if (chunk === 0) throw lastError instanceof Error ? lastError : new Error("getEvents failed");
      break;
    }
    endLedger = startLedger - 1; // chain to the next-older chunk with no gap
  }
  return raw;
}

// One walk per (address, depth) per page load: the activity card and asset
// discovery request the same span on the same page, and Astro full-reloads
// between navigations, so module state lives exactly one page view.
const eventsCache = new Map<string, Promise<RawEvent[]>>();

/**
 * The account's recent token-transfer events, memoized so the activity card
 * and asset discovery share ONE chunk walk per page load. Exported for
 * lib/assets/discover.
 */
export function fetchAccountEvents(address: string, maxChunks = MAX_CHUNKS): Promise<RawEvent[]> {
  const key = `${address}:${maxChunks}`;
  let pending = eventsCache.get(key);
  if (!pending) {
    pending = walkEventChunks(transferFilters(address), maxChunks);
    // Cache successes only: a memoized rejection would make the activity
    // page's Retry button replay the same failure for the whole page view.
    // (The .catch is an eviction side-observer — callers still see the
    // original rejection through the returned promise.)
    pending.catch(() => {
      if (eventsCache.get(key) === pending) eventsCache.delete(key);
    });
    eventsCache.set(key, pending);
  }
  return pending;
}

/** Reset the per-page event memo (tests only). */
export function clearAccountEventsCache(): void {
  eventsCache.clear();
}

/**
 * Fetch the wallet's latest activity from Soroban RPC: the account's own
 * events plus all token transfers involving it, merged from two parallel
 * walks — they cannot share one request (see transferFilters), but the
 * transfers walk is shared with asset discovery via fetchAccountEvents.
 *
 * This is the source of truth for the in-app history view. It is deliberately
 * NOT full history: Stellar Expert's `/tx` API is origin-gated (unusable from
 * this app) and the public RPC can neither retain (~1 week) nor cheaply scan
 * that far back. Older history is reached via the explorer link in the UI.
 */
export async function fetchRpcRecent(
  address: string,
  maxChunks = MAX_CHUNKS,
  knownSacIds?: Set<string>,
): Promise<ActivityPage> {
  const [own, transfers] = await Promise.all([
    walkEventChunks(ownEventsFilter(address), maxChunks),
    fetchAccountEvents(address, maxChunks),
  ]);
  return mapRpcEvents([...own, ...transfers], address, knownSacIds);
}
