// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ConstellationGraph } from "./ConstellationGraph"

// Addresses shaped so the truncated form (first 4 + … + last 4) is unique.
const CENTER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"
const ALPHA = "GAAAALPHAXXXXXXXXXXXXXXXXXXXXXXXXXXXALFA"
const BETA = "GBBBBETAXXXXXXXXXXXXXXXXXXXXXXXXXXXXBETA"
const GAMMA = "GCCCGAMMAXXXXXXXXXXXXXXXXXXXXXXXXXXXGAMA"

const kindsOf = () =>
	screen
		.getAllByTestId("constellation-edge")
		.map((edge) => edge.getAttribute("data-kind"))

describe("ConstellationGraph", () => {
	it("renders the center star plus one node per unique neighbour", () => {
		render(
			<ConstellationGraph
				center={CENTER}
				given={[ALPHA, BETA]}
				received={[GAMMA, ALPHA]}
				names={{}}
			/>,
		)

		expect(screen.getByTestId("constellation-center")).toBeInTheDocument()
		// ALPHA appears in both lists but is a single star on the ring.
		expect(screen.getAllByTestId("constellation-node")).toHaveLength(3)
	})

	it("directs the edges: given outbound, received inbound, mutual doubled", () => {
		render(
			<ConstellationGraph
				center={CENTER}
				given={[ALPHA, BETA]}
				received={[GAMMA, ALPHA]}
				names={{}}
			/>,
		)

		const kinds = kindsOf()
		expect(kinds).toHaveLength(3)
		expect(kinds.filter((k) => k === "given")).toHaveLength(1)
		expect(kinds.filter((k) => k === "received")).toHaveLength(1)
		expect(kinds.filter((k) => k === "mutual")).toHaveLength(1)

		// The mutual bond carries the mutual class and is drawn as a doubled
		// rule — two strokes where a one-way vouch has one.
		const mutual = screen
			.getAllByTestId("constellation-edge")
			.find((edge) => edge.getAttribute("data-kind") === "mutual")
		expect(mutual).toHaveClass("mutual")
		expect(mutual?.querySelectorAll("line")).toHaveLength(2)
	})

	it("labels stars with resolved names, falling back to truncated addresses", () => {
		render(
			<ConstellationGraph
				center={CENTER}
				given={[ALPHA, BETA]}
				received={[]}
				names={{ [CENTER]: "consul", [ALPHA]: "magistrate" }}
			/>,
		)

		expect(screen.getByText("consul")).toBeInTheDocument()
		expect(screen.getByText("magistrate")).toBeInTheDocument()
		expect(screen.getByText("GBBB…BETA")).toBeInTheDocument()
	})

	it("describes the chart to assistive tech", () => {
		render(
			<ConstellationGraph
				center={CENTER}
				given={[ALPHA, BETA]}
				received={[GAMMA, ALPHA]}
				names={{}}
			/>,
		)

		expect(
			screen.getByRole("img", {
				name: /2 given.*2 received.*1 mutual/i,
			}),
		).toBeInTheDocument()
	})

	it("renders the designed empty state when there are no vouches yet", () => {
		render(
			<ConstellationGraph
				center={CENTER}
				given={[]}
				received={[]}
				names={{}}
			/>,
		)

		expect(screen.getByText(/no vouches yet/i)).toBeInTheDocument()
		expect(screen.queryByTestId("constellation-node")).not.toBeInTheDocument()
		expect(screen.queryByTestId("constellation-edge")).not.toBeInTheDocument()
	})
})
