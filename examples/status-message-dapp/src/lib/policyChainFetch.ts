/**
 * On-chain reads needed to sign a target-contract call with a delegated session
 * passkey. Trimmed port of the Nido frontend's `policyChainFetch.ts` — just the
 * two lookups the in-page signer needs:
 *
 *   - `findRuleForPubkey`   — which context-rule id our session key signs through.
 *   - `fetchVerifierAddress` — the WebAuthn verifier the account actually trusts.
 *
 * Network config comes from the example's `../contracts/util` so it follows
 * `PUBLIC_STELLAR_*` (testnet for the hosted demo, local for `npm start`).
 */

import { fetchRegistryAddress as sdkFetchRegistryAddress, perch } from "@nidohq/passkey-sdk"
import {
	rpc,
	Contract,
	TransactionBuilder,
	Account,
	scValToNative,
	type xdr,
} from "@stellar/stellar-sdk"
import { rpcUrl, networkPassphrase, stellarNetwork } from "../contracts/util"

// Unverified testnet registry (bare-name → contract-id). Only consulted in the
// rare fallback where an account's default rule has no External signer.
const TESTNET_REGISTRY = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S"

/** Simulate-only invocation of a contract view method. Returns the result ScVal. */
async function simulateView(
	server: rpc.Server,
	contract: Contract,
	method: string,
	...args: xdr.ScVal[]
): Promise<xdr.ScVal> {
	// Dummy all-zero source account — fine for read-only simulation.
	const sourceAccount = new Account(
		"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
		"0",
	)
	const tx = new TransactionBuilder(sourceAccount, {
		fee: "100",
		networkPassphrase,
	})
		.addOperation(contract.call(method, ...args))
		.setTimeout(0)
		.build()
	const sim = await server.simulateTransaction(tx)
	if (rpc.Api.isSimulationError(sim)) {
		throw new Error(`simulateView ${method}: ${sim.error}`)
	}
	const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result
	if (!result) throw new Error(`simulateView ${method}: no result`)
	return result.retval
}

/** One installed rule as the account's `configuration()` view reports it
 *  (Perch's consumer interface, stellar-registry/perch#108), decoded raw. */
interface InstalledRule {
	id: number | bigint
	recovery: boolean
	name: string
	signers: unknown[]
}

/** The account's installed rules, from one `configuration()` read: every
 *  rule's id, name, and signers at one revision, so no id scan is needed
 *  (OZ never reuses an id, and a document gives a replaced rule a new one). */
async function installedRules(account: string): Promise<InstalledRule[]> {
	const server = new rpc.Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })
	const rv = await simulateView(server, new Contract(account), "configuration")
	return (scValToNative(rv) as { rules: InstalledRule[] }).rules
}

/**
 * The context-rule id our session key (hex public key) signs a call on
 * `target` through, or `null` when it has none: the delegation never
 * committed, the account's owner removed this app, or a recovery ended its
 * permissions.
 *
 * The wallet keeps each app origin's permissions in a scoped document of
 * their own, whose id it derives from the origin, so the rule is looked up
 * in this origin's scope, then in the account's admin document for a key let
 * in before apps had scopes (`perch.findAppRule`). Ids move whenever a scope
 * is applied again, so they are looked up, never hard-coded.
 */
export async function findRuleForPubkey(
	account: string,
	pubkeyHex: string,
	target: string,
): Promise<number | null> {
	const verifier = await fetchVerifierAddress(account)
	const found = await perch.findAppRule(
		perch.scopeReader({ account, rpcUrl, networkPassphrase, allowHttp: stellarNetwork === "LOCAL" }),
		{ origin: window.location.origin, key: { verifier, key: pubkeyHex.toLowerCase() }, contract: target },
	)
	return found?.ruleId ?? null
}

/**
 * The verifier the account's admin passkey is registered against: the first
 * External signer of its `admin` rule, from `configuration()`. Falls back to
 * the registry if the account has no such signer.
 */
export async function fetchVerifierAddress(account: string): Promise<string> {
	try {
		const admin = (await installedRules(account)).find((r) => !r.recovery && r.name === "admin")
		for (const s of admin?.signers ?? []) {
			// ["External", verifier_address, pubkey_bytes]
			if (Array.isArray(s) && s[0] === "External" && typeof s[1] === "string") {
				return s[1]
			}
		}
	} catch {
		// fall through to registry
	}
	return sdkFetchRegistryAddress("verifier", {
		rpcUrl,
		networkPassphrase,
		registryId: TESTNET_REGISTRY,
	})
}
