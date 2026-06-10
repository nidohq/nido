// packages/frontend/src/lib/assets/types.ts

/** Where a candidate token came from (drives metadata precedence + persistence). */
export type AssetSource = "native" | "curated" | "events" | "stored";

/** A token contract that MIGHT hold a balance for the account. */
export interface AssetCandidate {
  contractId: string; // token contract C-address (StrKey)
  code?: string;      // display code ("USDC"); unknown for bare SEP-41 finds
  issuer?: string;    // classic issuer G-address (SAC-backed assets only)
  domain?: string;    // asset home domain, when the curated list provides one
  decimals?: number;  // known decimals (curated list); SACs are always 7
  icon?: string;      // https logo URL from a curated list (never from events)
  sac: boolean;       // SAC layout: batched Balance-entry read + 7 decimals
  source: AssetSource;
}

/** A candidate confirmed held (or native XLM, which is always shown). */
export interface AssetHolding {
  contractId: string;
  code: string;       // falls back to a shortened contract id
  issuer?: string;
  domain?: string;
  decimals: number;
  raw: bigint;        // smallest-unit balance
  formatted: string;  // grouped display amount
  verified: boolean;  // native or curated-list asset — codes/domains trustworthy
  icon?: string;      // https logo URL; only ever set for verified holdings
  explorerUrl: string;
}
