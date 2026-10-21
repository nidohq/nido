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
  /** Set once the local Demo Server's printer has confirmed the receipt
   *  printed — see `/pending-print/next` + `/pending-print/:code/ack`. A
   *  `used` record with no `deliveredAt` is still waiting to be printed. */
  deliveredAt?: number;
  expiresAt: number;
}
