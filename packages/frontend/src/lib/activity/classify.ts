import { Asset } from "@stellar/stellar-sdk";
import { stroopsToXlm, formatXlm } from "../money.js";
import { shortAddr } from "../address.js";
import { EXPLORER_BASE, NATIVE_SAC_ID, NETWORK_PASSPHRASE } from "../network.js";
import type { ActivityItem, ActivityKind, DecodedEvent, DecodedTx } from "./types.js";

const explorerUrl = (txHash: string) => `${EXPLORER_BASE}/tx/${txHash}`;
const eventName = (e: DecodedEvent): string =>
  Array.isArray(e.topics) && typeof e.topics[0] === "string" ? (e.topics[0] as string) : "";

/** Asset label from a verified transfer's topic[3] ("native" | "CODE:ISSUER"). */
function assetLabel(topic3: string): string {
  if (topic3 === "native") return "XLM";
  return topic3.includes(":") ? topic3.split(":")[0] : topic3;
}

/**
 * The genuine SAC contract id for a transfer's sep-11 asset topic, or null
 * when the string isn't a valid asset. SAC ids are deterministic
 * (sha256 over network + asset), so this lets us prove an event's emitter
 * IS the named asset's contract without any registry.
 */
function sacIdFor(asset: string): string | null {
  if (asset === "native") return NATIVE_SAC_ID;
  try {
    const [code, issuer] = asset.split(":");
    return new Asset(code, issuer).contractId(NETWORK_PASSPHRASE);
  } catch {
    return null;
  }
}

/**
 * True when the event provably comes from the named asset's own SAC. The
 * event filters are unpinned (any contract can emit a transfer-shaped event
 * naming this account, with any asset string in topic[3]), so this check is
 * what keeps forged "you received 1,000,000 USDC" events out of the feed.
 * Bare 3-topic SEP-41 transfers are unverifiable here and excluded — their
 * tokens still surface through the assets card, whose balance probe is the
 * proof of holding.
 */
function isVerifiedSacTransfer(e: DecodedEvent): boolean {
  if (eventName(e) !== "transfer") return false;
  const asset = e.topics[3];
  if (typeof asset !== "string") return false;
  return e.contractId !== null && e.contractId === sacIdFor(asset);
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

/**
 * A single transfer event -> a payment row. Returns null if it doesn't
 * involve `self` or can't be verified as the named asset's own SAC
 * (see isVerifiedSacTransfer). SAC amounts are always 7-decimal, so the
 * XLM stroop formatter is exact for every verified asset.
 */
function paymentRow(e: DecodedEvent, idx: number, self: string, txHash: string, ts: number): ActivityItem | null {
  if (!isVerifiedSacTransfer(e)) return null;
  const [, from, to, asset] = e.topics as [unknown, unknown, unknown, string];
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
 *  - one row per VERIFIED `transfer` event that involves `self` (payments
 *    aren't collapsed);
 *  - all administrative events collapse into ONE representative row (highest priority);
 *  - a tx with no classifiable event but trustworthy evidence (an event from
 *    the account's own contract, or a verified SAC transfer that didn't
 *    decode) -> one generic "Contract activity" row.
 * A tx with NO trustworthy event yields [] — with unpinned transfer filters,
 * anything else would let arbitrary contracts spam rows into the feed by
 * emitting transfer-shaped events naming this account.
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

  const trustworthy = events.some((e) => e.contractId === self || isVerifiedSacTransfer(e));
  if (rows.length === 0 && trustworthy) {
    rows.push({
      id: txHash, txHash, timestamp: ts, kind: "other",
      title: "Contract activity",
      explorerUrl: explorerUrl(txHash),
    });
  }
  return rows;
}
