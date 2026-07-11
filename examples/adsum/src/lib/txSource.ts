/**
 * Picks the `AssembledTransaction` build-time source for a write, given the
 * acting address (`petitions.ts`/`trust.ts`'s `address`/`from`/`to`).
 *
 * `AssembledTransaction` requires an ed25519 (G) source account to build —
 * it throws "invalid version byte. expected 48, got 16" on a contract (C)
 * source. Nido smart accounts ARE C-addresses, so every write here needs a
 * stand-in G to build with when the actor is a smart account. The contract
 * ARGS still carry the real C/G actor — only the client's `{ publicKey }`
 * build option changes — so the auth entry generated still targets the real
 * acting address; the tx source itself never signs or pays (the Nido
 * relayer's channel accounts re-source the transaction before submission).
 *
 * Mirrors `examples/status-message-dapp/src/lib/nidoSign.ts`'s
 * `RELAYER_SIM_SOURCE` (same constant, same rationale: recording-mode
 * simulation just needs SOME existing on-chain G account to build against).
 */

import { StrKey } from "@stellar/stellar-sdk"

/**
 * Recording-mode simulation source for smart-account (C-address) writes.
 * The tx source pays nothing on the Nido path — the wallet re-sources the
 * transaction via the relayer's channel accounts before real submission —
 * so this only needs to be SOME existing, ed25519-keyed account for
 * `AssembledTransaction` to build against. The Nido relayer's public fund
 * address is always funded on testnet, so it serves as a constant sim
 * source with no friendbot and no locally stored keypair required (see
 * `examples/status-message-dapp/src/lib/nidoSign.ts`'s `RELAYER_SIM_SOURCE`
 * for the precedent). Testnet-only: a mainnet deployment would need its own
 * funded constant.
 */
export const RELAYER_SIM_SOURCE =
	"GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"

/**
 * The `AssembledTransaction` build source for `actor`: `RELAYER_SIM_SOURCE`
 * when `actor` is a contract (C) strkey — the ed25519 stand-in
 * `AssembledTransaction` needs to build at all — otherwise `actor` itself
 * (a classic G wallet builds with its own address, unchanged). Not a
 * validator: anything that isn't a recognized contract strkey (including
 * junk) passes through unchanged.
 */
export function txSourceFor(actor: string): string {
	return StrKey.isValidContract(actor) ? RELAYER_SIM_SOURCE : actor
}
