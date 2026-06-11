import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
	material: null as null | { credentialId: string; publicKey: string },
	forgotten: [] as Array<[string, string]>,
}))

const chain = vi.hoisted(() => ({
	ruleId: null as number | null,
	seenPubkey: null as string | null,
}))

vi.mock("@g2c/passkey-sdk", () => ({
	loadSessionKeyMaterial: vi.fn(() => sdk.material),
	forgetSessionKeyMaterial: vi.fn((account: string, target: string) => {
		sdk.forgotten.push([account, target])
	}),
}))

vi.mock("./policyChainFetch", () => ({
	findRuleForPubkey: vi.fn(async (_account: string, pubkey: string) => {
		chain.seenPubkey = pubkey
		return chain.ruleId
	}),
}))

import { checkSessionKeyStatus } from "./sessionKeyStatus"

describe("checkSessionKeyStatus", () => {
	beforeEach(() => {
		sdk.material = null
		sdk.forgotten = []
		chain.ruleId = null
		chain.seenPubkey = null
	})

	it("reports missing when the dApp has no local session material", async () => {
		await expect(checkSessionKeyStatus("CACCOUNT", "CTARGET")).resolves.toBe(
			"missing",
		)
		expect(sdk.forgotten).toEqual([])
		expect(chain.seenPubkey).toBeNull()
	})

	it("reports live when the local public key is still installed on-chain", async () => {
		sdk.material = { credentialId: "cred-1", publicKey: "abcd" }
		chain.ruleId = 4

		await expect(checkSessionKeyStatus("CACCOUNT", "CTARGET")).resolves.toBe(
			"live",
		)
		expect(chain.seenPubkey).toBe("abcd")
		expect(sdk.forgotten).toEqual([])
	})

	it("purges stale local material when the on-chain rule was revoked", async () => {
		sdk.material = { credentialId: "cred-1", publicKey: "abcd" }
		chain.ruleId = null

		await expect(checkSessionKeyStatus("CACCOUNT", "CTARGET")).resolves.toBe(
			"revoked",
		)
		expect(sdk.forgotten).toEqual([["CACCOUNT", "CTARGET"]])
	})
})
