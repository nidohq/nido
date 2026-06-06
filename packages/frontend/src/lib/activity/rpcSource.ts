import { rpc, scValToNative, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { RPC_URL, NATIVE_SAC_ID } from "../network.js";
import { groupTxRows } from "./classify.js";
import type { ActivityPage, DecodedEvent, DecodedTx } from "./types.js";

// The public testnet RPC retains roughly the last 7 days of events. We ask for a
// window deliberately older than retention and let the range-error retry pin the
// start to the oldest retained ledger, so we always cover the full available
// window without hardcoding a fragile constant.
const OVERSHOOT_LEDGERS = 200_000;
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

/** Parse the oldest retained ledger out of the RPC "ledger range: A - B" error. */
function oldestFromRangeError(err: unknown): number | null {
  const msg = String((err as { message?: string })?.message ?? err);
  const m = /ledger range:\s*(\d+)\s*-\s*\d+/.exec(msg);
  return m ? Number(m[1]) : null;
}

/**
 * Fetch the wallet's recent activity (the full retained ~7-day window) from
 * Soroban RPC: the account's own admin events plus native-SAC `transfer` events
 * to/from the account. This is the source of truth for the history feature —
 * Stellar Expert's full-history `/tx` endpoint is gated to its own origin and is
 * unusable cross-origin from this app.
 */
export async function fetchRpcRecent(address: string): Promise<ActivityPage> {
  const server = new rpc.Server(RPC_URL);
  const { sequence } = await server.getLatestLedger();
  let startLedger = Math.max(1, sequence - OVERSHOOT_LEDGERS);

  // EventFilter.topics is string[][] — each segment a base64 ScVal or "*" (any one
  // segment). Protocol-23+ SAC `transfer` emits 4 topics: [transfer, from, to, asset].
  const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
  const selfTopic = Address.fromString(address).toScVal().toXDR("base64");

  const filters: rpc.Api.EventFilter[] = [
    // The account's own admin events (signer_added, context_rule_added, …) — all topics.
    { type: "contract", contractIds: [address] },
    // Incoming XLM: transfer where `to` == self.
    { type: "contract", contractIds: [NATIVE_SAC_ID], topics: [[transferTopic, "*", selfTopic, "*"]] },
    // Outgoing XLM: transfer where `from` == self.
    { type: "contract", contractIds: [NATIVE_SAC_ID], topics: [[transferTopic, selfTopic, "*", "*"]] },
  ];

  const raw: RawEvent[] = [];
  for (const filter of filters) {
    try {
      let res;
      try {
        res = await server.getEvents({ startLedger, filters: [filter], limit: PAGE_LIMIT });
      } catch (e) {
        // startLedger was older than retention — pin to the oldest retained ledger
        // (for this and every subsequent filter) and retry once.
        const oldest = oldestFromRangeError(e);
        if (oldest === null) throw e;
        startLedger = oldest;
        res = await server.getEvents({ startLedger, filters: [filter], limit: PAGE_LIMIT });
      }
      raw.push(...(res.events as unknown as RawEvent[]));
    } catch { /* a single failing filter shouldn't sink the whole fetch */ }
  }
  return mapRpcEvents(raw, address);
}
