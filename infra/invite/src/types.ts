export type CodeStatus = "issued" | "claimed" | "used" | "expired";

/** One invitation code's lifecycle. `address` is the predicted C-address the
 *  frontend bound to this code at claim time (see Checker) — the Poller
 *  watches that address, not the code itself, for on-chain confirmation. */
export interface CodeRecord {
  code: string;
  status: CodeStatus;
  address?: string;
  issuedAt: number;
  claimedAt?: number;
  usedAt?: number;
  expiresAt: number;
}
