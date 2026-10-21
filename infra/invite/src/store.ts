import type { CodeRecord, CodeStatus } from "./types.js";

/** In-memory Store for the spike: fine for a single Fly instance over the
 *  span of a demo event, but every code is lost on restart/redeploy. Swap
 *  for Redis (infra/relayer-redis already runs one) or SQLite before this
 *  needs to survive beyond a single session. */
export class Store {
  private codes = new Map<string, CodeRecord>();

  put(record: CodeRecord): void {
    this.codes.set(record.code, record);
  }

  get(code: string): CodeRecord | undefined {
    return this.codes.get(code);
  }

  /** Every record in `status`, for the Poller's sweep. */
  listByStatus(status: CodeStatus): CodeRecord[] {
    return [...this.codes.values()].filter((record) => record.status === status);
  }

  all(): CodeRecord[] {
    console.log("this.codes ", this.codes)
    return [...this.codes.values()];
  }
}
