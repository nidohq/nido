import type { CodeStore } from "./codeStore.js";
import { accountExists, isFunded } from "./chain.js";

/** Confirms completion independently of the frontend: a browser that
 *  crashes, closes, or simply never calls back should not leave a code
 *  stuck "claimed" forever, and a malicious client self-reporting success
 *  shouldn't be trusted either. The Poller watches the chain directly for
 *  the address the Checker bound to each claimed code. */
export async function pollOnce(store: CodeStore): Promise<void> {
  const now = Date.now();

  for (const record of await store.listByStatus("claimed")) {
    if (now > record.expiresAt) {
      await store.put({ ...record, status: "expired" });
      continue;
    }
    if (!record.address) continue; // shouldn't happen: claimed implies bound
    // Both conditions: deployed AND funded. Deploy alone isn't "ready" — see
    // isFunded()'s doc comment for why printing on deploy alone was handing
    // out receipts before the account actually had a balance.
    if ((await accountExists(record.address)) && (await isFunded(record.address))) {
      await store.put({ ...record, status: "used", usedAt: now });
    }
  }

  for (const record of await store.listByStatus("issued")) {
    if (now > record.expiresAt) await store.put({ ...record, status: "expired" });
  }
}

export function startPolling(store: CodeStore, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    pollOnce(store).catch((err) => console.error("poll error:", err));
  }, intervalMs);
}
