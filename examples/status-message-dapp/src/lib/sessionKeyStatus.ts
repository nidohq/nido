import {
	forgetSessionKeyMaterial,
	loadSessionKeyMaterial,
} from "@g2c/passkey-sdk"
import { findRuleForPubkey } from "./policyChainFetch"

export type SessionKeyStatus = "missing" | "live" | "revoked"

/**
 * Local session material is only a cache. The source of truth is the account's
 * live context rule; if the wallet revoked it, purge the dApp's stale pointer.
 */
export async function checkSessionKeyStatus(
	account: string,
	targetContract: string,
): Promise<SessionKeyStatus> {
	const material = loadSessionKeyMaterial(account, targetContract)
	if (!material) return "missing"

	const ruleId = await findRuleForPubkey(account, material.publicKey)
	if (ruleId === null) {
		forgetSessionKeyMaterial(account, targetContract)
		return "revoked"
	}
	return "live"
}
