/**
 * Decode a Soroban authorization entry into a human-readable summary of the
 * operation it authorises — so the confirm sheet shows what's ACTUALLY being
 * signed (what-you-see-is-what-you-sign), derived from the signed payload
 * rather than restated from app-level inputs.
 */

import { xdr, Address, scValToNative } from "@stellar/stellar-sdk"
import type { PasskeyDetail } from "./passkeySheet"

export interface DecodedCall {
	/** Contract being invoked (C-address). */
	contract: string
	/** Function name. */
	fn: string
	/** Positional args, decoded to native JS values. */
	args: unknown[]
}

const CONTRACT_FN = "sorobanAuthorizedFunctionTypeContractFn"

/**
 * Decode the root contract call an auth entry's invocation authorises. Returns
 * null if the authorised function isn't a contract invocation (e.g. a
 * create-contract host function), in which case the caller should fall back.
 */
export function decodeContractCall(
	invocation: xdr.SorobanAuthorizedInvocation,
): DecodedCall | null {
	const fn = invocation.function()
	if (fn.switch().name !== CONTRACT_FN) return null
	const call = fn.contractFn()
	return {
		contract: Address.fromScAddress(call.contractAddress()).toString(),
		fn: call.functionName().toString(),
		args: call.args().map((a) => scValToNative(a)),
	}
}

/** True for an uppercase base32 strkey (C…/G…/M…), 56 chars. */
function isStrkey(s: string): boolean {
	return s.length === 56 && /^[A-Z2-7]+$/.test(s)
}

/** Compact a strkey to `CBXVJX…GNDM`; pass anything else through unchanged. */
export function shortenStrkey(s: string): string {
	return isStrkey(s) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s
}

/** Render a decoded arg value: shorten addresses, stringify everything else. */
function formatValue(v: unknown): string {
	if (typeof v === "string") return shortenStrkey(v)
	if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") {
		return String(v)
	}
	try {
		return JSON.stringify(v)
	} catch {
		return String(v)
	}
}

/**
 * Build the confirm sheet's approval rows from a decoded call. `paramNames`
 * (from the contract spec) labels the args; a missing name falls back to
 * `arg N`. Values stay raw text — the sheet renders them via textContent.
 */
export function buildApprovalDetails(
	call: DecodedCall,
	paramNames: string[],
): PasskeyDetail[] {
	const rows: PasskeyDetail[] = [
		{ label: "Operation", value: call.fn },
		{ label: "Contract", value: shortenStrkey(call.contract) },
	]
	call.args.forEach((arg, i) => {
		rows.push({ label: paramNames[i] || `arg ${i + 1}`, value: formatValue(arg) })
	})
	return rows
}
