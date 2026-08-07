import { describe, expect, it } from "vitest"
import {
	buildClaimUrl,
	buildVouchUrl,
	parseClaimParam,
	parseVouchParam,
} from "./urls"

// Real, validly-encoded strkeys (borrowed from claimPayload.test.ts's pinned
// fixture inputs) — only their strkey validity matters here.
const G_ADDRESS = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"
const C_ADDRESS = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S"
const SEED_HEX =
	"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"

describe("buildVouchUrl / parseVouchParam", () => {
	it("roundtrips a G (account) address", () => {
		const url = buildVouchUrl("https://example.com", G_ADDRESS)
		expect(url).toBe(`https://example.com/vouch?for=${G_ADDRESS}`)
		const search = new URL(url).search
		expect(parseVouchParam(search)).toBe(G_ADDRESS)
	})

	it("roundtrips a C (contract) address", () => {
		const url = buildVouchUrl("https://example.com", C_ADDRESS)
		const search = new URL(url).search
		expect(parseVouchParam(search)).toBe(C_ADDRESS)
	})

	it.each([
		["junk text", "?for=hello"],
		["a truncated strkey", `?for=${G_ADDRESS.slice(0, 10)}`],
		["an empty value", "?for="],
		["a missing param", "?other=1"],
		["an empty search string", ""],
	])("returns null for %s", (_label, search) => {
		expect(parseVouchParam(search)).toBeNull()
	})
})

describe("buildClaimUrl / parseClaimParam", () => {
	it("roundtrips a 64-hex-char seed, deriving its pubkey", () => {
		const url = buildClaimUrl("https://example.com", SEED_HEX)
		expect(url).toBe(`https://example.com/claim?k=${SEED_HEX}`)

		const parsed = parseClaimParam(new URL(url).search)
		expect(parsed?.seedHex).toBe(SEED_HEX)
		expect(parsed?.pubkeyHex).toMatch(/^[0-9a-f]{64}$/)
	})

	it.each([
		["an odd-length hex string", `?k=${SEED_HEX.slice(0, 63)}`],
		["a non-hex string", `?k=${"z".repeat(64)}`],
		["too few characters", "?k=abcd"],
		["a missing param", "?other=1"],
		["an empty search string", ""],
	])("returns null for %s", (_label, search) => {
		expect(parseClaimParam(search)).toBeNull()
	})
})
