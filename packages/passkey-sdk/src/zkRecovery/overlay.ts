//! Advisory, non-authoritative client-side staging for a pending ZK
//! recovery, namespaced per-account in `localStorage`. This is a UX
//! convenience only (e.g. "you have a recovery pending, executable after
//! <time>") -- nothing here is ever consulted for correctness or security;
//! the contract's own state (spec §3.3) is the only authority on whether a
//! recovery is pending/executable. Every access is guarded so this module
//! is a safe no-op in SSR/Node contexts where `localStorage` doesn't exist.
//!
//! NO SECRETS: only the new pubkey (public by construction) and plain
//! timestamps are ever written here -- never a mnemonic, seed, signature,
//! or derived recovery secret.

// Ambient, minimal storage shape (this package's `tsconfig.json` has no DOM
// lib, so the real `Storage`/`localStorage` globals aren't typed) -- a
// module-local type-only declaration, erased at compile time, matching the
// pattern `storage.ts` already uses for the same reason. Unlike
// `storage.ts`, every access here is guarded via `typeof localStorage ===
// 'undefined'` (safe even when the identifier was never declared/assigned
// at all, per the language spec's `typeof`-on-unresolvable-reference
// carve-out) before this binding is ever touched.
declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
type MinimalStorage = typeof localStorage;

const NAMESPACE = 'nido:zkrecovery';

/** Non-secret, advisory recovery-in-progress state for one account. */
export interface StagedRecovery {
  /** Hex-encoded 65-byte SEC1 uncompressed P-256 key the recovery will install (public). */
  newPubkey65Hex: string;
  /** Unix seconds when `initiate_recovery` was submitted. */
  initiatedAt: number;
  /** Unix seconds after which the recovery becomes executable (timelock maturity). */
  executableAfter: number;
}

function storageKey(account: string): string {
  return `${NAMESPACE}:${account}`;
}

/**
 * Returns the global `localStorage` if one exists and is usable, or
 * `undefined` otherwise (SSR/Node, or an environment that throws on access
 * e.g. some browsers' privacy modes) -- every public function here funnels
 * through this so no call site can accidentally assume storage exists.
 */
function getStorage(): MinimalStorage | undefined {
  try {
    if (typeof localStorage === 'undefined') {
      return undefined;
    }
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Stages (overwrites) the advisory recovery record for `account`. No-ops if `localStorage` is unavailable. */
export function stageRecovery(account: string, staged: StagedRecovery): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(account), JSON.stringify(staged));
  } catch {
    // Advisory only -- a write failure (quota, disabled storage) is not fatal.
  }
}

/** Reads the advisory recovery record for `account`, or `null` if none is staged / storage is unavailable / the record is malformed. */
export function readStaged(account: string): StagedRecovery | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(account));
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as StagedRecovery;
  } catch {
    return null;
  }
}

/** Clears the advisory recovery record for `account`. No-ops if `localStorage` is unavailable. */
export function clearStaged(account: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(account));
  } catch {
    // Advisory only.
  }
}
