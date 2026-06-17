import type { AssetCandidate } from "./types.js";

// Cap the persisted set so a hostile token spray can't grow localStorage (and
// the balance probe) without bound.
const MAX_STORED = 100;

const storageKey = (account: string) => `nido:assets:known:${account}`;

/**
 * Tokens this browser has confirmed the account holds. Event discovery only
 * reaches ~1 day back per load (and RPC retention caps it at ~7 days), so
 * persisting confirmed finds is what keeps a long-held token on the list
 * after its transfers age out of the window.
 */
export function loadKnownAssets(account: string): AssetCandidate[] {
  try {
    const raw = localStorage.getItem(storageKey(account));
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((a): a is AssetCandidate => typeof (a as AssetCandidate)?.contractId === "string")
      .map((a) => ({ ...a, source: "stored" as const }));
  } catch {
    return [];
  }
}

/**
 * Overwrite the persisted set with `assets` (the caller passes exactly the
 * currently-confirmed holdings, so sold or junk tokens prune themselves on
 * the next successful load).
 */
export function replaceKnownAssets(account: string, assets: AssetCandidate[]): void {
  try {
    const byId = new Map(assets.map((a) => [a.contractId, a]));
    localStorage.setItem(
      storageKey(account),
      JSON.stringify([...byId.values()].slice(0, MAX_STORED)),
    );
  } catch {
    /* storage full/blocked — discovery just won't persist */
  }
}
