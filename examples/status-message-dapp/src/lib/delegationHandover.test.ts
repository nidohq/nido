import { describe, it, expect } from "vitest"
import {
	readDelegationReturn,
	writePendingDelegation,
	consumePendingDelegation,
	markAutoStartDelegation,
	consumeAutoStartDelegation,
	shouldAutoStartDelegation,
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

describe("shouldAutoStartDelegation", () => {
	it("starts when the connected account matches the flagged one and has no session key", () => {
		expect(
			shouldAutoStartDelegation({
				account: "CABC",
				flaggedAccount: "CABC",
				hasSessionKey: false,
			}),
		).toBe(true)
	})

	it("does NOT start when the account already has a session key", () => {
		expect(
			shouldAutoStartDelegation({
				account: "CABC",
				flaggedAccount: "CABC",
				hasSessionKey: true,
			}),
		).toBe(false)
	})

	it("does NOT start when nothing was flagged (reload / restored session)", () => {
		expect(
			shouldAutoStartDelegation({
				account: "CABC",
				flaggedAccount: null,
				hasSessionKey: false,
			}),
		).toBe(false)
	})

	it("does NOT start when the flagged account differs from the connected one", () => {
		expect(
			shouldAutoStartDelegation({
				account: "CABC",
				flaggedAccount: "CDEF",
				hasSessionKey: false,
			}),
		).toBe(false)
	})

	it("does NOT start when no account is connected", () => {
		expect(
			shouldAutoStartDelegation({
				account: null,
				flaggedAccount: "CABC",
				hasSessionKey: false,
			}),
		).toBe(false)
	})
})

describe("auto-start flag round-trip", () => {
	it("mark then consume returns the account exactly once (single-use)", () => {
		const store = fakeStore()
		markAutoStartDelegation("CABC", store)
		expect(consumeAutoStartDelegation(store)).toBe("CABC")
		// Consumed before the redirect — a cancelled return can't re-trigger
		// delegation, so there's no redirect loop.
		expect(consumeAutoStartDelegation(store)).toBe(null)
	})

	it("consume returns null when nothing was flagged", () => {
		const store = fakeStore()
		expect(consumeAutoStartDelegation(store)).toBe(null)
	})
})
