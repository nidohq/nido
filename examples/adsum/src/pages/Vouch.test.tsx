// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockHasVouched = vi.hoisted(() => vi.fn())
const mockVouchFor = vi.hoisted(() => vi.fn())
const mockLookupNidoName = vi.hoisted(() => vi.fn())
const mockConnectWallet = vi.hoisted(() => vi.fn())
const mockUseWallet = vi.hoisted(() => vi.fn())

vi.mock("../lib/trust", () => ({
	hasVouched: mockHasVouched,
	vouchFor: mockVouchFor,
}))
vi.mock("../lib/nidoResolver", () => ({ lookupNidoName: mockLookupNidoName }))
vi.mock("../util/wallet", () => ({
	nidoBase: () => "https://nido.test",
	connectWallet: mockConnectWallet,
}))
vi.mock("../hooks/useWallet", () => ({ useWallet: mockUseWallet }))

const { Vouch } = await import("./Vouch")

// Real, validly-encoded strkey (borrowed from urls.test.ts's fixture) — only
// its strkey validity matters here.
const TARGET = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"
const VIEWER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"
const PENDING_KEY = "adsum:pendingVouch"

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/vouch" element={<Vouch />} />
			</Routes>
		</MemoryRouter>,
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.clear()
	mockUseWallet.mockReturnValue({ address: undefined })
	mockLookupNidoName.mockResolvedValue(null)
})

describe("Vouch", () => {
	it("renders a designed error state for a junk for param", () => {
		renderAt("/vouch?for=not-an-address")
		expect(
			screen.getByText(/didn.t carry a usable address/i),
		).toBeInTheDocument()
		expect(screen.queryByText(TARGET)).not.toBeInTheDocument()
	})

	it("renders a designed error state for a missing param and no pending value", () => {
		renderAt("/vouch")
		expect(
			screen.getByText(/didn.t carry a usable address/i),
		).toBeInTheDocument()
	})

	it("valid param + disconnected: writes pendingVouch and shows a connect CTA", async () => {
		mockLookupNidoName.mockResolvedValue("alice")
		renderAt(`/vouch?for=${TARGET}`)

		expect(await screen.findByText("alice")).toBeInTheDocument()
		expect(screen.getByText(TARGET)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument()
		expect(localStorage.getItem(PENDING_KEY)).toBe(TARGET)
		expect(mockHasVouched).not.toHaveBeenCalled()
	})

	it("valid param + connected: resolves the name and vouches on confirm", async () => {
		mockUseWallet.mockReturnValue({ address: VIEWER })
		mockLookupNidoName.mockResolvedValue("alice")
		mockHasVouched.mockResolvedValue(false)
		mockVouchFor.mockResolvedValue({})
		renderAt(`/vouch?for=${TARGET}`)

		expect(await screen.findByText("alice")).toBeInTheDocument()
		const vouchButton = await screen.findByRole("button", { name: /^vouch$/i })
		await userEvent.click(vouchButton)

		await waitFor(() =>
			expect(mockVouchFor).toHaveBeenCalledWith(VIEWER, TARGET),
		)
		expect(
			await screen.findByRole("link", { name: /constellation/i }),
		).toHaveAttribute("href", "/trust")
		expect(localStorage.getItem(PENDING_KEY)).toBeNull()
	})

	it("disables the vouch action with an explanatory reason for a self-vouch", async () => {
		mockUseWallet.mockReturnValue({ address: TARGET })
		renderAt(`/vouch?for=${TARGET}`)

		expect(
			await screen.findByText(/can.t vouch for yourself/i),
		).toBeInTheDocument()
		expect(mockHasVouched).not.toHaveBeenCalled()
	})

	it("shows an already-vouched state when hasVouched resolves true", async () => {
		mockUseWallet.mockReturnValue({ address: VIEWER })
		mockHasVouched.mockResolvedValue(true)
		renderAt(`/vouch?for=${TARGET}`)

		expect(
			await screen.findByText(/already stands beside this name/i),
		).toBeInTheDocument()
		expect(mockVouchFor).not.toHaveBeenCalled()
	})

	it("restores a pending target from storage on a bare landing", async () => {
		localStorage.setItem(PENDING_KEY, TARGET)
		mockLookupNidoName.mockResolvedValue("alice")
		renderAt("/vouch")

		expect(await screen.findByText("alice")).toBeInTheDocument()
		expect(screen.getByText(TARGET)).toBeInTheDocument()
	})

	it("re-validates corrupted pending vouch and renders error state", async () => {
		localStorage.setItem(PENDING_KEY, "not-an-address")
		renderAt("/vouch")

		expect(
			screen.getByText(/didn.t carry a usable address/i),
		).toBeInTheDocument()
		expect(mockLookupNidoName).not.toHaveBeenCalled()
	})

	it("clears the pending value on explicit dismissal", async () => {
		mockLookupNidoName.mockResolvedValue("alice")
		renderAt(`/vouch?for=${TARGET}`)

		await screen.findByText("alice")
		expect(localStorage.getItem(PENDING_KEY)).toBe(TARGET)

		await userEvent.click(screen.getByRole("button", { name: /isn.t for me/i }))
		expect(localStorage.getItem(PENDING_KEY)).toBeNull()
	})
})
