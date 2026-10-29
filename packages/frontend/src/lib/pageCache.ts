// Read-only page data that survives navigation between wallet pages.
//
// Astro full-reloads on every navigation, so module-level memos (curated
// lists, resolveAccountAddress) live one page view. Switching Home → Activity
// → Home used to re-run every balance, asset and activity read and replay the
// skeleton animation for data that was on screen a second ago (issue #346).
//
// Entries live in sessionStorage — per origin, so per account subdomain, and
// per tab — under nidoKey, so per network too. Only DISPLAY reads belong here
// (balances, holdings, activity rows). Anything a decision is made against —
// context rules, signers, recovery state, the transfer form's spendable
// balances — stays a live read.
import { nidoKey } from "@nidohq/passkey-sdk";

/** Younger than this, a cached read is shown and not refetched at all. */
export const FRESH_MS = 30_000;
/** Up to this age it is shown immediately and refreshed quietly in the
 *  background; older entries are ignored (skeleton + fresh load). */
export const MAX_AGE_MS = 10 * 60_000;

const PREFIX = "cache:";

interface Entry {
  at: number;
  v: unknown;
}

// bigint (token balances) has no JSON form; tag it so it round-trips.
const replacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? { $bigint: v.toString() } : v;
const reviver = (_k: string, v: unknown) =>
  v && typeof v === "object" && typeof (v as { $bigint?: unknown }).$bigint === "string"
    ? BigInt((v as { $bigint: string }).$bigint)
    : v;

export function readPageCache<T>(key: string, now = Date.now()): { value: T; fresh: boolean } | null {
  try {
    const raw = sessionStorage.getItem(nidoKey(PREFIX + key));
    if (!raw) return null;
    const entry = JSON.parse(raw, reviver) as Entry;
    const age = now - entry.at;
    if (typeof entry.at !== "number" || age < 0 || age > MAX_AGE_MS) return null;
    return { value: entry.v as T, fresh: age < FRESH_MS };
  } catch {
    return null;
  }
}

export function writePageCache(key: string, value: unknown, now = Date.now()): void {
  try {
    sessionStorage.setItem(nidoKey(PREFIX + key), JSON.stringify({ at: now, v: value }, replacer));
  } catch {
    /* storage full/blocked — the next page just loads fresh */
  }
}

/** Drop every cached read on this origin. Called around the account's own
 *  writes so the next page shows post-transaction state, not the old one. */
export function clearPageCache(): void {
  try {
    const prefix = nidoKey(PREFIX);
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* storage blocked — nothing was cached either */
  }
}

// Two widgets reading the same key on one page (the hero balance and the
// switcher row for the current account) share one request.
const inflight = new Map<string, Promise<unknown>>();

/**
 * Stale-while-revalidate read. A cached value is rendered synchronously,
 * before this returns its promise; if it is fresh nothing else happens.
 * Otherwise `load` runs, its result is cached and rendered again.
 *
 * Rejects only when there was nothing cached to show — a failed background
 * refresh leaves the cached render in place, so callers keep their existing
 * error UI for the cold case alone.
 */
export function cachedRead<T>(key: string, load: () => Promise<T>, render: (value: T) => void): Promise<void> {
  const hit = readPageCache<T>(key);
  if (hit) render(hit.value);
  if (hit?.fresh) return Promise.resolve();
  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = load().then((value) => {
      writePageCache(key, value);
      return value;
    });
    inflight.set(key, pending);
    void pending.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    );
  }
  return pending.then(render, (err) => {
    if (!hit) throw err;
  });
}

/** The XLM balance key, shared by the account hero and the switcher rows. */
export const xlmBalanceKey = (account: string) => `balance:xlm:${account}`;
