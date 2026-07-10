/**
 * The one shared Soroban RPC server for direct (non-generated-client) reads.
 * Pages that need "roughly now" in ledger time call `getLatestLedgerSeq()`
 * rather than each constructing their own `Server`.
 */

import { Server } from "@stellar/stellar-sdk/rpc"
import { rpcUrl, stellarNetwork } from "../contracts/util"

let server: Server | undefined

/** The network's latest ledger sequence, via a lazily-built shared server. */
export async function getLatestLedgerSeq(): Promise<number> {
	server ??= new Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" })
	const latest = await server.getLatestLedger()
	return latest.sequence
}
