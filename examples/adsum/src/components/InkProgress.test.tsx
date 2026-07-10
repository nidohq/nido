// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { InkProgress } from "./InkProgress"

describe("InkProgress", () => {
	it("exposes progressbar semantics when max is given", () => {
		render(<InkProgress value={128} max={200} />)
		const bar = screen.getByRole("progressbar")
		expect(bar).toHaveAttribute("aria-valuenow", "128")
		expect(bar).toHaveAttribute("aria-valuemin", "0")
		expect(bar).toHaveAttribute("aria-valuemax", "200")
	})
	it("renders an open-ended tally (count only) when max is omitted", () => {
		render(<InkProgress value={41} />)
		expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
		expect(screen.getByText(/41/)).toBeInTheDocument()
	})
})
