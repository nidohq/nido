import { Buffer } from "buffer"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClient = vi.hoisted(() => ({
	vouches_given: vi.fn(),
	vouches_received: vi.fn(),
	has_vouched: vi.fn(),
	get_pre_vouch: vi.fn(),
	vouch: vi.fn(),
	revoke: vi.fn(),
	pre_vouch: vi.fn(),
	claim_vouch: vi.fn(),
	options: { contractId: "CCONTRACTFIXTURE" },
}))

const mockSignClaim = vi.hoisted(() => vi.fn())

vi.mock("../contracts/web_of_trust", () => ({ default: mockClient }))
vi.mock("../util/wallet", () => ({ wallet: { signTransaction: vi.fn() } }))
vi.mock("./claimPayload", () => ({ signClaim: mockSignClaim }))

const {
	fetchVouchesGiven,
	fetchVouchesReceived,
	hasVouched,
	fetchPreVouch,
	vouchFor,
	revokeVouch,
	createPreVouch,
	claimVouch,
} = await import("./trust")

function rawPreVouch(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		from: "GFROM",
		expires: undefined,
		max_claims: 3,
		claims: 0,
		...overrides,
	}
}

function okResult<T>(value: T) {
	return { isOk: () => true, isErr: () => false, unwrap: () => value }
}

function errResult(message: string) {
	return {
		isOk: () => false,
		isErr: () => true,
		unwrapErr: () => ({ message }),
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe("fetchVouchesGiven", () => {
	it("returns the address list from vouches_given", async () => {
		mockClient.vouches_given.mockResolvedValue({ result: ["GA", "GB"] })

		expect(await fetchVouchesGiven("GFROM")).toEqual(["GA", "GB"])
		expect(mockClient.vouches_given).toHaveBeenCalledWith({ a: "GFROM" })
	})
})

describe("fetchVouchesReceived", () => {
	it("returns the address list from vouches_received", async () => {
		mockClient.vouches_received.mockResolvedValue({ result: ["GC"] })

		expect(await fetchVouchesReceived("GTO")).toEqual(["GC"])
		expect(mockClient.vouches_received).toHaveBeenCalledWith({ a: "GTO" })
	})
})

describe("hasVouched", () => {
	it("returns the boolean from has_vouched", async () => {
		mockClient.has_vouched.mockResolvedValue({ result: true })

		expect(await hasVouched("GFROM", "GTO")).toBe(true)
		expect(mockClient.has_vouched).toHaveBeenCalledWith({
			from: "GFROM",
			to: "GTO",
		})
	})
})

describe("fetchPreVouch", () => {
	it("maps a PreVouch, converting Option expires to null", async () => {
		mockClient.get_pre_vouch.mockResolvedValue({ result: rawPreVouch() })

		const view = await fetchPreVouch("ab".repeat(32))

		expect(view).toEqual({
			from: "GFROM",
			expires: null,
			maxClaims: 3,
			claims: 0,
		})
		expect(mockClient.get_pre_vouch).toHaveBeenCalledWith({
			key: Buffer.from("ab".repeat(32), "hex"),
		})
	})

	it("passes through a defined expires as a number", async () => {
		mockClient.get_pre_vouch.mockResolvedValue({
			result: rawPreVouch({ expires: 5000, claims: 2 }),
		})

		const view = await fetchPreVouch("cd".repeat(32))

		expect(view?.expires).toBe(5000)
		expect(view?.claims).toBe(2)
	})

	it("returns null when no pre-vouch exists", async () => {
		mockClient.get_pre_vouch.mockResolvedValue({ result: undefined })

		expect(await fetchPreVouch("ef".repeat(32))).toBeNull()
	})
})

describe("vouchFor", () => {
	it("signs and sends on success", async () => {
		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.vouch.mockResolvedValue({
			result: okResult(undefined),
			signAndSend,
		})

		const result = await vouchFor("GFROM", "GTO")

		expect(mockClient.vouch).toHaveBeenCalledWith(
			{ from: "GFROM", to: "GTO" },
			{ publicKey: "GFROM" },
		)
		expect(result.submittedByWallet).toBe(false)
		expect(result.hash).toBe("tx-hash")
	})

	it("throws on a contract-level error without signing", async () => {
		const signAndSend = vi.fn()
		mockClient.vouch.mockResolvedValue({
			result: errResult("SelfVouch"),
			signAndSend,
		})

		await expect(vouchFor("GFROM", "GFROM")).rejects.toThrow("SelfVouch")
		expect(signAndSend).not.toHaveBeenCalled()
	})
})

describe("revokeVouch", () => {
	it("signs and sends on success", async () => {
		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.revoke.mockResolvedValue({
			result: okResult(undefined),
			signAndSend,
		})

		const result = await revokeVouch("GFROM", "GTO")

		expect(mockClient.revoke).toHaveBeenCalledWith(
			{ from: "GFROM", to: "GTO" },
			{ publicKey: "GFROM" },
		)
		expect(result.submittedByWallet).toBe(false)
	})

	it("throws on a contract-level error without signing", async () => {
		const signAndSend = vi.fn()
		mockClient.revoke.mockResolvedValue({
			result: errResult("VouchNotFound"),
			signAndSend,
		})

		await expect(revokeVouch("GFROM", "GTO")).rejects.toThrow("VouchNotFound")
		expect(signAndSend).not.toHaveBeenCalled()
	})
})

describe("createPreVouch", () => {
	it("maps expires/maxClaims and signs/sends on success", async () => {
		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.pre_vouch.mockResolvedValue({
			result: okResult(undefined),
			signAndSend,
		})

		const result = await createPreVouch("GFROM", "ab".repeat(32), 5000, 3)

		expect(mockClient.pre_vouch).toHaveBeenCalledWith(
			{
				from: "GFROM",
				key: Buffer.from("ab".repeat(32), "hex"),
				expires: 5000,
				max_claims: 3,
			},
			{ publicKey: "GFROM" },
		)
		expect(result.submittedByWallet).toBe(false)
	})

	it("maps a null/undefined expires to the contract's Option<u32> undefined", async () => {
		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.pre_vouch.mockResolvedValue({
			result: okResult(undefined),
			signAndSend,
		})

		await createPreVouch("GFROM", "ab".repeat(32), null, 1)

		expect(mockClient.pre_vouch).toHaveBeenCalledWith(
			expect.objectContaining({ expires: undefined }),
			{ publicKey: "GFROM" },
		)
	})

	it("throws on a contract-level error without signing", async () => {
		const signAndSend = vi.fn()
		mockClient.pre_vouch.mockResolvedValue({
			result: errResult("InvalidMaxClaims"),
			signAndSend,
		})

		await expect(
			createPreVouch("GFROM", "ab".repeat(32), null, 0),
		).rejects.toThrow("InvalidMaxClaims")
		expect(signAndSend).not.toHaveBeenCalled()
	})
})

describe("claimVouch", () => {
	it("builds the signature against this contract and submits claim_vouch with the claimant as tx source", async () => {
		const key = new Uint8Array(32).fill(7)
		const sig = new Uint8Array(64).fill(9)
		mockSignClaim.mockReturnValue({ key, sig })

		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.claim_vouch.mockResolvedValue({
			result: okResult(undefined),
			signAndSend,
		})

		const result = await claimVouch("ab".repeat(32), "GTO")

		expect(mockSignClaim).toHaveBeenCalledWith(
			"ab".repeat(32),
			"CCONTRACTFIXTURE",
			"GTO",
		)
		expect(mockClient.claim_vouch).toHaveBeenCalledWith(
			{ key: Buffer.from(key), to: "GTO", sig: Buffer.from(sig) },
			{ publicKey: "GTO" },
		)
		expect(result.submittedByWallet).toBe(false)
		expect(result.hash).toBe("tx-hash")
	})

	it("throws on a contract-level error without signing", async () => {
		mockSignClaim.mockReturnValue({
			key: new Uint8Array(32),
			sig: new Uint8Array(64),
		})
		const signAndSend = vi.fn()
		mockClient.claim_vouch.mockResolvedValue({
			result: errResult("PreVouchNotFound"),
			signAndSend,
		})

		await expect(claimVouch("ab".repeat(32), "GTO")).rejects.toThrow(
			"PreVouchNotFound",
		)
		expect(signAndSend).not.toHaveBeenCalled()
	})
})
