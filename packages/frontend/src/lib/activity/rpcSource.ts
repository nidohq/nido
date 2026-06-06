import { rpc, scValToNative, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { RPC_URL, NATIVE_SAC_ID } from "../network.js";
import { groupTxRows } from "./classify.js";
import type { ActivityPage, DecodedEvent, DecodedTx } from "./types.js";

// `getEvents` only scans a bounded span (~9k ledgers) per request and returns
// events ASCENDING from `startLedger`, so a single wide query never reaches the
// most-recent activity at the chain tip. And the native XLM SAC is so busy that
// scanning it over a wide range trips the RPC's `[-32001] processing limit`. So
// we walk fixed ledger chunks BACKWARD from the tip (newest first), each a single
// bounded request, and stop as soon as the dense SAC trips the limit — keeping
// whatever contiguous recent span we could fetch. The explorer link covers older
// history. (This is why the in-app view is "latest activity", not full history.)
const CHUNK_LEDGERS = 9_000;      // ≈ 12.5 h at ~5s/ledger; the largest span that reliably scans
const MIN_CHUNK_LEDGERS = 1_000;  // shrink a chunk down to this on -32001 before giving up
const MAX_CHUNKS = 6;             // upper bound on requests (~3 days of coverage when the SAC allows)
const PAGE_LIMIT = 1000;

type RawEvent = {
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
export function mapRpcEvents(raw: RawEvent[], self: string): ActivityPage {
  const byTx = new Map<string, DecodedTx>();
  for (const e of raw) {
    const ts = Math.floor(new Date(e.ledgerClosedAt).getTime() / 1000);
    const tx = byTx.get(e.txHash) ?? { txHash: e.txHash, ts, events: [] };
    tx.events.push(toDecoded(e));
    byTx.set(e.txHash, tx);
  }
  const items = [...byTx.values()].flatMap((tx) => groupTxRows(tx, self));
  items.sort((a, b) => b.timestamp - a.timestamp);
  return { items };
}

/**
 * The three event filters that constitute an account's activity: its own
 * contract events (signer/policy/rule changes) plus native-SAC `transfer` events
 * to and from it. EventFilter.topics is string[][] — each segment a base64 ScVal
 * or "*" (any one segment); protocol-23+ SAC `transfer` emits 4 topics
 * [transfer, from, to, asset].
 */
function accountFilters(address: string): rpc.Api.EventFilter[] {
  const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
  const selfTopic = Address.fromString(address).toScVal().toXDR("base64");
  return [
    { type: "contract", contractIds: [address] },
    { type: "contract", contractIds: [NATIVE_SAC_ID], topics: [[transferTopic, "*", selfTopic, "*"]] }, // incoming
    { type: "contract", contractIds: [NATIVE_SAC_ID], topics: [[transferTopic, selfTopic, "*", "*"]] }, // outgoing
  ];
}

/**
 * Fetch the wallet's latest activity from Soroban RPC by scanning fixed ledger
 * chunks backward from the chain tip (newest first). Each chunk is one bounded
 * request; if the dense native SAC trips the RPC's `[-32001]` processing limit we
 * shrink that chunk's span and retry, and if even the smallest span fails we stop
 * — returning whatever contiguous recent span we could fetch.
 *
 * This is the source of truth for the in-app history view. It is deliberately
 * NOT full history: Stellar Expert's `/tx` API is origin-gated (unusable from
 * this app) and the public RPC can neither retain (~1 week) nor cheaply scan the
 * busy SAC far back. Older history is reached via the explorer link in the UI.
 */
export async function fetchRpcRecent(address: string): Promise<ActivityPage> {
  const server = new rpc.Server(RPC_URL);
  const { sequence: latest } = await server.getLatestLedger();
  const filters = accountFilters(address);

  const raw: RawEvent[] = [];
  let endLedger = latest;
  for (let chunk = 0; chunk < MAX_CHUNKS && endLedger > 1; chunk++) {
    let span = CHUNK_LEDGERS;
    let fetched = false;
    let startLedger = Math.max(1, endLedger - span + 1);
    while (span >= MIN_CHUNK_LEDGERS) {
      startLedger = Math.max(1, endLedger - span + 1);
      try {
        const res = await server.getEvents({ startLedger, endLedger, filters, limit: PAGE_LIMIT });
        raw.push(...(res.events as unknown as RawEvent[]));
        fetched = true;
        break;
      } catch {
        // Most likely [-32001] (dense SAC in this range): shrink and retry. Any
        // other error (e.g. range older than retention) also ends this chunk.
        span = Math.floor(span / 3);
      }
    }
    if (!fetched) break; // even the smallest span failed → stop at the recent span we have
    endLedger = startLedger - 1; // chain to the next-older chunk with no gap
  }
  return mapRpcEvents(raw, address);
}
