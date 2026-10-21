import type { Store } from "./store.js";
import { accountExists } from "./chain.js";

/** Confirms completion independently of the frontend: a browser that
 *  crashes, closes, or simply never calls back should not leave a code
 *  stuck "claimed" forever, and a malicious client self-reporting success
 *  shouldn't be trusted either. The Poller watches the chain directly for
 *  the address the Checker bound to each claimed code. */
export async function pollOnce(store: Store): Promise<void> {
  const now = Date.now();

  for (const record of store.listByStatus("claimed")) {
    if (now > record.expiresAt) {
      record.status = "expired";
      continue;
    }
    if (!record.address) continue; // shouldn't happen: claimed implies bound
    if (await accountExists(record.address)) {
      record.status = "used";
      record.usedAt = now;
    }
  }

  for (const record of store.listByStatus("issued")) {
    if (now > record.expiresAt) record.status = "expired";
  }
}

export function startPolling(store: Store, intervalMs: number): NodeJS.Timeout {
  return setInterval(() => {
    pollOnce(store).catch((err) => console.error("poll error:", err));
  }, intervalMs);
}
