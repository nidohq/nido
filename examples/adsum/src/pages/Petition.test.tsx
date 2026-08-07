// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFetchPetition = vi.hoisted(() => vi.fn())
const mockFetchSigners = vi.hoisted(() => vi.fn())
const mockHasSigned = vi.hoisted(() => vi.fn())
const mockSignPetition = vi.hoisted(() => vi.fn())
const mockFetchVouchesReceived = vi.hoisted(() => vi.fn())
const mockFetchVouchesGiven = vi.hoisted(() => vi.fn())
const mockLookupNidoName = vi.hoisted(() => vi.fn())
const mockConnectWallet = vi.hoisted(() => vi.fn())
const mockUseWallet = vi.hoisted(() => vi.fn())
const mockGetLatestLedgerSeq = vi.hoisted(() => vi.fn())

vi.mock("../lib/petitions", () => ({
	fetchPetition: mockFetchPetition,
	fetchSigners: mockFetchSigners,
	hasSigned: mockHasSigned,
	signPetition: mockSignPetition,
}))
vi.mock("../lib/trust", () => ({
	fetchVouchesReceived: mockFetchVouchesReceived,
	fetchVouchesGiven: mockFetchVouchesGiven,
}))
vi.mock("../lib/nidoResolver", () => ({ lookupNidoName: mockLookupNidoName }))
vi.mock("../util/wallet", () => ({
	nidoBase: () => "https://nido.test",
	connectWallet: mockConnectWallet,
}))
vi.mock("../hooks/useWallet", () => ({ useWallet: mockUseWallet }))
vi.mock("../lib/rpc", () => ({ getLatestLedgerSeq: mockGetLatestLedgerSeq }))

const { resetSignatureWallCaches } = await import("../components/SignatureWall")
const { Petition } = await import("./Petition")

const VIEWER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"
const CREATOR = "GCREATORXXXXXXXXXXXXXXXXXXXXXXXXXXXXATOR"

const view = {
	id: 7,
	creator: CREATOR,
	title: "Repair the north bridge",
	body: "We the undersigned ask that the bridge be made whole.",
	goal: 100,
	deadline: 5000,
	sigCount: 12,
	createdLedger: 900,
}

const renderPage = () =>
	render(
		<MemoryRouter initialEntries={["/petition/7"]}>
			<Routes>
				<Route path="/petition/:id" element={<Petition />} />
			</Routes>
		</MemoryRouter>,
	)

const stampButton = () => screen.getByRole("button", { name: /adsum/i })

beforeEach(() => {
	vi.clearAllMocks()
	resetSignatureWallCaches()
	mockUseWallet.mockReturnValue({ address: VIEWER, isPending: false })
	mockFetchPetition.mockResolvedValue({ ...view })
	mockFetchSigners.mockResolvedValue([])
	mockHasSigned.mockResolvedValue(false)
	mockGetLatestLedgerSeq.mockResolvedValue(1000)
	mockFetchVouchesReceived.mockResolvedValue([])
	mockFetchVouchesGiven.mockResolvedValue([])
	mockLookupNidoName.mockResolvedValue(null)
})

describe("Petition", () => {
	it("prints the proclamation with its meta line", async () => {
		renderPage()
		expect(
			await screen.findByRole("heading", { name: view.title }),
		).toBeInTheDocument()
		expect(screen.getByText(view.body)).toBeInTheDocument()
		expect(screen.getByText("GCRE…ATOR")).toBeInTheDocument()
		expect(screen.getByText(/closes in/)).toBeInTheDocument()
	})

	it("disables the stamp with a reason when no wallet is connected", async () => {
		mockUseWallet.mockReturnValue({ address: undefined, isPending: false })
		renderPage()
		await screen.findByRole("heading", { name: view.title })
		expect(stampButton()).toBeDisabled()
		expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument()
		expect(mockHasSigned).not.toHaveBeenCalled()
	})

	it("disables the stamp with a reason when the petition has closed", async () => {
		mockFetchPetition.mockResolvedValue({ ...view, deadline: 800 })
		renderPage()
		await screen.findByRole("heading", { name: view.title })
		await waitFor(() => expect(stampButton()).toBeDisabled())
		expect(screen.getByText(/window to sign has passed/i)).toBeInTheDocument()
	})

	it("shows the persisted stamped state when the viewer already signed", async () => {
		mockHasSigned.mockResolvedValue(true)
		renderPage()
		await screen.findByRole("heading", { name: view.title })
		await waitFor(() =>
			expect(stampButton()).toHaveAttribute("aria-pressed", "true"),
		)
	})

	it("presses the stamp: ready -> busy -> stamped, count up, name onto the wall", async () => {
		let resolveSign!: (value: unknown) => void
		mockSignPetition.mockReturnValue(
			new Promise((resolve) => {
				resolveSign = resolve
			}),
		)
		renderPage()
		await screen.findByRole("heading", { name: view.title })
		await waitFor(() => expect(stampButton()).toBeEnabled())
		expect(screen.getByText("12")).toBeInTheDocument()

		await userEvent.click(stampButton())

		// busy: the press is down while the tx is in flight
		expect(screen.getByRole("button", { name: /stamping/i })).toBeDisabled()
		expect(mockSignPetition).toHaveBeenCalledWith(7, VIEWER)

		await act(async () => {
			resolveSign({})
			await Promise.resolve()
		})

		// stamped sticks, the count climbs, the name tops the wall
		expect(stampButton()).toHaveAttribute("aria-pressed", "true")
		expect(screen.getByText("13")).toBeInTheDocument()
		expect(await screen.findByText("GVIE…EWER")).toBeInTheDocument()
	})

	it("surfaces a failed press and returns the stamp to ready", async () => {
		mockSignPetition.mockRejectedValue(new Error("the ledger declined"))
		renderPage()
		await screen.findByRole("heading", { name: view.title })
		await waitFor(() => expect(stampButton()).toBeEnabled())

		await userEvent.click(stampButton())

		expect(await screen.findByRole("alert")).toHaveTextContent(
			/the ledger declined/,
		)
		expect(stampButton()).toBeEnabled()
		expect(screen.getByText("12")).toBeInTheDocument()
	})

	it("reports a petition that isn't on the wall", async () => {
		mockFetchPetition.mockResolvedValue(null)
		renderPage()
		expect(await screen.findByText(/isn.t on the wall/i)).toBeInTheDocument()
	})
})
