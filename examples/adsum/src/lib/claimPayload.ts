/**
 * Builds and signs the claim payload the `web-of-trust` contract's
 * `claim_vouch` verifies, plus a helper to mint fresh invite secrets.
 *
 * The payload's byte layout is a protocol shared with the Rust contract
 * (`contracts/web-of-trust/src/contract.rs`'s `claim_payload_for`) and pinned
 * by a fixture test on both sides (`claimPayload.test.ts` here,
 * `claim_payload_fixture` in `crates/integration-tests/tests/it/web_of_trust.rs`).
 * If the two ever disagree, claims built by this dapp fail on-chain
 * `ed25519_verify` — never change this file's byte layout without updating
 * the Rust pin (and vice versa).
 */

import { Buffer } from "buffer"
import { Address, Keypair } from "@stellar/stellar-sdk"

const DOMAIN = new TextEncoder().encode("adsum:claim_vouch")

/** contract.to_xdr || "adsum:claim_vouch" || to.to_xdr — the exact bytes
 * `claim_vouch` verifies. Mirrors contracts/web-of-trust claim_payload_for. */
export function buildClaimPayload(contractId: string, to: string): Uint8Array {
	const seg = (addr: string) =>
		new Uint8Array(Address.fromString(addr).toScVal().toXDR())
	const a = seg(contractId)
	const b = seg(to)
	const out = new Uint8Array(a.length + DOMAIN.length + b.length)
	out.set(a, 0)
	out.set(DOMAIN, a.length)
	out.set(b, a.length + DOMAIN.length)
	return out
}

/**
 * Sign the claim payload for `to` under the invite secret `secretSeedHex` (a
 * 32-byte raw ed25519 seed, hex-encoded — as produced by `newInviteSecret`).
 * Returns the raw public key (32B) and ed25519 signature (64B) that
 * `claim_vouch`'s `key`/`sig` arguments expect.
 */
export function signClaim(
	secretSeedHex: string,
	contractId: string,
	to: string,
): { key: Uint8Array; sig: Uint8Array } {
	const keypair = Keypair.fromRawEd25519Seed(Buffer.from(secretSeedHex, "hex"))
	const payload = buildClaimPayload(contractId, to)
	return {
		key: new Uint8Array(keypair.rawPublicKey()),
		sig: new Uint8Array(keypair.sign(payload)),
	}
}

/**
 * Mint a fresh ed25519 invite secret: a random 32-byte seed (to be handed to
 * `pre_vouch` as `key` — via its derived pubkey — and later to `signClaim` by
 * whoever redeems the `/claim?k=` link) plus its derived pubkey, both
 * hex-encoded.
 */
export function newInviteSecret(): { seedHex: string; pubkeyHex: string } {
	const keypair = Keypair.random()
	return {
		seedHex: keypair.rawSecretKey().toString("hex"),
		pubkeyHex: keypair.rawPublicKey().toString("hex"),
	}
}
