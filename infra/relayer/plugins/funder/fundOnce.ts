/**
 * Once-per-destination funding: the guard that keeps a retried /fund (a
 * client retry, a reload, two tabs) from paying the same account twice.
 *
 * A destination gets a KV record before its top-up is sent, keyed by the
 * address and holding the signed transaction's hash. While the record
 * stands, every later request answers `alreadyFunded` with that hash instead
 * of submitting again. The record is dropped only when the chain shows the
 * top-up can never land: it FAILED, or its validity window closed inside
 * the RPC's retained history without it appearing. A destination whose
 * balance already covers a top-up is recorded as funded with no hash.
 *
 * Kept free of runtime imports so it is unit-testable outside the relayer
 * image; index.ts wires the real KV store, RPC and signer.
 */

/** The KV record for a destination we have funded (or found funded). */
export interface FundedRecord {
  /** Hash of the top-up we signed, or null when the balance was already enough. */
  hash: string | null;
  /** Unix seconds the record was written (the earliest the top-up could land). */
  submittedAt: number;
  /** Unix seconds after which the top-up can no longer land (its timebound). */
  validUntil: number;
}

/** What the RPC says about a recorded top-up. Close times are unix seconds. */
export type TopUpLookup =
  | { status: "SUCCESS" }
  | { status: "FAILED" }
  | { status: "NOT_FOUND"; latestLedgerCloseTime: number; oldestLedgerCloseTime: number };

/** A signed top-up, not yet submitted. */
export interface PreparedTopUp {
  hash: string;
  validUntil: number;
  /**
   * Submit it. Resolves `{ accepted: false }` only when the RPC refused it
   * outright (it can't land); throws when the outcome is unknown.
   */
  send(): Promise<{ accepted: true } | { accepted: false; reason: string }>;
}

/** The slice of the relayer's PluginKVStore this uses. */
export interface FundKV {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ttlSec?: number }): Promise<boolean>;
  del(key: string): Promise<boolean>;
  withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number; onBusy?: "throw" | "skip" },
  ): Promise<T | null>;
}

export interface FundOnceDeps {
  kv: FundKV;
  topUpStroops: bigint;
  nativeBalance(destination: string): Promise<bigint>;
  lookupTopUp(hash: string): Promise<TopUpLookup>;
  prepareTopUp(destination: string): Promise<PreparedTopUp>;
  /** Unix seconds. */
  now(): number;
}

/**
 * The plugin's answer. `alreadyFunded` with a hash: poll that hash (status
 * says whether it has landed). `alreadyFunded` with no hash: nothing to wait
 * for, the account holds its balance. Not `alreadyFunded`: a fresh top-up.
 */
export type FundResult =
  | { alreadyFunded: false; hash: string; status: "PENDING" }
  | { alreadyFunded: true; hash: string; status: "SUCCESS" | "PENDING" }
  | { alreadyFunded: true; hash: null; status: "FUNDED" };

// Covers prepare (simulation retries) plus send, inside the plugin's 30s timeout.
const LOCK_TTL_SEC = 30;

export const fundedKey = (destination: string) => `funded:${destination}`;
const lockKey = (destination: string) => `fund-lock:${destination}`;

export async function fundOnce(destination: string, deps: FundOnceDeps): Promise<FundResult> {
  const result = await deps.kv.withLock(lockKey(destination), () => fundUnderLock(destination, deps), {
    ttlSec: LOCK_TTL_SEC,
    onBusy: "skip",
  });
  if (result === null) {
    throw new Error("A top-up for this account is already in progress; try again in a moment.");
  }
  return result;
}

async function fundUnderLock(destination: string, deps: FundOnceDeps): Promise<FundResult> {
  const { kv } = deps;
  const key = fundedKey(destination);

  const record = await kv.get<FundedRecord>(key);
  if (record) {
    const standing = await recordStands(record, deps);
    if (standing) return standing;
    await kv.del(key);
  }

  if ((await deps.nativeBalance(destination)) >= deps.topUpStroops) {
    const now = deps.now();
    await kv.set(key, { hash: null, submittedAt: now, validUntil: now } satisfies FundedRecord);
    return { alreadyFunded: true, hash: null, status: "FUNDED" };
  }

  const topUp = await deps.prepareTopUp(destination);
  // Recorded before it is sent: if send() dies mid-flight the top-up may
  // still land, and the next request must find it rather than pay again.
  await kv.set(key, {
    hash: topUp.hash,
    submittedAt: deps.now(),
    validUntil: topUp.validUntil,
  } satisfies FundedRecord);

  const sent = await topUp.send();
  if (!sent.accepted) {
    await kv.del(key);
    throw new Error(`Funding transaction failed: ${sent.reason}`);
  }
  return { alreadyFunded: false, hash: topUp.hash, status: "PENDING" };
}

/** The answer an existing record gives, or null when its top-up can never land. */
async function recordStands(record: FundedRecord, deps: FundOnceDeps): Promise<FundResult | null> {
  if (record.hash === null) return { alreadyFunded: true, hash: null, status: "FUNDED" };

  const tx = await deps.lookupTopUp(record.hash);
  if (tx.status === "SUCCESS") return { alreadyFunded: true, hash: record.hash, status: "SUCCESS" };
  if (tx.status === "FAILED") return null;

  // NOT_FOUND: a ledger closing at or before validUntil can still include it.
  if (tx.latestLedgerCloseTime <= record.validUntil) {
    return { alreadyFunded: true, hash: record.hash, status: "PENDING" };
  }
  // Its window has closed. If the RPC's history reaches back to when it was
  // sent, it would be there had it landed: it never did.
  if (tx.oldestLedgerCloseTime <= record.submittedAt) return null;
  // The history no longer covers it, so whether it landed is unknowable
  // here; keep the account counted as funded rather than risk paying twice.
  return { alreadyFunded: true, hash: null, status: "FUNDED" };
}
