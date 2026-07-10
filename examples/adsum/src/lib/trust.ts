/**
 * Data layer over the generated `web_of_trust` contract client
 * (`src/contracts/web_of_trust.ts`, itself a thin `Client` instance built
 * from `packages/web_of_trust/src/index.ts`). Pages import this module
 * rather than the generated client directly, so they never have to know
 * about `AssembledTransaction`, `Option<u32>`/`u32 | undefined`, `Result`
 * unwrapping, or how a claim's signature gets built.
 */

import { Buffer } from "buffer"
import webOfTrust from "../contracts/web_of_trust"
import { wallet } from "../util/wallet"
import { signClaim } from "./claimPayload"
import { signAndSendWithSentinel, type SendResult } from "./sentinel"

export type { SendResult }

/** UI-friendly view of a `PreVouch`. */
export interface PreVouchView {
	from: string
	/** `null` when the pre-vouch never expires (contract `Option<u32>`). */
	expires: number | null
	maxClaims: number
	claims: number
}

/** `number | null | undefined` -> the generated client's `Option<u32>` (`u32 | undefined`). */
function toOptionU32(value: number | null | undefined): number | undefined {
	return value == null ? undefined : value
}

/** `Option<u32>` (`u32 | undefined`) -> `number | null`, for `PreVouchView`. */
function fromOptionU32(value: number | undefined): number | null {
	return value === undefined ? null : value
}

function toPreVouchView(pv: {
	from: string
	expires: number | undefined
	max_claims: number
	claims: number
}): PreVouchView {
	return {
		from: pv.from,
		expires: fromOptionU32(pv.expires),
		maxClaims: pv.max_claims,
		claims: pv.claims,
	}
}

/** The addresses `a` vouches for. */
export async function fetchVouchesGiven(a: string): Promise<string[]> {
	const tx = await webOfTrust.vouches_given({ a })
	return tx.result
}

/** The addresses that vouch for `a`. */
export async function fetchVouchesReceived(a: string): Promise<string[]> {
	const tx = await webOfTrust.vouches_received({ a })
	return tx.result
}

/** Whether `from` has vouched for `to`. */
export async function hasVouched(from: string, to: string): Promise<boolean> {
	const tx = await webOfTrust.has_vouched({ from, to })
	return tx.result
}

/** Read the pre-vouch stored under `pubkeyHex`, or `null` if it doesn't exist. */
export async function fetchPreVouch(
	pubkeyHex: string,
): Promise<PreVouchView | null> {
	const tx = await webOfTrust.get_pre_vouch({
		key: Buffer.from(pubkeyHex, "hex"),
	})
	return tx.result ? toPreVouchView(tx.result) : null
}

/**
 * Vouch for `to` as `from` and sign/send it. Throws (without signing) if the
 * contract-level simulation reports an error (e.g. self-vouch or already
 * vouched).
 */
export async function vouchFor(from: string, to: string): Promise<SendResult> {
	const tx = await webOfTrust.vouch({ from, to }, { publicKey: from })
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	return signAndSendWithSentinel(tx, wallet.signTransaction)
}

/**
 * Revoke `from`'s vouch for `to` and sign/send it. Throws (without signing)
 * if the contract-level simulation reports an error (e.g. no such vouch).
 */
export async function revokeVouch(
	from: string,
	to: string,
): Promise<SendResult> {
	const tx = await webOfTrust.revoke({ from, to }, { publicKey: from })
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	return signAndSendWithSentinel(tx, wallet.signTransaction)
}

/**
 * Create a pre-vouch as `from` under `pubkeyHex` (the invite's derived
 * pubkey), sign/send it. Throws (without signing) if the contract-level
 * simulation reports an error (e.g. a duplicate key, zero `maxClaims`, or an
 * expiry in the past).
 */
export async function createPreVouch(
	from: string,
	pubkeyHex: string,
	expires: number | null | undefined,
	maxClaims: number,
): Promise<SendResult> {
	const tx = await webOfTrust.pre_vouch(
		{
			from,
			key: Buffer.from(pubkeyHex, "hex"),
			expires: toOptionU32(expires),
			max_claims: maxClaims,
		},
		{ publicKey: from },
	)
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	return signAndSendWithSentinel(tx, wallet.signTransaction)
}

/**
 * Revoke the pre-vouch `from` created under `pubkeyHex`, deleting whatever
 * unclaimed uses remain, and sign/send it. Throws (without signing) if the
 * contract-level simulation reports an error (e.g. the pre-vouch doesn't
 * exist, or `from` isn't its creator).
 */
export async function revokePreVouch(
	from: string,
	pubkeyHex: string,
): Promise<SendResult> {
	const tx = await webOfTrust.revoke_pre_vouch(
		{ from, key: Buffer.from(pubkeyHex, "hex") },
		{ publicKey: from },
	)
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	return signAndSendWithSentinel(tx, wallet.signTransaction)
}

/**
 * Redeem the pre-vouch created under invite secret `seedHex`, claiming it
 * for `to`. Builds the ed25519 signature over the claim payload itself
 * (`signClaim`) — the claimant's wallet (`to`) is the transaction source,
 * not the pre-vouch's creator; the invite secret's signature is what
 * authorizes the claim on-chain, not a wallet auth entry. Throws (without
 * signing) if the contract-level simulation reports an error (e.g. the
 * pre-vouch doesn't exist, is expired, or `to` already vouched-for).
 */
export async function claimVouch(
	seedHex: string,
	to: string,
): Promise<SendResult> {
	const { contractId } = webOfTrust.options
	const { key, sig } = signClaim(seedHex, contractId, to)
	const tx = await webOfTrust.claim_vouch(
		{ key: Buffer.from(key), to, sig: Buffer.from(sig) },
		{ publicKey: to },
	)
	if (tx.result.isErr()) {
		throw new Error(tx.result.unwrapErr().message)
	}
	return signAndSendWithSentinel(tx, wallet.signTransaction)
}
