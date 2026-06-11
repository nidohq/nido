/**
 * On-chain reads needed to sign a target-contract call with a delegated session
 * passkey. Trimmed port of the g2c frontend's `policyChainFetch.ts` — just the
 * two lookups the in-page signer needs:
 *
 *   - `findRuleForPubkey`   — which context-rule id holds our session key.
 *   - `fetchVerifierAddress` — the WebAuthn verifier the account actually trusts.
 *
 * Network config comes from the example's `../contracts/util` so it follows
 * `PUBLIC_STELLAR_*` (testnet for the hosted demo, local for `npm start`).
 */

import { fetchRegistryAddress as sdkFetchRegistryAddress } from "@g2c/passkey-sdk"
import {
	rpc,
	Contract,
	TransactionBuilder,
	Account,
	nativeToScVal,
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

/** OZ's SmartAccountError::ContextRuleNotFound surfaces from a failed
 *  simulation as `Error(Contract, #3000)`. Rule ids are MONOTONIC and never
 *  reused, while `get_context_rules_count` only counts live rules — so any
 *  revoke that isn't the newest rule leaves an id gap that panics
 *  `get_context_rule`. Enumerators must treat this error as "skip". */
function isRuleNotFound(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /Error\(Contract, #3000\)|ContextRuleNotFound/.test(msg)
}

/**
 * Find the context-rule id on `account` whose External signer carries the given
 * public key (hex). Returns `null` if no such rule exists — e.g. the delegation
 * install tx never committed, or the rule was revoked.
 *
 * The wallet's `add_context_rule` assigns a non-zero rule id when it installs
 * the delegation; we can't hard-code `[0]` (the default rule for the primary
 * passkey), so we discover it by scanning every rule. Cheap and self-healing.
 */
export async function findRuleForPubkey(
	account: string,
	pubkeyHex: string,
): Promise<number | null> {
	const server = new rpc.Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })
	const countRv = await simulateView(server, new Contract(account), "get_context_rules_count")
	const count = scValToNative(countRv) as number
	const lowerHex = pubkeyHex.toLowerCase()
	// Gap-tolerant id scan — revoking any non-newest rule leaves an id gap
	// (see isRuleNotFound). The bound only stops a pathological account from
	// looping forever.
	for (let id = 0, found = 0; found < count && id < count + 100; id++) {
		let ruleRv: xdr.ScVal
		try {
			ruleRv = await simulateView(
				server,
				new Contract(account),
				"get_context_rule",
				nativeToScVal(id, { type: "u32" }),
			)
		} catch (err) {
			if (isRuleNotFound(err)) continue
			throw err
		}
		found++
		const native = scValToNative(ruleRv) as { id?: number; signers?: unknown[] }
		for (const s of native.signers ?? []) {
			// ["External", verifier, pubkey_bytes_as_array_or_buffer]
			if (Array.isArray(s) && s[0] === "External") {
				const candidateHex = bytesToHex(s[2])
				if (candidateHex && candidateHex === lowerHex) {
					return native.id ?? id
				}
			}
		}
	}
	return null
}

/**
 * Read the verifier address the account's default rule references. Reads
 * `get_context_rule(0).signers` raw (the typed bindings' ContextRule shape can
 * mismatch across soroban-sdk minors). Falls back to the registry if the
 * account has no External signer on rule 0.
 */
export async function fetchVerifierAddress(account: string): Promise<string> {
	try {
		const server = new rpc.Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })
		const rv = await simulateView(
			server,
			new Contract(account),
			"get_context_rule",
			nativeToScVal(0, { type: "u32" }),
		)
		const native = scValToNative(rv) as { signers?: unknown[] }
		for (const s of native.signers ?? []) {
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

/** Normalise the various shapes `scValToNative` hands back for a bytes field. */
function bytesToHex(raw: unknown): string | null {
	if (raw instanceof Uint8Array) {
		return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("")
	}
	if (Array.isArray(raw)) {
		return (raw as number[]).map((b) => b.toString(16).padStart(2, "0")).join("")
	}
	if (typeof raw === "object" && raw !== null) {
		// Sometimes handed back as an object with numeric keys; rebuild as bytes.
		const obj = raw as Record<string, number>
		const ordered: number[] = []
		for (let j = 0; ; j++) {
			const b = obj[j as unknown as string]
			if (b === undefined) break
			ordered.push(b)
		}
		if (ordered.length > 0) {
			return ordered.map((b) => b.toString(16).padStart(2, "0")).join("")
		}
	}
	return null
}
