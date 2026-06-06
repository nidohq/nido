// packages/frontend/src/lib/activity/types.ts

/** Coarse bucket driving the row icon + grouping priority. */
export type ActivityKind =
  | "payment"   // SAC transfer in/out (never collapsed)
  | "recovery"  // social-recovery rule created/used
  | "rule"      // context_rule_added/removed/updated (non-recovery)
  | "signer"    // signer_added/removed
  | "policy"    // policy_added/removed
  | "registry"  // signer/policy registered/deregistered (low-signal bookkeeping)
  | "other";    // recognized invocation w/o a richer bucket, or generic fallback

/** A normalized, source-agnostic Soroban contract event. */
export interface DecodedEvent {
  contractId: string | null; // C-address of the emitting contract (StrKey)
  topics: unknown[];         // scValToNative'd; topics[0] is the event-name string
  data: unknown;             // scValToNative'd (e.g. BigInt stroops for transfer)
}

/** Output of decoding one Stellar Expert tx record (or one RPC tx group). */
export interface DecodedTx {
  txHash: string;
  ts: number;                 // unix seconds
  events: DecodedEvent[];
  invokedFn?: string;         // best-effort top-level invokeContract fn name
  invokedContract?: string;   // best-effort top-level target C-address
}

/** One rendered history row. */
export interface ActivityItem {
  // Stable key + cross-source dedup id.
  // Admin rows: `${txHash}`. Payment rows: `${txHash}:transfer:${i}`.
  id: string;
  txHash: string;
  timestamp: number;          // unix seconds
  kind: ActivityKind;
  direction?: "in" | "out";   // payments only
  title: string;              // "Received", "Sent", "Added a signer", ...
  subtitle?: string;          // counterparty (shortAddr) or detail
  amount?: string;            // display XLM string (payments)
  asset?: string;             // "XLM" or "CODE" (payments)
  counterparty?: string;      // full address (copy / title attr)
  explorerUrl: string;        // `${EXPLORER_BASE}/tx/${txHash}`
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;  // Expert paging_token; null when no more / on fallback
  source: "expert" | "rpc";
  partial: boolean;           // true on the RPC fallback (recent window only)
}
