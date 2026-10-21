import type { CodeRecord, CodeStatus } from "./types.js";

/** Storage for invitation codes. `put` always replaces the whole record
 *  (no partial updates) so callers never rely on in-place mutation of a
 *  previously-read object — the Postgres-backed implementation hands back a
 *  fresh object on every `get`, so mutating it would silently do nothing. */
export interface CodeStore {
  put(record: CodeRecord): Promise<void>;
  get(code: string): Promise<CodeRecord | undefined>;
  /** Every record in `status`, for the Poller's sweep. */
  listByStatus(status: CodeStatus): Promise<CodeRecord[]>;
  all(): Promise<CodeRecord[]>;
  /** The oldest `used`-but-not-yet-`deliveredAt` record, for the local Demo
   *  Server's `/pending-print/next` poll — FIFO, so a backlog prints in the
   *  order visitors actually finished. `undefined` when nothing's waiting. */
  nextPendingPrint(): Promise<CodeRecord | undefined>;
}
