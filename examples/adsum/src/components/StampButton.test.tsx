// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { StampButton } from "./StampButton"

describe("StampButton", () => {
	it("fires onStamp once when ready", async () => {
		const onStamp = vi.fn()
		render(<StampButton state="ready" onStamp={onStamp} />)
		await userEvent.click(screen.getByRole("button"))
		expect(onStamp).toHaveBeenCalledTimes(1)
	})
	it("is disabled and inert when disabled or busy", async () => {
		const onStamp = vi.fn()
		const { rerender } = render(
			<StampButton state="disabled" onStamp={onStamp} />,
		)
		expect(screen.getByRole("button")).toBeDisabled()
		rerender(<StampButton state="busy" onStamp={onStamp} />)
		expect(screen.getByRole("button")).toBeDisabled()
	})
	it("announces stamped state", () => {
		render(<StampButton state="stamped" onStamp={() => {}} />)
		expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
	})
})
