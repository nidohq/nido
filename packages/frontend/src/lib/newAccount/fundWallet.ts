/**
 * The new-account page's "Finalizing your wallet" step: get the relayer's
 * one-time top-up into the new account, resumably.
 *
 * A retry picks up where the last attempt stopped: it waits on the top-up
 * already sent (`progress.hash`) and then, if the account still holds no
 * XLM, re-asks the relayer. The funder's once-per-destination record
 * (infra/relayer/plugins/funder/fundOnce.ts) is what stops a second payment:
 * it hands back the same hash while that top-up can still land, and sends a
 * fresh one only once it provably can't, so a dropped top-up doesn't strand
 * the step.
 */

/** The relayer's /fund answer (the funder plugin's FundResult). */
export interface FundResponse {
  hash: string | null;
  status?: string;
  alreadyFunded?: boolean;
}

export type TopUpStatus = "SUCCESS" | "FAILED" | "NOT_FOUND";

export interface FundWalletDeps {
  /** POST /fund. Throws on an HTTP or plugin error. */
  requestFunding(destination: string): Promise<FundResponse>;
  /** The top-up's on-chain status. May throw (a flaky RPC); polling retries. */
  topUpStatus(hash: string): Promise<TopUpStatus>;
  /** The account's native balance in stroops. May throw. */
  nativeBalance(destination: string): Promise<bigint>;
  sleep(ms: number): Promise<void>;
}

/** Carried across retries of the step on one page. */
export interface FundingProgress {
  hash: string | null;
}

export type FundingOutcome = "funded" | "already-funded";

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 1000;

export class FundingStillConfirming extends Error {
  constructor() {
    super("Your wallet's top-up is still confirming. Try again in a moment.");
    this.name = "FundingStillConfirming";
  }
}

export async function fundWallet(
  destination: string,
  progress: FundingProgress,
  deps: FundWalletDeps,
): Promise<FundingOutcome> {
  if (progress.hash) {
    const status = await waitForTopUp(progress.hash, deps);
    if (status === "SUCCESS") return "funded";
    if (status === "FAILED") progress.hash = null;
  }

  // A fresh account holds no XLM, so any balance means a top-up landed.
  if ((await readBalance(destination, deps)) > 0n) return "already-funded";

  const pending = progress.hash;
  const resp = await deps.requestFunding(destination);
  if (!resp.hash) {
    if (resp.alreadyFunded) return "already-funded";
    throw new Error("Funding succeeded but returned no transaction hash");
  }
  progress.hash = resp.hash;
  if (resp.status === "SUCCESS") return resp.alreadyFunded ? "already-funded" : "funded";
  if (resp.hash === pending) throw new FundingStillConfirming();

  const status = await waitForTopUp(resp.hash, deps);
  if (status === "SUCCESS") return resp.alreadyFunded ? "already-funded" : "funded";
  if (status === "FAILED") {
    progress.hash = null;
    throw new Error("Funding transaction did not complete: FAILED");
  }
  if ((await readBalance(destination, deps)) > 0n) return "funded";
  throw new FundingStillConfirming();
}

/** Poll until the top-up settles or the attempts run out (NOT_FOUND). */
async function waitForTopUp(hash: string, deps: FundWalletDeps): Promise<TopUpStatus> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) await deps.sleep(POLL_INTERVAL_MS);
    try {
      const status = await deps.topUpStatus(hash);
      if (status !== "NOT_FOUND") return status;
    } catch {
      // A failed read says nothing about the top-up; keep polling.
    }
  }
  return "NOT_FOUND";
}

async function readBalance(destination: string, deps: FundWalletDeps): Promise<bigint> {
  try {
    return await deps.nativeBalance(destination);
  } catch {
    // Unknown counts as unfunded: the relayer's own once-per-account record
    // still stops a second payment.
    return 0n;
  }
}
