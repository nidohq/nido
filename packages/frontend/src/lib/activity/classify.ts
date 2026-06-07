import { stroopsToXlm, formatXlm } from "../money.js";
import { shortAddr } from "../address.js";
import { EXPLORER_BASE } from "../network.js";
import type { ActivityItem, ActivityKind, DecodedEvent, DecodedTx } from "./types.js";

const explorerUrl = (txHash: string) => `${EXPLORER_BASE}/tx/${txHash}`;
const eventName = (e: DecodedEvent): string =>
  Array.isArray(e.topics) && typeof e.topics[0] === "string" ? (e.topics[0] as string) : "";

/** Asset label from a transfer's topic[3] ("native" | "CODE:ISSUER" | undefined). */
function assetLabel(topic3: unknown): string {
  if (topic3 === "native" || topic3 == null) return "XLM";
  const s = String(topic3);
  return s.includes(":") ? s.split(":")[0] : s;
}

/**
 * Stroops moved by a transfer event. SAC `transfer` data is either a bare i128
 * (→ bigint) or, for muxed destinations, a struct `{ amount: i128, to_muxed_id }`.
 * Returns null for anything else, so a malformed event is skipped, never thrown.
 */
function transferAmount(data: unknown): bigint | null {
  if (typeof data === "bigint") return data;
  if (data && typeof data === "object" && typeof (data as { amount?: unknown }).amount === "bigint") {
    return (data as { amount: bigint }).amount;
  }
  return null;
}

/** A single transfer event -> a payment row. Returns null if it doesn't involve `self`. */
function paymentRow(e: DecodedEvent, idx: number, self: string, txHash: string, ts: number): ActivityItem | null {
  const [, from, to, asset] = e.topics as unknown[];
  const fromS = String(from), toS = String(to);
  const isOut = fromS === self, isIn = toS === self;
  if (!isOut && !isIn) return null;
  const amountRaw = transferAmount(e.data);
  if (amountRaw === null) return null;
  const counterparty = isOut ? toS : fromS;
  const amount = formatXlm(stroopsToXlm(amountRaw));
  return {
    id: `${txHash}:transfer:${idx}`,
    txHash, timestamp: ts, kind: "payment",
    direction: isOut ? "out" : "in",
    title: isOut ? "Sent" : "Received",
    subtitle: `${isOut ? "to" : "from"} ${shortAddr(counterparty, 4, 4)}`,
    amount, asset: assetLabel(asset), counterparty,
    explorerUrl: explorerUrl(txHash),
  };
}

/** Map a non-payment event name -> {kind, title}. Unknown names -> null. */
function adminMeta(name: string): { kind: ActivityKind; title: string } | null {
  switch (name) {
    case "context_rule_added": return { kind: "rule", title: "Created a rule" };
    case "context_rule_removed": return { kind: "rule", title: "Removed a rule" };
    case "context_rule_updated":
    case "context_rule_meta_updated": return { kind: "rule", title: "Updated a rule" };
    case "signer_added": return { kind: "signer", title: "Added a signer" };
    case "signer_removed": return { kind: "signer", title: "Removed a signer" };
    case "policy_added": return { kind: "policy", title: "Added a policy" };
    case "policy_removed": return { kind: "policy", title: "Removed a policy" };
    case "signer_registered": case "policy_registered":
    case "signer_deregistered": case "policy_deregistered":
      return { kind: "registry", title: "Updated account keys" };
    default: return null;
  }
}

// Higher number = higher priority when collapsing a tx's admin events into one row.
const PRIORITY: Record<ActivityKind, number> = {
  rule: 4, signer: 3, policy: 2, registry: 1, other: 0, payment: 0,
};

/**
 * Turn one decoded transaction into display rows:
 *  - one row per `transfer` event that involves `self` (payments aren't collapsed);
 *  - all administrative events collapse into ONE representative row (highest priority);
 *  - a tx with no classifiable event -> one generic "Contract activity" row.
 * Never returns an empty array (never drops a tx).
 */
export function groupTxRows(decoded: DecodedTx, self: string): ActivityItem[] {
  const { txHash, ts, events } = decoded;
  const rows: ActivityItem[] = [];

  events.forEach((e, i) => {
    if (eventName(e) === "transfer") {
      const r = paymentRow(e, i, self, txHash, ts);
      if (r) rows.push(r);
    }
  });

  let best: { kind: ActivityKind; title: string } | null = null;
  for (const e of events) {
    const meta = adminMeta(eventName(e));
    if (meta && (!best || PRIORITY[meta.kind] > PRIORITY[best.kind])) best = meta;
  }
  if (best) {
    rows.push({
      id: txHash, txHash, timestamp: ts, kind: best.kind, title: best.title,
      explorerUrl: explorerUrl(txHash),
    });
  }

  if (rows.length === 0) {
    rows.push({
      id: txHash, txHash, timestamp: ts, kind: "other",
      title: "Contract activity",
      explorerUrl: explorerUrl(txHash),
    });
  }
  return rows;
}
