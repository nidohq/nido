// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type * as ReactRouterDom from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCreatePetition = vi.hoisted(() => vi.fn())
const mockConnectWallet = vi.hoisted(() => vi.fn())
const mockUseWallet = vi.hoisted(() => vi.fn())
const mockNavigate = vi.hoisted(() => vi.fn())

vi.mock("../lib/petitions", () => ({ createPetition: mockCreatePetition }))
vi.mock("../util/wallet", () => ({ connectWallet: mockConnectWallet }))
vi.mock("../hooks/useWallet", () => ({ useWallet: mockUseWallet }))
vi.mock("react-router-dom", async (importOriginal) => {
	const actual = await importOriginal<typeof ReactRouterDom>()
	return { ...actual, useNavigate: () => mockNavigate }
})

const { CreatePetition } = await import("./CreatePetition")

async function fillValidTitleAndBody() {
	await userEvent.type(screen.getByLabelText("Title"), "A fine petition")
	await userEvent.type(
		screen.getByLabelText("Body"),
		"Body of the case, in full.",
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	mockUseWallet.mockReturnValue({ address: "GADDRESS", isPending: false })
})

describe("CreatePetition", () => {
	it("shows a live UTF-8 byte counter for the title, counting bytes not characters", async () => {
		render(<CreatePetition currentLedger={1000} />)
		await userEvent.type(screen.getByLabelText("Title"), "héllo")
		expect(screen.getByText("6/100")).toBeInTheDocument()
	})

	it("disables submit when the title exceeds the byte cap", async () => {
		render(<CreatePetition currentLedger={1000} />)
		await userEvent.type(screen.getByLabelText("Title"), "a".repeat(101))
		await userEvent.type(screen.getByLabelText("Body"), "Body text")
		expect(
			screen.getByRole("button", { name: /post to the wall/i }),
		).toBeDisabled()
	})

	it("rejects a signature goal of 0", async () => {
		render(<CreatePetition currentLedger={1000} />)
		await fillValidTitleAndBody()
		await userEvent.type(screen.getByLabelText("Signature goal"), "0")
		expect(
			screen.getByRole("button", { name: /post to the wall/i }),
		).toBeDisabled()
	})

	it("calls createPetition with deadline: null when no date is chosen, then navigates to the new petition", async () => {
		mockCreatePetition.mockResolvedValue({ id: 7 })
		render(<CreatePetition currentLedger={1000} />)
		await fillValidTitleAndBody()
		await userEvent.click(
			screen.getByRole("button", { name: /post to the wall/i }),
		)

		await waitFor(() => expect(mockCreatePetition).toHaveBeenCalled())
		expect(mockCreatePetition).toHaveBeenCalledWith(
			expect.objectContaining({ deadline: null }),
			"GADDRESS",
		)
		expect(mockNavigate).toHaveBeenCalledWith("/petition/7")
	})

	it("prompts to connect instead of submitting when the wallet is disconnected", async () => {
		mockUseWallet.mockReturnValue({ address: undefined, isPending: false })
		render(<CreatePetition currentLedger={1000} />)
		await fillValidTitleAndBody()

		const connect = screen.getByRole("button", { name: /connect to post/i })
		expect(connect).toBeEnabled()
		await userEvent.click(connect)
		expect(mockConnectWallet).toHaveBeenCalledTimes(1)
		expect(mockCreatePetition).not.toHaveBeenCalled()
	})
})
