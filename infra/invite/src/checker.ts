import type { CodeStore } from "./codeStore.js";

export type CheckResult =
  | { ok: true; status: "claimed" }
  | { ok: false; reason: "not_found" | "expired" | "used" | "claimed_by_other" };

/** Validates `code` and atomically binds `address` to it in one step, so two
 *  concurrent requests for the same code can't bind two different addresses
 *  (the same front-running concern the factory's setup-key signature closes
 *  for account creation itself — see contracts/factory). A retry with the
 *  same address the frontend already bound is idempotent. */
export async function checkAndClaim(store: CodeStore, code: string, address: string): Promise<CheckResult> {
  const record = await store.get(code);
  if (!record) return { ok: false, reason: "not_found" };

  if (record.status === "issued" && Date.now() > record.expiresAt) {
    await store.put({ ...record, status: "expired" });
    return { ok: false, reason: "expired" };
  }
  if (record.status === "expired") return { ok: false, reason: "expired" };
  if (record.status === "used") return { ok: false, reason: "used" };

  if (record.status === "claimed") {
    if (record.address !== address) return { ok: false, reason: "claimed_by_other" };
    return { ok: true, status: "claimed" }; // idempotent retry
  }

  // status === "issued" and not expired: first claim.
  await store.put({ ...record, status: "claimed", address, claimedAt: Date.now() });
  return { ok: true, status: "claimed" };
}
