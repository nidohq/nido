// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFetchPreVouch = vi.hoisted(() => vi.fn())
const mockClaimVouch = vi.hoisted(() => vi.fn())
const mockLookupNidoName = vi.hoisted(() => vi.fn())
const mockConnectWallet = vi.hoisted(() => vi.fn())
const mockUseWallet = vi.hoisted(() => vi.fn())
const mockGetLatestLedgerSeq = vi.hoisted(() => vi.fn())
const mockParseClaimParam = vi.hoisted(() => vi.fn())

vi.mock("../lib/trust", () => ({
	fetchPreVouch: mockFetchPreVouch,
	claimVouch: mockClaimVouch,
}))
vi.mock("../lib/nidoResolver", () => ({ lookupNidoName: mockLookupNidoName }))
vi.mock("../util/wallet", () => ({
	nidoBase: () => "https://nido.test",
	connectWallet: mockConnectWallet,
}))
vi.mock("../hooks/useWallet", () => ({ useWallet: mockUseWallet }))
vi.mock("../lib/rpc", () => ({ getLatestLedgerSeq: mockGetLatestLedgerSeq }))
// The real `parseClaimParam` derives an ed25519 keypair from the seed
// (`Keypair.fromRawEd25519Seed`), which throws under jsdom in this project's
// vitest setup — a pre-existing realm mismatch between the `buffer` polyfill
// and @noble/curves' `instanceof Uint8Array` check, unrelated to this page.
// urls.test.ts already covers the real implementation (under the default
// node environment); here a faithful stand-in (same hex-length validation,
// deterministic pubkey derivation) is enough to exercise Claim's own logic.
vi.mock("../lib/urls", () => ({ parseClaimParam: mockParseClaimParam }))

const { Claim } = await import("./Claim")

// Real 64-hex-char seed (borrowed from urls.test.ts's fixture) — only its
// shape (32 raw bytes) matters here.
const SEED_HEX =
	"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
const VIEWER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"
const FROM = "GFROMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXFROM"
const PENDING_KEY = "adsum:pendingClaim"

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/claim" element={<Claim />} />
			</Routes>
		</MemoryRouter>,
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.clear()
	mockUseWallet.mockReturnValue({ address: undefined })
	mockLookupNidoName.mockResolvedValue(null)
	mockGetLatestLedgerSeq.mockResolvedValue(1000)
	mockParseClaimParam.mockImplementation((search: string) => {
		const seedHex = new URLSearchParams(search).get("k")
		if (!seedHex || !/^[0-9a-f]{64}$/i.test(seedHex)) return null
		return { seedHex, pubkeyHex: `pub-${seedHex}` }
	})
})

describe("Claim", () => {
	it("renders a designed error state for a junk k param", () => {
		renderAt("/claim?k=not-hex")
		expect(screen.getByText(/didn.t carry a usable code/i)).toBeInTheDocument()
		expect(mockFetchPreVouch).not.toHaveBeenCalled()
	})

	it("renders a designed error state for a missing param and no pending value", () => {
		renderAt("/claim")
		expect(screen.getByText(/didn.t carry a usable code/i)).toBeInTheDocument()
	})

	it("live invite: renders the vouching name and the letter's terms", async () => {
		mockFetchPreVouch.mockResolvedValue({
			from: FROM,
			expires: null,
			maxClaims: 3,
			claims: 1,
		})
		mockLookupNidoName.mockResolvedValue("bob")
		renderAt(`/claim?k=${SEED_HEX}`)

		expect(
			await screen.findByText(/bob has vouched for you/i),
		).toBeInTheDocument()
		expect(screen.getByText(/1 of 3 claimed/i)).toBeInTheDocument()
		expect(localStorage.getItem(PENDING_KEY)).toBe(SEED_HEX)
	})

	it("exhausted (or expired/revoked): renders the spent state", async () => {
		mockFetchPreVouch.mockResolvedValue(null)
		renderAt(`/claim?k=${SEED_HEX}`)

		expect(
			await screen.findByText(/expired or.*exhausted/i),
		).toBeInTheDocument()
	})

	it("not connected: shows the onboarding CTA", async () => {
		mockFetchPreVouch.mockResolvedValue({
			from: FROM,
			expires: null,
			maxClaims: 3,
			claims: 0,
		})
		renderAt(`/claim?k=${SEED_HEX}`)

		await screen.findByText(/has vouched for you/i)
		expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument()
		expect(mockClaimVouch).not.toHaveBeenCalled()
	})

	it("connected: claim click calls claimVouch with the seed and viewer address", async () => {
		mockUseWallet.mockReturnValue({ address: VIEWER })
		mockFetchPreVouch.mockResolvedValue({
			from: FROM,
			expires: null,
			maxClaims: 3,
			claims: 0,
		})
		mockClaimVouch.mockResolvedValue({})
		renderAt(`/claim?k=${SEED_HEX}`)

		const claimButton = await screen.findByRole("button", { name: /claim/i })
		await userEvent.click(claimButton)

		await waitFor(() =>
			expect(mockClaimVouch).toHaveBeenCalledWith(SEED_HEX, VIEWER),
		)
		expect(localStorage.getItem(PENDING_KEY)).toBeNull()
	})

	it("surfaces the AlreadyVouched contract error as a friendly message", async () => {
		mockUseWallet.mockReturnValue({ address: VIEWER })
		mockFetchPreVouch.mockResolvedValue({
			from: FROM,
			expires: null,
			maxClaims: 3,
			claims: 0,
		})
		mockClaimVouch.mockRejectedValue(new Error("AlreadyVouched"))
		renderAt(`/claim?k=${SEED_HEX}`)

		const claimButton = await screen.findByRole("button", { name: /claim/i })
		await userEvent.click(claimButton)

		expect(
			await screen.findByText(/already hold this vouch/i),
		).toBeInTheDocument()
	})

	it("restores a pending seed from storage on a bare landing", async () => {
		localStorage.setItem(PENDING_KEY, SEED_HEX)
		mockFetchPreVouch.mockResolvedValue({
			from: FROM,
			expires: null,
			maxClaims: 3,
			claims: 0,
		})
		renderAt("/claim")

		expect(await screen.findByText(/has vouched for you/i)).toBeInTheDocument()
		expect(mockFetchPreVouch).toHaveBeenCalled()
	})
})
