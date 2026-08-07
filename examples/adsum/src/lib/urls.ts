/**
 * Builds and parses the two shareable links the trust flow revolves around:
 * `/vouch?for=<address>` (ask someone to vouch for `address`) and
 * `/claim?k=<seedHex>` (redeem a pre-vouch created under that invite
 * secret). Parsing is defensive — a mistyped or truncated link should read
 * as "no param", never throw.
 */

import { Buffer } from "buffer"
import { Keypair, StrKey } from "@stellar/stellar-sdk"

const HEX_32_BYTES = /^[0-9a-f]{64}$/i

/** `<origin>/vouch?for=<address>` — the link shared to ask someone to vouch. */
export function buildVouchUrl(origin: string, address: string): string {
	const params = new URLSearchParams({ for: address })
	return `${origin}/vouch?${params.toString()}`
}

/**
 * The `for` param from a `/vouch` URL's query string, validated as a G
 * (account) or C (contract) strkey. `null` for a missing param or anything
 * that isn't a valid address (never throws on junk input).
 */
export function parseVouchParam(search: string): string | null {
	const value = new URLSearchParams(search).get("for")
	if (!value) return null
	if (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)) {
		return value
	}
	return null
}

/** `<origin>/claim?k=<seedHex>` — the link shared to redeem a pre-vouch. */
export function buildClaimUrl(origin: string, seedHex: string): string {
	const params = new URLSearchParams({ k: seedHex })
	return `${origin}/claim?${params.toString()}`
}

/**
 * The `k` param from a `/claim` URL's query string: a 64-hex-char (32-byte)
 * ed25519 seed. Returns the seed alongside its derived pubkey, or `null` for
 * a missing param or anything that isn't exactly 64 hex characters (never
 * throws on junk input).
 */
export function parseClaimParam(
	search: string,
): { seedHex: string; pubkeyHex: string } | null {
	const seedHex = new URLSearchParams(search).get("k")
	if (!seedHex || !HEX_32_BYTES.test(seedHex)) return null
	const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seedHex, "hex"))
	return { seedHex, pubkeyHex: keypair.rawPublicKey().toString("hex") }
}
