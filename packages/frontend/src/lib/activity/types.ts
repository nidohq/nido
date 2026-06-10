// packages/frontend/src/lib/activity/types.ts

/** Coarse bucket driving the row icon + grouping priority. */
export type ActivityKind =
  | "payment"   // SAC transfer in/out (never collapsed)
  | "rule"      // context_rule_added/removed/updated (incl. recovery rules)
  | "signer"    // signer_added/removed
  | "policy"    // policy_added/removed
  | "registry"  // signer/policy registered/deregistered (low-signal bookkeeping)
  | "other";    // unrecognized event — generic fallback

/** A normalized, source-agnostic Soroban contract event. */
export interface DecodedEvent {
  contractId: string | null; // C-address of the emitting contract (StrKey)
  topics: unknown[];         // scValToNative'd; topics[0] is the event-name string
  data: unknown;             // scValToNative'd (e.g. BigInt stroops for transfer)
}

/** One transaction's normalized events, grouped for classification. */
export interface DecodedTx {
  txHash: string;
  ts: number;                 // unix seconds
  events: DecodedEvent[];
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
  amount?: string;            // display amount string (payments)
  asset?: string;             // "XLM" or "CODE" (payments)
  assetUnverified?: boolean;  // payment asset's SAC isn't native/curated — a
                              // genuine but unknown issuer could be spoofing
                              // a well-known code; the row must say so
  counterparty?: string;      // full address (copy / title attr)
  explorerUrl: string;        // `${EXPLORER_BASE}/tx/${txHash}`
}

export interface ActivityPage {
  items: ActivityItem[];
}
