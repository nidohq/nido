import { describe, expect, it } from "vitest"
import { RELAYER_SIM_SOURCE, txSourceFor } from "./txSource"

// Real, validly-encoded strkeys (borrowed from urls.test.ts's pinned fixture
// inputs) — only their strkey validity/kind matters here.
const G_ADDRESS = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"
const C_ADDRESS = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S"

describe("txSourceFor", () => {
	it("returns a G (account) actor unchanged", () => {
		expect(txSourceFor(G_ADDRESS)).toBe(G_ADDRESS)
	})

	it("returns RELAYER_SIM_SOURCE for a C (contract) actor", () => {
		expect(txSourceFor(C_ADDRESS)).toBe(RELAYER_SIM_SOURCE)
	})

	it("returns junk input unchanged (not a validator)", () => {
		expect(txSourceFor("not-a-strkey")).toBe("not-a-strkey")
	})
})
