import { Buffer } from "buffer"
import { Keypair } from "@stellar/stellar-sdk"
import { describe, expect, it } from "vitest"
import { buildClaimPayload, newInviteSecret, signClaim } from "./claimPayload"

// Pinned by crates/integration-tests/tests/it/web_of_trust.rs
// (claim_payload_fixture). The Rust contract, the Rust test, and this TS
// builder are one protocol: if this test fails, the dapp cannot produce
// valid claims. Never edit the hex here without editing the Rust pin.
const FIXTURE_CONTRACT =
	"CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S"
const FIXTURE_CLAIMANT =
	"GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"
const CLAIM_PAYLOAD_FIXTURE_HEX =
	"0000001200000001c2bfb1aefd11d7000817bf445950e3f72f46b091450bd0f4b7a6e28af2c45ed3616473756d3a636c61696d5f766f75636800000012000000000000000017cd4681baa12ac9360dcb3087862a98f85c1b9393533fd464533d48c4447db4"

const toHex = (b: Uint8Array) =>
	Array.from(b)
		.map((x) => x.toString(16).padStart(2, "0"))
		.join("")

describe("buildClaimPayload", () => {
	it("reproduces the Rust-pinned protocol bytes exactly", () => {
		expect(toHex(buildClaimPayload(FIXTURE_CONTRACT, FIXTURE_CLAIMANT))).toBe(
			CLAIM_PAYLOAD_FIXTURE_HEX,
		)
	})
})

describe("signClaim", () => {
	it("derives a 32B key / 64B sig that verify against the payload", () => {
		const { seedHex, pubkeyHex } = newInviteSecret()

		const { key, sig } = signClaim(seedHex, FIXTURE_CONTRACT, FIXTURE_CLAIMANT)

		expect(key).toHaveLength(32)
		expect(sig).toHaveLength(64)
		expect(toHex(key)).toBe(pubkeyHex)

		// Self-verification: reconstruct the keypair from the seed (as
		// `signClaim` does internally) and confirm `sig` verifies against the
		// exact payload bytes `buildClaimPayload` produces — the same check
		// the contract's `ed25519_verify` performs on-chain.
		const payload = buildClaimPayload(FIXTURE_CONTRACT, FIXTURE_CLAIMANT)
		const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seedHex, "hex"))
		expect(keypair.verify(Buffer.from(payload), Buffer.from(sig))).toBe(true)
	})

	it("produces a signature that fails verification against a tampered payload", () => {
		const { seedHex } = newInviteSecret()
		const { sig } = signClaim(seedHex, FIXTURE_CONTRACT, FIXTURE_CLAIMANT)

		const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seedHex, "hex"))
		const tampered = Buffer.from(
			buildClaimPayload(FIXTURE_CONTRACT, FIXTURE_CLAIMANT),
		)
		// Non-null: buildClaimPayload always emits two address ScVal XDRs plus
		// the domain separator, so index 0 is always defined (noUncheckedIndexedAccess).
		tampered[0]! ^= 0xff
		expect(keypair.verify(tampered, Buffer.from(sig))).toBe(false)
	})
})

describe("newInviteSecret", () => {
	it("derives a 32-byte seed and pubkey, hex-encoded, that signClaim reproduces", () => {
		const { seedHex, pubkeyHex } = newInviteSecret()

		expect(seedHex).toMatch(/^[0-9a-f]{64}$/)
		expect(pubkeyHex).toMatch(/^[0-9a-f]{64}$/)

		const { key } = signClaim(seedHex, FIXTURE_CONTRACT, FIXTURE_CLAIMANT)
		expect(toHex(key)).toBe(pubkeyHex)
	})

	it("returns a different secret on each call", () => {
		const a = newInviteSecret()
		const b = newInviteSecret()
		expect(a.seedHex).not.toBe(b.seedHex)
	})
})
