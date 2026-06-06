import { rpc, scValToNative, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";
import { RPC_URL, NATIVE_SAC_ID } from "../network.js";
import { groupTxRows } from "./classify.js";
import type { ActivityPage, DecodedEvent, DecodedTx } from "./types.js";

/** ~24h of testnet ledgers (≈5s/ledger). Stays within the public RPC retention window. */
const RECENT_LEDGERS = 17_280;

type RawEvent = {
  contractId?: { toString(): string } | string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  txHash: string;
  ledgerClosedAt: string;
};

/** Decode one raw RPC event into a normalized DecodedEvent. */
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
  return { items, nextCursor: null, source: "rpc", partial: true };
}

/** Fetch the recent activity window for `address` from Soroban RPC. */
export async function fetchRpcRecent(address: string): Promise<ActivityPage> {
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - RECENT_LEDGERS);

  // EventFilter.topics is string[][] — each segment a base64 ScVal or "*" (any
  // one segment). Protocol-23+ SAC `transfer` emits 4 topics: [transfer, from, to, asset].
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
      const res = await server.getEvents({ startLedger, filters: [filter], limit: 100 });
      raw.push(...(res.events as unknown as RawEvent[]));
    } catch { /* a single failing filter shouldn't sink the whole fallback */ }
  }
  return mapRpcEvents(raw, address);
}
