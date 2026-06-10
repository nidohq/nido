import { describe, it, expect } from "vitest";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import {
  PERIOD_LEDGERS,
  PERIOD_LABEL,
  stroopsFromXlm,
  spendingLimitParamsScVal,
} from "./spendingLimitParams";

/** Encode the way the delegate page does: user XLM string + period. */
function encode(xlm: string, period: keyof typeof PERIOD_LEDGERS): xdr.ScVal {
  return spendingLimitParamsScVal(stroopsFromXlm(xlm), PERIOD_LEDGERS[period]);
}

describe("spendingLimitParamsScVal", () => {
  it("encodes {xlm:'5', period:'day'} as an scvMap matching OZ SpendingLimitAccountParams", () => {
    const v = encode("5", "day");
    expect(v.switch()).toBe(xdr.ScValType.scvMap());
    const entries = v.map()!;
    expect(entries.length).toBe(2);

    // #[contracttype] named structs encode as symbol keys in LEXICOGRAPHIC
    // order — period_ledgers < spending_limit. Order is load-bearing: the
    // host rejects unsorted maps.
    expect(entries[0].key().sym().toString()).toBe("period_ledgers");
    expect(entries[1].key().sym().toString()).toBe("spending_limit");

    expect(entries[0].val().switch()).toBe(xdr.ScValType.scvU32());
    expect(entries[0].val().u32()).toBe(17280);

    expect(entries[1].val().switch()).toBe(xdr.ScValType.scvI128());
    expect(scValToNative(entries[1].val())).toBe(50_000_000n);
  });

  it("round-trips through XDR with key order pinned", () => {
    const v = encode("5", "day");
    const decoded = xdr.ScVal.fromXDR(v.toXDR());
    const entries = decoded.map()!;
    expect(entries.map((e) => e.key().sym().toString())).toEqual([
      "period_ledgers",
      "spending_limit",
    ]);
    expect(entries[0].val().u32()).toBe(17280);
    expect(scValToNative(entries[1].val())).toBe(50_000_000n);
  });

  it("maps week and 30d periods to the right ledger counts", () => {
    const week = encode("1", "week");
    expect(week.map()![0].val().u32()).toBe(120960);
    const thirty = encode("1", "30d");
    expect(thirty.map()![0].val().u32()).toBe(518400);
    expect(PERIOD_LEDGERS.day).toBe(17280);
    expect(PERIOD_LEDGERS.week).toBe(120960);
    expect(PERIOD_LEDGERS["30d"]).toBe(518400);
  });

  it("has a human label for every period", () => {
    expect(PERIOD_LABEL.day).toBe("per day");
    expect(PERIOD_LABEL.week).toBe("per week");
    expect(PERIOD_LABEL["30d"]).toBe("per 30 days");
  });
});

describe("stroopsFromXlm", () => {
  it("converts whole and fractional XLM without floats", () => {
    expect(stroopsFromXlm("5")).toBe(50_000_000n);
    expect(stroopsFromXlm("1.2345678")).toBe(12_345_678n);
    expect(stroopsFromXlm("0.0000001")).toBe(1n);
    expect(stroopsFromXlm("9999999")).toBe(99_999_990_000_000n);
  });

  it("rejects zero and negative amounts", () => {
    for (const bad of ["0", "0.0", "0.0000000", "-1", "-0.5"]) {
      expect(() => stroopsFromXlm(bad)).toThrow();
    }
  });

  it("rejects amounts above 9,999,999 XLM", () => {
    expect(() => stroopsFromXlm("10000000")).toThrow();
    expect(() => stroopsFromXlm("9999999.0000001")).toThrow();
  });

  it("rejects malformed decimals and >7 decimal places", () => {
    for (const bad of ["", "abc", "1.2.3", ".5", "1.", "1e3", "1.12345678", "0x10"]) {
      expect(() => stroopsFromXlm(bad)).toThrow();
    }
  });
});
