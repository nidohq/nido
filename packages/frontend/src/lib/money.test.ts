import { describe, it, expect } from "vitest";
import {
  xlmToStroops,
  stroopsToXlm,
  rawToDecimal,
  formatDecimal,
  decimalToRaw,
} from "./money";

describe("formatDecimal", () => {
  it("groups exactly, without Number precision loss", () => {
    expect(formatDecimal("12345678901234.5678901")).toBe("12,345,678,901,234.5678901");
    expect(formatDecimal(rawToDecimal(9007199254740993n, 0))).toBe("9,007,199,254,740,993");
  });

  it("truncates the fraction to the display cap", () => {
    expect(formatDecimal("1.123456789")).toBe("1.1234567");
    expect(formatDecimal("1.123456789", { maxFractionDigits: 2 })).toBe("1.12");
  });

  it("renders nonzero dust as a < bound instead of 0", () => {
    expect(formatDecimal(rawToDecimal(1000n, 18))).toBe("<0.0000001");
    expect(formatDecimal("0")).toBe("0");
    expect(formatDecimal("0.0000001")).toBe("0.0000001");
  });

  it("handles negatives and malformed input", () => {
    expect(formatDecimal("-1234.5")).toBe("-1,234.5");
    expect(formatDecimal("abc")).toBe("0");
  });
});

describe("rawToDecimal", () => {
  it("handles arbitrary decimals", () => {
    expect(rawToDecimal(1_500_000n, 6)).toBe("1.5");
    expect(rawToDecimal(123n, 2)).toBe("1.23");
    expect(rawToDecimal(123n, 0)).toBe("123");
    expect(rawToDecimal(0n, 9)).toBe("0");
  });

  it("trims trailing fraction zeros and keeps leading ones", () => {
    expect(rawToDecimal(1_000_000_0n, 7)).toBe("1");
    expect(rawToDecimal(1n, 7)).toBe("0.0000001");
  });

  it("handles negatives", () => {
    expect(rawToDecimal(-15_000_000n, 7)).toBe("-1.5");
  });

  it("backs stroopsToXlm (7 decimals)", () => {
    expect(rawToDecimal(125_000_000n, 7)).toBe(stroopsToXlm(125_000_000n));
  });
});

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

describe("decimalToRaw", () => {
  it("converts with arbitrary decimals (generalizes xlmToStroops)", () => {
    expect(decimalToRaw("1.5", 6)).toBe(1_500_000n);
    expect(decimalToRaw("1.23", 2)).toBe(123n);
    expect(decimalToRaw("123", 0)).toBe(123n);
    expect(decimalToRaw("0", 9)).toBe(0n);
  });

  it("pads the fraction to the token's full precision", () => {
    expect(decimalToRaw("1", 7)).toBe(10_000_000n);
    expect(decimalToRaw("0.0000001", 7)).toBe(1n);
    expect(decimalToRaw("2.5", 18)).toBe(2_500_000_000_000_000_000n);
  });

  it("round-trips with rawToDecimal", () => {
    expect(decimalToRaw(rawToDecimal(123_456_789n, 6), 6)).toBe(123_456_789n);
    expect(rawToDecimal(decimalToRaw("1.234567", 7), 7)).toBe("1.234567");
  });

  it("rejects more fraction digits than the token allows", () => {
    expect(() => decimalToRaw("1.123", 2)).toThrow();
    expect(() => decimalToRaw("1.1", 0)).toThrow();
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "abc", "1.2.3", "-1", ".5", "1.", "1e3"]) {
      expect(() => decimalToRaw(bad, 7)).toThrow();
    }
  });

  it("trims surrounding whitespace", () => {
    expect(decimalToRaw("  2.5  ", 7)).toBe(25_000_000n);
  });

  it("agrees with xlmToStroops at 7 decimals", () => {
    expect(decimalToRaw("12.5000000", 7)).toBe(xlmToStroops("12.5000000"));
  });
});
