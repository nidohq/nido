// Per-account "last used" timestamps, used only to default the multi-account
// claim picker. Best-effort UX nicety — local-only, never correctness-critical.
import { nidoKey } from "@nidohq/passkey-sdk";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

const prefix = () => nidoKey("lastUsed:");

function storageOrNull(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Record that `contractId` was just used (default: now). */
export function markUsed(
  contractId: string,
  store: StorageLike | null = storageOrNull(),
  now: number = Date.now(),
): void {
  if (!store) return;
  try {
    store.setItem(`${prefix()}${contractId}`, String(now));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Read all recency timestamps as a `{ contractId: epochMs }` record. */
export function readLastUsed(store: StorageLike | null = storageOrNull()): Record<string, number> {
  if (!store) return {};
  const out: Record<string, number> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(prefix())) continue;
    const raw = store.getItem(key);
    const ts = raw ? Number(raw) : NaN;
    if (Number.isFinite(ts)) out[key.slice(prefix().length)] = ts;
  }
  return out;
}
