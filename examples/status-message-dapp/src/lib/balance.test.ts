import { describe, it, expect } from "vitest"
import { formatStroops } from "./balance"

describe("formatStroops", () => {
	it("renders whole XLM with no fractional part", () => {
		expect(formatStroops(0n)).toBe("0")
		expect(formatStroops(10_000_000n)).toBe("1")
		expect(formatStroops(120_000_000n)).toBe("12")
	})

	it("renders fractional XLM trimmed to significant stroops", () => {
		// 7 decimals; trailing zeros stripped.
		expect(formatStroops(12_345_678n)).toBe("1.2345678")
		expect(formatStroops(5_000_000n)).toBe("0.5")
		expect(formatStroops(100n)).toBe("0.00001")
		expect(formatStroops(1n)).toBe("0.0000001")
	})

	it("handles amounts larger than 2^53 stroops without precision loss", () => {
		// 1e15 stroops = 100,000,000 XLM — beyond Number.MAX_SAFE_INTEGER as stroops.
		expect(formatStroops(1_000_000_000_000_000n)).toBe("100000000")
	})

	it("renders negative balances with a leading sign", () => {
		expect(formatStroops(-10_000_000n)).toBe("-1")
		expect(formatStroops(-12_345_678n)).toBe("-1.2345678")
	})
})
