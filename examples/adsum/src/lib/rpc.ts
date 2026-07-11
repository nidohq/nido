/**
 * The one shared Soroban RPC server for direct (non-generated-client) reads.
 * Pages that need "roughly now" in ledger time call `getLatestLedgerSeq()`
 * rather than each constructing their own `Server`.
 */

import { Server } from "@stellar/stellar-sdk/rpc"
import { rpcUrl } from "../contracts/util"

let server: Server | undefined

/** The network's latest ledger sequence, via a lazily-built shared server. */
export async function getLatestLedgerSeq(): Promise<number> {
	// Derived from the URL scheme (not the network name) so this stays
	// correct even if a network is ever pointed at a non-default rpcUrl --
	// see src/contracts/{petitions,web_of_trust}.ts for the same derivation.
	server ??= new Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") })
	const latest = await server.getLatestLedger()
	return latest.sequence
}
