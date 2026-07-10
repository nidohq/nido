import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClient = vi.hoisted(() => ({
	get_petition: vi.fn(),
	get_signers: vi.fn(),
	has_signed: vi.fn(),
	petition_count: vi.fn(),
	create_petition: vi.fn(),
	sign: vi.fn(),
}))

vi.mock("../contracts/petitions", () => ({ default: mockClient }))
vi.mock("../util/wallet", () => ({ wallet: { signTransaction: vi.fn() } }))

const {
	fetchPetition,
	fetchPetitions,
	fetchSigners,
	hasSigned,
	fetchPetitionCount,
	createPetition,
	signPetition,
} = await import("./petitions")

function rawPetition(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		creator: "GCREATOR",
		title: "Title",
		body: "Body",
		goal: undefined,
		deadline: undefined,
		sig_count: 3,
		created_ledger: 100,
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

describe("fetchPetition", () => {
	it("maps a Petition, converting Option fields to null", async () => {
		mockClient.get_petition.mockResolvedValue({ result: rawPetition() })

		const view = await fetchPetition(5)

		expect(view).toEqual({
			id: 5,
			creator: "GCREATOR",
			title: "Title",
			body: "Body",
			goal: null,
			deadline: null,
			sigCount: 3,
			createdLedger: 100,
		})
		expect(mockClient.get_petition).toHaveBeenCalledWith({ id: 5 })
	})

	it("passes through defined Option fields as numbers", async () => {
		mockClient.get_petition.mockResolvedValue({
			result: rawPetition({ goal: 500, deadline: 999 }),
		})

		const view = await fetchPetition(1)

		expect(view?.goal).toBe(500)
		expect(view?.deadline).toBe(999)
	})

	it("returns null when the petition doesn't exist", async () => {
		mockClient.get_petition.mockResolvedValue({ result: undefined })

		expect(await fetchPetition(999)).toBeNull()
	})
})

describe("fetchPetitions", () => {
	it("fetches newest-first (descending id order), paging get_petition", async () => {
		mockClient.get_petition.mockImplementation(({ id }: { id: number }) =>
			Promise.resolve({ result: rawPetition({ title: `t${id}` }) }),
		)

		const views = await fetchPetitions(5, 2)

		expect(views.map((v) => v.id)).toEqual([4, 3, 2, 1, 0])
		expect(views.map((v) => v.title)).toEqual(["t4", "t3", "t2", "t1", "t0"])
		expect(mockClient.get_petition).toHaveBeenCalledTimes(5)
	})

	it("skips ids that resolve to no petition", async () => {
		mockClient.get_petition.mockImplementation(({ id }: { id: number }) =>
			Promise.resolve({ result: id === 1 ? undefined : rawPetition() }),
		)

		const views = await fetchPetitions(3)

		expect(views.map((v) => v.id)).toEqual([2, 0])
	})
})

describe("fetchSigners", () => {
	it("returns the signer list from get_signers", async () => {
		mockClient.get_signers.mockResolvedValue({ result: ["GA", "GB"] })

		expect(await fetchSigners(1, 0, 10)).toEqual(["GA", "GB"])
		expect(mockClient.get_signers).toHaveBeenCalledWith({
			id: 1,
			start: 0,
			limit: 10,
		})
	})
})

describe("hasSigned", () => {
	it("returns the boolean from has_signed", async () => {
		mockClient.has_signed.mockResolvedValue({ result: true })

		expect(await hasSigned(1, "GA")).toBe(true)
		expect(mockClient.has_signed).toHaveBeenCalledWith({ id: 1, addr: "GA" })
	})
})

describe("fetchPetitionCount", () => {
	it("returns the count from petition_count", async () => {
		mockClient.petition_count.mockResolvedValue({ result: 7 })

		expect(await fetchPetitionCount()).toBe(7)
	})
})

describe("createPetition", () => {
	it("builds, signs and returns the new id on success", async () => {
		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.create_petition.mockResolvedValue({
			result: okResult(42),
			signAndSend,
		})

		const result = await createPetition(
			{ title: "Title", body: "Body", goal: 100, deadline: null },
			"GADDR",
		)

		expect(mockClient.create_petition).toHaveBeenCalledWith(
			{
				creator: "GADDR",
				title: "Title",
				body: "Body",
				goal: 100,
				deadline: undefined,
			},
			{ publicKey: "GADDR" },
		)
		expect(result.id).toBe(42)
		expect(result.submittedByWallet).toBe(false)
		expect(result.hash).toBe("tx-hash")
	})

	it("throws on a contract-level error without signing", async () => {
		const signAndSend = vi.fn()
		mockClient.create_petition.mockResolvedValue({
			result: errResult("TitleInvalid"),
			signAndSend,
		})

		await expect(
			createPetition({ title: "", body: "Body" }, "GADDR"),
		).rejects.toThrow("TitleInvalid")
		expect(signAndSend).not.toHaveBeenCalled()
	})
})

describe("signPetition", () => {
	it("signs and sends on success", async () => {
		const signAndSend = vi
			.fn()
			.mockResolvedValue({ sendTransactionResponse: { hash: "tx-hash" } })
		mockClient.sign.mockResolvedValue({
			result: okResult(undefined),
			signAndSend,
		})

		const result = await signPetition(3, "GADDR")

		expect(mockClient.sign).toHaveBeenCalledWith(
			{ id: 3, signer: "GADDR" },
			{ publicKey: "GADDR" },
		)
		expect(result.submittedByWallet).toBe(false)
		expect(result.hash).toBe("tx-hash")
	})

	it("throws on a contract-level error without signing", async () => {
		const signAndSend = vi.fn()
		mockClient.sign.mockResolvedValue({
			result: errResult("AlreadySigned"),
			signAndSend,
		})

		await expect(signPetition(3, "GADDR")).rejects.toThrow("AlreadySigned")
		expect(signAndSend).not.toHaveBeenCalled()
	})
})
