import { describe, it, expect } from "vitest"
import {
	readDelegationReturn,
	writePendingDelegation,
	consumePendingDelegation,
	type DelegationStorage,
} from "./delegationHandover"

function fakeStore(): DelegationStorage {
	const map = new Map<string, string>()
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
	}
}

describe("readDelegationReturn", () => {
	it("recognises ok / cancelled and ignores everything else", () => {
		expect(readDelegationReturn("?delegation=ok")).toBe("ok")
		expect(readDelegationReturn("?delegation=cancelled")).toBe("cancelled")
		expect(readDelegationReturn("?delegation=bogus")).toBe(null)
		expect(readDelegationReturn("?contract=CABC")).toBe(null)
		expect(readDelegationReturn("")).toBe(null)
	})
})

describe("pending delegation round-trip", () => {
	it("write then consume returns the record exactly once (single-use)", () => {
		const store = fakeStore()
		writePendingDelegation({ account: "CABC", target: "CDEF", label: "demo" }, store)
		expect(consumePendingDelegation(store)).toEqual({
			account: "CABC",
			target: "CDEF",
			label: "demo",
		})
		// Consumed — a second read is empty, so a reload can't re-fill the form.
		expect(consumePendingDelegation(store)).toBe(null)
	})

	it("treats a corrupt entry as absent", () => {
		const store = fakeStore()
		store.setItem("g2c:pendingDelegation", "{ not json")
		expect(consumePendingDelegation(store)).toBe(null)
	})

	it("rejects a record missing required fields", () => {
		const store = fakeStore()
		store.setItem("g2c:pendingDelegation", JSON.stringify({ account: "CABC" }))
		expect(consumePendingDelegation(store)).toBe(null)
	})
})
