import { describe, it, expect } from "vitest";
import { xlmToStroops, stroopsToXlm } from "./money";

describe("xlmToStroops", () => {
  it("converts whole numbers", () => {
    expect(xlmToStroops("10")).toBe(100_000_000n);
    expect(xlmToStroops("1")).toBe(10_000_000n);
    expect(xlmToStroops("0")).toBe(0n);
  });

  it("converts fractional amounts up to 7 dp", () => {
    expect(xlmToStroops("1.5")).toBe(15_000_000n);
    expect(xlmToStroops("0.0000001")).toBe(1n);
    expect(xlmToStroops("1.234567")).toBe(12_345_670n);
    expect(xlmToStroops("12.5000000")).toBe(125_000_000n);
  });

  it("trims surrounding whitespace", () => {
    expect(xlmToStroops("  2.5  ")).toBe(25_000_000n);
  });

  it("rejects more than 7 decimal places", () => {
    expect(() => xlmToStroops("1.12345678")).toThrow();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "1.2.3", "-1", ".5", "1.", "1e3"]) {
      expect(() => xlmToStroops(bad)).toThrow();
    }
  });

  it("round-trips with stroopsToXlm", () => {
    expect(stroopsToXlm(xlmToStroops("1.234567"))).toBe("1.234567");
    expect(xlmToStroops(stroopsToXlm(98_765_432n))).toBe(98_765_432n);
  });
});
