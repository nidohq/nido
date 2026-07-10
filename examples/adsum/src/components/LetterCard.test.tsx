// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type StoredInvite } from "../lib/invites"

const mockFetchPreVouch = vi.hoisted(() => vi.fn())
const mockRevokePreVouch = vi.hoisted(() => vi.fn())
const mockToDataURL = vi.hoisted(() => vi.fn())

vi.mock("../lib/trust", () => ({
	fetchPreVouch: mockFetchPreVouch,
	revokePreVouch: mockRevokePreVouch,
}))
// LetterCard renders QrPanel, which draws the QR via `qrcode`; stub it out
// so these tests aren't exercising (or blocked on) QR generation.
vi.mock("qrcode", () => ({ default: { toDataURL: mockToDataURL } }))

const { LetterCard } = await import("./LetterCard")

const INVITE: StoredInvite = {
	seedHex: "a".repeat(64),
	pubkeyHex: "b".repeat(64),
	label: "For Alice",
	createdAt: Date.now(),
}

const VIEWER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"

function renderCard(onRemoved = vi.fn()) {
	render(
		<LetterCard
			invite={INVITE}
			viewer={VIEWER}
			origin="https://adsum.test"
			currentLedger={1000}
			onRemoved={onRemoved}
		/>,
	)
	return { onRemoved }
}

beforeEach(() => {
	vi.clearAllMocks()
	mockToDataURL.mockResolvedValue("data:image/png;base64,x")
})

describe("LetterCard", () => {
	it("keeps the Revoke button enabled after a failed terms read, and revokes without terms", async () => {
		mockFetchPreVouch.mockRejectedValue(new Error("network hiccup"))
		mockRevokePreVouch.mockResolvedValue({})
		const { onRemoved } = renderCard()

		expect(
			await screen.findByText(/couldn.t read the letter's terms/i),
		).toBeInTheDocument()

		const revokeButton = screen.getByRole("button", { name: /revoke letter/i })
		expect(revokeButton).toBeEnabled()

		await userEvent.click(revokeButton)

		await waitFor(() =>
			expect(mockRevokePreVouch).toHaveBeenCalledWith(
				VIEWER,
				INVITE.pubkeyHex,
			),
		)
		expect(onRemoved).toHaveBeenCalledTimes(1)
	})

	it("offers a Retry action after a failed read, and renders the terms once the retry succeeds", async () => {
		mockFetchPreVouch.mockRejectedValueOnce(new Error("network hiccup"))
		renderCard()

		expect(
			await screen.findByText(/couldn.t read the letter's terms/i),
		).toBeInTheDocument()
		expect(mockFetchPreVouch).toHaveBeenCalledTimes(1)

		mockFetchPreVouch.mockResolvedValueOnce({
			from: VIEWER,
			expires: null,
			maxClaims: 3,
			claims: 1,
		})
		await userEvent.click(screen.getByRole("button", { name: /retry/i }))

		expect(await screen.findByText("1 of 3 claimed · never expires")).toBeInTheDocument()
		expect(mockFetchPreVouch).toHaveBeenCalledTimes(2)
		// The failed-read copy and its Retry action are gone now that the
		// terms read succeeded.
		expect(
			screen.queryByText(/couldn.t read the letter's terms/i),
		).not.toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: /retry/i }),
		).not.toBeInTheDocument()
	})
})
