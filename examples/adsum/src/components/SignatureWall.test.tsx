// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFetchSigners = vi.hoisted(() => vi.fn())
const mockFetchVouchesReceived = vi.hoisted(() => vi.fn())
const mockFetchVouchesGiven = vi.hoisted(() => vi.fn())
const mockLookupNidoName = vi.hoisted(() => vi.fn())

vi.mock("../lib/petitions", () => ({ fetchSigners: mockFetchSigners }))
vi.mock("../lib/trust", () => ({
	fetchVouchesReceived: mockFetchVouchesReceived,
	fetchVouchesGiven: mockFetchVouchesGiven,
}))
vi.mock("../lib/nidoResolver", () => ({ lookupNidoName: mockLookupNidoName }))
vi.mock("../util/wallet", () => ({ nidoBase: () => "https://nido.test" }))

const { SignatureWall, resetSignatureWallCaches } =
	await import("./SignatureWall")

// Addresses shaped so the truncated form (first 4 + … + last 4) is unique.
const VIEWER = "GVIEWERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXEWER"
const PATRON = "GPATRONXXXXXXXXXXXXXXXXXXXXXXXXXXXXXTRON"
const SIGNER_A = "GAAASIGNERAXXXXXXXXXXXXXXXXXXXXXXXXXSIGA"
const SIGNER_B = "GBBBSIGNERBXXXXXXXXXXXXXXXXXXXXXXXXXSIGB"
const SIGNER_C = "GCCCSIGNERCXXXXXXXXXXXXXXXXXXXXXXXXXSIGC"
const NAMED = "GNAMEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXAMED"
const UNNAMED = "GUNNAMEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXMEDX"

const signer = (i: number) =>
	`GSIG${String(i).padStart(4, "0")}XXXXXXXXXXXXXXXXXXXXXXXXXXXX${String(i).padStart(4, "0")}`

beforeEach(() => {
	vi.clearAllMocks()
	resetSignatureWallCaches()
	mockFetchSigners.mockResolvedValue([])
	mockFetchVouchesReceived.mockResolvedValue([])
	mockFetchVouchesGiven.mockResolvedValue([])
	mockLookupNidoName.mockResolvedValue(null)
})

describe("SignatureWall", () => {
	it("pages the wall 30 at a time behind Load more, hiding it on a short page", async () => {
		const pageOne = Array.from({ length: 30 }, (_, i) => signer(i))
		const pageTwo = Array.from({ length: 5 }, (_, i) => signer(30 + i))
		mockFetchSigners.mockImplementation((_id: number, start: number) =>
			Promise.resolve(start === 0 ? pageOne : pageTwo),
		)

		render(<SignatureWall petitionId={7} viewer={null} />)

		await waitFor(() =>
			expect(screen.getAllByRole("listitem")).toHaveLength(30),
		)
		expect(mockFetchSigners).toHaveBeenCalledWith(7, 0, 30)

		await userEvent.click(screen.getByRole("button", { name: /load more/i }))

		await waitFor(() =>
			expect(screen.getAllByRole("listitem")).toHaveLength(35),
		)
		expect(mockFetchSigners).toHaveBeenLastCalledWith(7, 30, 30)
		// A short page means the record is complete — the button withdraws.
		expect(
			screen.queryByRole("button", { name: /load more/i }),
		).not.toBeInTheDocument()
	})

	it("computes badge tones against the viewer's vouches", async () => {
		mockFetchSigners.mockResolvedValue([SIGNER_A, SIGNER_B, SIGNER_C])
		// A is vouched by the viewer directly; B by someone the viewer vouches
		// for; C stands alone.
		mockFetchVouchesReceived.mockImplementation((addr: string) =>
			Promise.resolve(
				addr === SIGNER_A ? [VIEWER] : addr === SIGNER_B ? [PATRON] : [],
			),
		)
		mockFetchVouchesGiven.mockResolvedValue([PATRON])

		render(<SignatureWall petitionId={1} viewer={VIEWER} />)

		expect(
			await screen.findByTitle("1 vouch, vouched by you"),
		).toBeInTheDocument()
		expect(
			await screen.findByTitle("1 vouch, vouched by someone you vouch for"),
		).toBeInTheDocument()
		expect(await screen.findByTitle("0 vouches")).toBeInTheDocument()
		expect(mockFetchVouchesGiven).toHaveBeenCalledWith(VIEWER)
	})

	it("shows a resolved nido name, falling back to a truncated address", async () => {
		mockFetchSigners.mockResolvedValue([NAMED, UNNAMED])
		mockLookupNidoName.mockImplementation((addr: string) =>
			Promise.resolve(addr === NAMED ? "magistrate" : null),
		)

		render(<SignatureWall petitionId={1} viewer={null} />)

		expect(await screen.findByText("magistrate")).toBeInTheDocument()
		expect(await screen.findByText("GUNN…MEDX")).toBeInTheDocument()
		expect(mockLookupNidoName).toHaveBeenCalledWith(
			UNNAMED,
			"https://nido.test",
		)
	})

	it("pins the fresh signer to the top of the wall", async () => {
		mockFetchSigners.mockResolvedValue([SIGNER_A])

		render(
			<SignatureWall petitionId={1} viewer={VIEWER} freshSigner={VIEWER} />,
		)

		await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2))
		const first = screen.getAllByRole("listitem")[0]
		if (!first) throw new Error("wall rendered empty")
		expect(within(first).getByText("GVIE…EWER")).toBeInTheDocument()
	})

	it("does not duplicate the fresh signer when a fetched page already holds them", async () => {
		mockFetchSigners.mockResolvedValue([VIEWER, SIGNER_A])

		render(
			<SignatureWall petitionId={1} viewer={VIEWER} freshSigner={VIEWER} />,
		)

		await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2))
		expect(screen.getAllByText("GVIE…EWER")).toHaveLength(1)
	})

	it("invites the first signature when the wall is bare", async () => {
		mockFetchSigners.mockResolvedValue([])

		render(<SignatureWall petitionId={1} viewer={null} />)

		expect(await screen.findByText(/no names yet/i)).toBeInTheDocument()
	})
})
