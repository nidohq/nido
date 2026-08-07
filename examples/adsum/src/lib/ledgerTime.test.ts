import { describe, expect, it } from "vitest"
import {
	dateForLedger,
	formatLedgerCountdown,
	ledgerForDate,
} from "./ledgerTime"

const now = new Date("2026-07-10T00:00:00Z")

describe("ledgerTime", () => {
	it("converts a future date to a ledger (5s per ledger, rounded up)", () => {
		const in1h = new Date(now.getTime() + 3600_000)
		expect(ledgerForDate(in1h, 1000, now)).toBe(1000 + 720)
	})
	it("roundtrips approximately", () => {
		const d = dateForLedger(1720, 1000, now)
		expect(d.getTime()).toBe(now.getTime() + 720 * 5000)
	})
	it("humanizes", () => {
		expect(formatLedgerCountdown(1000 + 17280, 1000)).toMatch(/day/)
		expect(formatLedgerCountdown(999, 1000)).toBe("closed")
	})
})
