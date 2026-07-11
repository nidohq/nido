// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockToDataURL = vi.hoisted(() => vi.fn())
vi.mock("qrcode", () => ({ default: { toDataURL: mockToDataURL } }))

const { QrPanel } = await import("./QrPanel")

const VALUE =
	"https://adsum.test/vouch?for=GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXEWER"

beforeEach(() => {
	vi.clearAllMocks()
	mockToDataURL.mockResolvedValue("data:image/png;base64,x")
})

describe("QrPanel", () => {
	it("renders the QR as an img whose src is the generated data URL", async () => {
		render(<QrPanel value={VALUE} caption="Scan to vouch for me" />)

		const img = await screen.findByRole("img")
		expect(img).toHaveAttribute("src", "data:image/png;base64,x")
		expect(mockToDataURL).toHaveBeenCalledWith(VALUE, expect.any(Object))
	})

	it("shows the caption", () => {
		render(<QrPanel value={VALUE} caption="Scan to vouch for me" />)

		expect(screen.getByText("Scan to vouch for me")).toBeInTheDocument()
	})

	it("copies the full value — not the truncated display — on Copy", async () => {
		const user = userEvent.setup()
		render(<QrPanel value={VALUE} caption="Scan to vouch for me" />)

		await user.click(screen.getByRole("button", { name: /copy/i }))

		expect(await window.navigator.clipboard.readText()).toBe(VALUE)
		// The button acknowledges the copy.
		expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument()
	})

	it("regenerates the QR when the value changes", async () => {
		const { rerender } = render(<QrPanel value={VALUE} caption="c" />)
		await screen.findByRole("img")

		rerender(<QrPanel value="https://adsum.test/claim?k=abc" caption="c" />)

		await vi.waitFor(() => {
			expect(mockToDataURL).toHaveBeenLastCalledWith(
				"https://adsum.test/claim?k=abc",
				expect.any(Object),
			)
		})
	})

	it("prints an apology instead of the plate when the QR fails to draw", async () => {
		mockToDataURL.mockRejectedValue(new Error("boom"))
		render(<QrPanel value={VALUE} caption="Scan to vouch for me" />)

		// The copy sets a typographic apostrophe — match either.
		expect(await screen.findByText(/couldn['’]t be drawn/i)).toBeInTheDocument()
		expect(screen.queryByRole("img")).not.toBeInTheDocument()
	})
})
