/**
 * In-page signing of `update_message` with a delegated Nido session passkey —
 * no per-transaction redirect to the wallet.
 *
 * This is the payoff of "log in with Nido = create a passkey for this dApp"
 * (see `delegationHandover.ts`): once a session key is delegated, the dApp signs
 * the target contract's calls locally with that passkey (Touch ID / device
 * unlock at the dApp origin) and submits itself.
 *
 * A smart account (C-address) can't be a classic transaction source, so a
 * throwaway friendbot-funded G-address pays the fee and submits; the smart
 * account is only the auth *author*. Ported from the g2c frontend's
 * `status-message` page so the example is self-contained.
 */

import {
	buildAuthHash,
	computeAuthDigest,
	getAuthEntry,
	injectPasskeySignature,
	hex2buf,
	loadSessionKeyMaterial,
	forgetSessionKeyMaterial,
	signWithSessionPasskey,
} from "@g2c/passkey-sdk"
import {
	Keypair,
	TransactionBuilder,
	type Transaction,
	rpc,
	type xdr,
} from "@stellar/stellar-sdk"
import { Client } from "status_message"
import { rpcUrl, networkPassphrase } from "../contracts/util"
import { getFriendbotUrl } from "../util/friendbot"
import { withPasskeySheet } from "./passkeySheet"
import { findRuleForPubkey, fetchVerifierAddress } from "./policyChainFetch"

// Same key the g2c frontend uses for its status-message fee payer, so tooling
// that seeds a funded bank account (e.g. the e2e harness) funds this too.
const FEE_PAYER_KEY = "sm:keypairSecret"

/** True when a session passkey is already delegated for (account, contract). */
export function hasSessionKey(account: string, contractId: string): boolean {
	return loadSessionKeyMaterial(account, contractId) !== null
}

/**
 * Get (or lazily friendbot-fund) a throwaway G-address to pay fees and submit.
 * The smart account can't be a tx source; this classic account is.
 */
async function getOrCreateFeePayer(): Promise<Keypair> {
	const stored = localStorage.getItem(FEE_PAYER_KEY)
	if (stored) return Keypair.fromSecret(stored)
	const kp = Keypair.random()
	const resp = await fetch(getFriendbotUrl(kp.publicKey()))
	if (!resp.ok) throw new Error(`Friendbot funding failed: ${resp.statusText}`)
	localStorage.setItem(FEE_PAYER_KEY, kp.secret())
	return kp
}

export type SignProgress = (message: string) => void

/**
 * Build, session-passkey-sign in-page, and submit an `update_message` call.
 * Throws if no session key is delegated for (account, contractId) — the caller
 * should prompt the user to "Create dApp passkey" (delegate) first.
 */
export async function signUpdateMessageInPage(opts: {
	account: string
	message: string
	contractId: string
	onProgress?: SignProgress
}): Promise<{ hash: string }> {
	const { account, message, contractId, onProgress } = opts
	const note = (m: string) => onProgress?.(m)

	const material = loadSessionKeyMaterial(account, contractId)
	if (!material) {
		throw new Error(
			'No dApp passkey for this account — click "Create dApp passkey" to delegate one first.',
		)
	}

	note("Funding a fee payer…")
	const keypair = await getOrCreateFeePayer()

	note("Building transaction…")
	// A fresh client whose source/fee-payer is the funded G-address (the smart
	// account is only the auth author, passed as `author`).
	const client = new Client({
		contractId,
		networkPassphrase,
		rpcUrl,
		publicKey: keypair.publicKey(),
	})
	const tx = await client.update_message({ message, author: account }, { simulate: true })
	const sim = tx.simulation as rpc.Api.SimulateTransactionSuccessResponse
	const authEntry = getAuthEntry(sim)
	const lastLedger = sim.latestLedger
	const authHash = buildAuthHash(authEntry, networkPassphrase, lastLedger)

	note("Finding session rule on chain…")
	// The wallet's add_context_rule assigned some non-zero rule id; discover it
	// so the AuthPayload + the chain-recomputed digest reference the same rule.
	const ruleId = await findRuleForPubkey(account, material.publicKey)
	if (ruleId === null) {
		forgetSessionKeyMaterial(account, contractId)
		throw new Error(
			"Session passkey is not installed on chain (the delegation never committed). " +
				"Create the dApp passkey again.",
		)
	}
	const contextRuleIds = [ruleId]
	const verifierAddress = await fetchVerifierAddress(account)

	note("Touch your authenticator to sign…")
	// OZ v0.7+ accounts verify sha256(signature_payload || context_rule_ids.to_xdr()).
	const authDigest = computeAuthDigest(new Uint8Array(authHash), contextRuleIds)
	// Wrap the real in-page ceremony in the Nido-styled confirm sheet — the OS
	// passkey prompt is browser chrome we can't restyle, but this frames it.
	const parsed = await withPasskeySheet(
		() => signWithSessionPasskey(material.credentialId, new Uint8Array(authDigest)),
		{
			title: "Confirm it's you",
			sub: "Sign in-page with your dApp passkey.",
		},
	)
	const sessionPubkey = hex2buf(material.publicKey)

	// `tx.built` is the already-assembled tx; inject the session-key signature in
	// OZ v0.7 AuthPayload shape, threading the same contextRuleIds.
	const authTxn = tx.built!
	injectPasskeySignature(
		authTxn,
		parsed,
		verifierAddress,
		sessionPubkey,
		lastLedger,
		undefined,
		contextRuleIds,
	)

	note("Submitting…")
	const server = new rpc.Server(rpcUrl)
	// Re-simulate in enforce mode to recompute the footprint covering __check_auth.
	const sim2 = await server.simulateTransaction(authTxn, undefined, "enforce")
	if (rpc.Api.isSimulationError(sim2) || rpc.Api.isSimulationRestore(sim2)) {
		throw new Error(`Re-simulation failed: ${"error" in sim2 ? sim2.error : "restore needed"}`)
	}
	const successSim2 = sim2 as rpc.Api.SimulateTransactionSuccessResponse
	const newSorobanData = successSim2.transactionData.build()
	const newResourceFee = BigInt(newSorobanData.resourceFee().toString())

	// Round-trip through XDR to materialise a Transaction in THIS bundle's
	// stellar-sdk (TransactionBuilder.cloneFrom's instanceof check fails on the
	// bindings' bundled copy). Signed auth entries survive in the XDR.
	const reparsedAuthTxn = TransactionBuilder.fromXDR(
		authTxn.toEnvelope().toXDR("base64"),
		networkPassphrase,
	) as Transaction
	const oldResourceFee = BigInt(
		(reparsedAuthTxn.toEnvelope().v1().tx().ext().value() as xdr.SorobanTransactionData | undefined)
			?.resourceFee()
			.toString() ?? "0",
	)
	const classicFee = BigInt(reparsedAuthTxn.fee) - oldResourceFee
	const finalTx = TransactionBuilder.cloneFrom(reparsedAuthTxn, {
		fee: (classicFee + newResourceFee).toString(),
		sorobanData: newSorobanData,
		networkPassphrase,
	}).build()
	finalTx.sign(keypair)

	const sendResult = await server.sendTransaction(finalTx)
	if (sendResult.status === "ERROR") {
		throw new Error(
			`Transaction rejected: ${sendResult.errorResult?.toXDR("base64") ?? "unknown"}`,
		)
	}
	let getResult = await server.getTransaction(sendResult.hash)
	while (getResult.status === "NOT_FOUND") {
		await new Promise((r) => setTimeout(r, 1500))
		getResult = await server.getTransaction(sendResult.hash)
	}
	if (getResult.status !== "SUCCESS") {
		throw new Error(`Transaction failed: ${getResult.status}`)
	}
	return { hash: sendResult.hash }
}
