/**
 * Spending-limit install params for the spending-limit-policy contract.
 *
 * Encodes OpenZeppelin's `SpendingLimitAccountParams { spending_limit: i128
 * stroops, period_ledgers: u32 }` as an `xdr.ScVal` for the `policies` map in
 * `add_context_rule`. The bindings pass an `xdr.ScVal` through untouched, so
 * we hand the host EXACTLY the map the `#[contracttype]` struct expects.
 */
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";
import { xlmToStroops } from "./money";

export type LimitPeriod = "day" | "week" | "30d";

/** Rolling-window length per period choice, in ledgers (~5s each). */
export const PERIOD_LEDGERS: Record<LimitPeriod, number> = {
  day: 17280,
  week: 120960,
  "30d": 518400,
};

export const PERIOD_LABEL: Record<LimitPeriod, string> = {
  day: "per day",
  week: "per week",
  "30d": "per 30 days",
};

/** Highest limit we accept (keeps the i128 amount sane and typo-resistant). */
export const MAX_LIMIT_XLM = 9_999_999n;

/**
 * Parse a user-entered decimal XLM string into stroops for a spending limit.
 *
 * Pure BigInt arithmetic (via {@link xlmToStroops} — no floats), ≤ 7 decimal
 * places, must be strictly positive and at most {@link MAX_LIMIT_XLM} XLM.
 * Throws with a user-presentable message on any violation.
 */
export function stroopsFromXlm(xlm: string): bigint {
  let stroops: bigint;
  try {
    stroops = xlmToStroops(xlm);
  } catch {
    throw new Error(
      `Invalid limit amount "${xlm}" — use a plain decimal with at most 7 decimal places.`,
    );
  }
  if (stroops <= 0n) {
    throw new Error("Limit must be greater than zero.");
  }
  if (stroops > MAX_LIMIT_XLM * 10_000_000n) {
    throw new Error(`Limit must be at most ${MAX_LIMIT_XLM.toLocaleString("en-US")} XLM.`);
  }
  return stroops;
}

/**
 * ScVal for OZ `SpendingLimitAccountParams` — `#[contracttype]` named structs
 * encode as `scvMap` with symbol keys in lexicographic order
 * (`period_ledgers` < `spending_limit`). Key order is load-bearing: the
 * Soroban host rejects unsorted maps when decoding into the struct.
 */
export function spendingLimitParamsScVal(
  stroops: bigint,
  periodLedgers: number,
): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("period_ledgers"),
      val: xdr.ScVal.scvU32(periodLedgers),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("spending_limit"),
      val: nativeToScVal(stroops, { type: "i128" }),
    }),
  ]);
}
