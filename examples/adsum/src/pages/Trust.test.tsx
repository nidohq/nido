// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { inviteStore } from "../lib/invites"

const mockFetchVouchesGiven = vi.hoisted(() => vi.fn())
const mockFetchVouchesReceived = vi.hoisted(() => vi.fn())
const mockRevokeVouch = vi.hoisted(() => vi.fn())
const mockVouchFor = vi.hoisted(() => vi.fn())
const mockCreatePreVouch = vi.hoisted(() => vi.fn())
const mockFetchPreVouch = vi.hoisted(() => vi.fn())
const mockRevokePreVouch = vi.hoisted(() => vi.fn())
const mockLookupNidoName = vi.hoisted(() => vi.fn())
const mockResolveNidoName = vi.hoisted(() => vi.fn())
const mockGetLatestLedgerSeq = vi.hoisted(() => vi.fn())
const mockNewInviteSecret = vi.hoisted(() => vi.fn())
const mockConnectWallet = vi.hoisted(() => vi.fn())
const mockUseWallet = vi.hoisted(() => vi.fn())
const mockAddNotification = vi.hoisted(() => vi.fn())

// A stand-in for trust.ts's own `TrustSimulationError` — Trust.tsx's
// `instanceof` check and this test's thrown instances both resolve against
// this same mocked module, so the class identity lines up either way.
vi.mock("../lib/trust", () => {
	class TrustSimulationError extends Error {
		constructor(message: string) {
			super(message)
			this.name = "TrustSimulationError"
		}
	}
	return {
		TrustSimulationError,
		fetchVouchesGiven: mockFetchVouchesGiven,
		fetchVouchesReceived: mockFetchVouchesReceived,
		revokeVouch: mockRevokeVouch,
		vouchFor: mockVouchFor,
		createPreVouch: mockCreatePreVouch,
		fetchPreVouch: mockFetchPreVouch,
		revokePreVouch: mockRevokePreVouch,
	}
})
vi.mock("../lib/rpc", () => ({ getLatestLedgerSeq: mockGetLatestLedgerSeq }))
vi.mock("../lib/nidoResolver", () => ({
	lookupNidoName: mockLookupNidoName,
	resolveNidoName: mockResolveNidoName,
}))
vi.mock("../lib/claimPayload", () => ({
	newInviteSecret: mockNewInviteSecret,
}))
vi.mock("../util/wallet", () => ({
	nidoBase: () => "https://nido.test",
	connectWallet: mockConnectWallet,
}))
vi.mock("../hooks/useWallet", () => ({ useWallet: mockUseWallet }))
vi.mock("../hooks/useNotification", () => ({
	useNotification: () => ({ addNotification: mockAddNotification }),
}))
vi.mock("qrcode", () => ({
	default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,x") },
}))

const { Trust } = await import("./Trust")
const { TrustSimulationError } = await import("../lib/trust")

const VIEWER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"
const SECRET = { seedHex: "a".repeat(64), pubkeyHex: "b".repeat(64) }

function renderPage() {
	return render(
		<MemoryRouter initialEntries={["/trust"]}>
			<Routes>
				<Route path="/trust" element={<Trust />} />
			</Routes>
		</MemoryRouter>,
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.clear()
	mockUseWallet.mockReturnValue({ address: VIEWER, isPending: false })
	mockFetchVouchesGiven.mockResolvedValue([])
	mockFetchVouchesReceived.mockResolvedValue([])
	mockLookupNidoName.mockResolvedValue(null)
	mockGetLatestLedgerSeq.mockResolvedValue(1000)
	mockNewInviteSecret.mockReturnValue(SECRET)
})

/** Renders the page and presses "Seal the letter" with the form's defaults. */
async function sealLetter() {
	renderPage()
	const button = await screen.findByRole("button", { name: /seal the letter/i })
	await waitFor(() => expect(button).toBeEnabled())
	await userEvent.click(button)
}

describe("Trust — sealing a letter of introduction", () => {
	it("persists the invite (seed + pubkey), flagged pending, before createPreVouch settles", async () => {
		let resolveCreate!: (value: unknown) => void
		mockCreatePreVouch.mockReturnValue(
			new Promise((resolve) => {
				resolveCreate = resolve
			}),
		)
		mockFetchPreVouch.mockResolvedValue(null)

		await sealLetter()

		await waitFor(() =>
			expect(inviteStore.list()).toEqual([
				expect.objectContaining({
					seedHex: SECRET.seedHex,
					pubkeyHex: SECRET.pubkeyHex,
					pending: true,
				}),
			]),
		)

		// Let the in-flight call settle so no state update lands after the test.
		resolveCreate({ submittedByWallet: false })
		await screen.findByText(/no longer on the ledger/i)
	})

	it("prunes the invite when createPreVouch fails at the simulation stage", async () => {
		mockCreatePreVouch.mockRejectedValue(
			new TrustSimulationError("InvalidMaxClaims"),
		)

		await sealLetter()

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"InvalidMaxClaims",
		)
		expect(inviteStore.list()).toEqual([])
		expect(screen.getByText(/no letters yet/i)).toBeInTheDocument()
	})

	it("keeps the invite on an unknown/late failure and warns it may still be live", async () => {
		mockCreatePreVouch.mockRejectedValue(new Error("popup closed"))
		mockFetchPreVouch.mockResolvedValue(null)

		await sealLetter()

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/may still be live/i,
		)
		const stored = inviteStore.list()
		expect(stored).toHaveLength(1)
		expect(stored[0]?.pubkeyHex).toBe(SECRET.pubkeyHex)
		expect(stored[0]?.pending).toBeFalsy()

		// Settles the now-unpended letter card's own ledger read.
		await screen.findByText(/no longer on the ledger/i)
	})
})
