import type { CodeRecord, CodeStatus } from "./types.js";
import type { CodeStore } from "./codeStore.js";

/** In-memory Store for local dev: every code is lost on restart. The
 *  deployed service uses PostgresStore instead (see storeFactory.ts). */
export class MemoryStore implements CodeStore {
  private codes = new Map<string, CodeRecord>();

  async put(record: CodeRecord): Promise<void> {
    this.codes.set(record.code, record);
  }

  async get(code: string): Promise<CodeRecord | undefined> {
    return this.codes.get(code);
  }

  async listByStatus(status: CodeStatus): Promise<CodeRecord[]> {
    return [...this.codes.values()].filter((record) => record.status === status);
  }

  async all(): Promise<CodeRecord[]> {
    return [...this.codes.values()];
  }

  async nextPendingPrint(): Promise<CodeRecord | undefined> {
    const waiting = [...this.codes.values()]
      .filter((record) => record.status === "used" && record.deliveredAt === undefined)
      .sort((a, b) => (a.usedAt ?? 0) - (b.usedAt ?? 0));
    return waiting[0];
  }
}
