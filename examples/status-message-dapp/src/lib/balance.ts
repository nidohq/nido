/**
 * Balance reads for the connected account.
 *
 * A classic G-address has its balances on Horizon's `/accounts` endpoint. A
 * Soroban smart account (C-address) does NOT — Horizon can't resolve a contract
 * id. Its XLM lives as a Stellar Asset Contract (SAC) balance, read by
 * simulating the native SAC's `balance(addr) -> i128` over Soroban RPC.
 */

import {
	rpc,
	Contract,
	Address,
	Asset,
	Account,
	TransactionBuilder,
	scValToNative,
} from "@stellar/stellar-sdk"
import { rpcUrl, networkPassphrase, stellarNetwork } from "../contracts/util"

const STROOPS_PER_XLM = 10_000_000n

/**
 * Render an i128 stroop amount (7 decimals) as a trimmed XLM string.
 * `bigint` math keeps full precision for amounts beyond `Number.MAX_SAFE_INTEGER`.
 */
export function formatStroops(stroops: bigint): string {
	const neg = stroops < 0n
	const abs = neg ? -stroops : stroops
	const whole = abs / STROOPS_PER_XLM
	const frac = abs % STROOPS_PER_XLM

	let out: string
	if (frac === 0n) {
		out = whole.toString()
	} else {
		const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "")
		out = `${whole}.${fracStr}`
	}
	return neg ? `-${out}` : out
}

// Dummy all-zero source account — fine for a read-only simulation.
const READONLY_SOURCE =
	"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

/**
 * Read a Soroban smart account's native XLM balance via the native SAC's
 * `balance(addr) -> i128` view. Returns the raw stroop amount, or `null` when
 * the balance can't be read (simulation error, or the holder has no entry yet).
 */
export async function fetchContractXlmBalance(
	address: string,
): Promise<bigint | null> {
	try {
		const server = new rpc.Server(rpcUrl, {
			allowHttp: stellarNetwork === "LOCAL",
		})
		const sac = new Contract(Asset.native().contractId(networkPassphrase))
		const source = new Account(READONLY_SOURCE, "0")
		const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase })
			.addOperation(sac.call("balance", Address.fromString(address).toScVal()))
			.setTimeout(0)
			.build()

		const sim = await server.simulateTransaction(tx)
		if (rpc.Api.isSimulationError(sim)) return null
		const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result
		if (!result) return null
		return scValToNative(result.retval) as bigint
	} catch {
		return null
	}
}
