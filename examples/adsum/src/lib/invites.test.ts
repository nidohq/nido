import { beforeEach, describe, expect, it } from "vitest"

/**
 * A minimal in-memory `Storage` stub, so this test can run on node (no
 * jsdom) while still exercising `inviteStore`'s real localStorage calls.
 */
function makeFakeStorage(): Storage {
	const store = new Map<string, string>()
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value)
		},
		removeItem: (key: string) => {
			store.delete(key)
		},
		clear: () => {
			store.clear()
		},
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		get length() {
			return store.size
		},
	}
}

globalThis.localStorage = makeFakeStorage()

const { inviteStore } = await import("./invites")

function invite(
	overrides: Partial<Parameters<typeof inviteStore.add>[0]> = {},
) {
	return {
		seedHex: "a".repeat(64),
		pubkeyHex: "b".repeat(64),
		label: "for Alice",
		createdAt: 1000,
		...overrides,
	}
}

beforeEach(() => {
	globalThis.localStorage.clear()
})

describe("inviteStore", () => {
	it("list() is empty when nothing has been stored", () => {
		expect(inviteStore.list()).toEqual([])
	})

	it("add() then list() roundtrips the stored invite", () => {
		const inv = invite()
		inviteStore.add(inv)
		expect(inviteStore.list()).toEqual([inv])
	})

	it("add() replaces an existing entry with the same pubkeyHex", () => {
		inviteStore.add(invite({ label: "first" }))
		inviteStore.add(invite({ label: "second" }))

		const all = inviteStore.list()
		expect(all).toHaveLength(1)
		expect(all[0]?.label).toBe("second")
	})

	it("add() accumulates distinct invites", () => {
		inviteStore.add(invite({ pubkeyHex: "b".repeat(64) }))
		inviteStore.add(invite({ pubkeyHex: "c".repeat(64) }))

		expect(inviteStore.list().map((i) => i.pubkeyHex)).toEqual([
			"b".repeat(64),
			"c".repeat(64),
		])
	})

	it("remove() drops the matching invite, leaving others", () => {
		inviteStore.add(invite({ pubkeyHex: "b".repeat(64) }))
		inviteStore.add(invite({ pubkeyHex: "c".repeat(64) }))

		inviteStore.remove("b".repeat(64))

		expect(inviteStore.list().map((i) => i.pubkeyHex)).toEqual(["c".repeat(64)])
	})

	it("remove() is a no-op for an unknown pubkeyHex", () => {
		inviteStore.add(invite())
		inviteStore.remove("nope".repeat(16))
		expect(inviteStore.list()).toHaveLength(1)
	})

	it("list() tolerates corrupted storage by returning an empty array", () => {
		globalThis.localStorage.setItem("adsum:invites", "not json")
		expect(inviteStore.list()).toEqual([])
	})
})
