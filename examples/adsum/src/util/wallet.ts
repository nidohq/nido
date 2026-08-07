/**
 * wallet.ts — wires the @creit.tech/stellar-wallets-kit wallet selector with the
 * Nido passkey smart account registered alongside the standard wallets, so Nido
 * shows up IN the kit's picker. Adapted from the Nido repo's
 * `packages/frontend/src/lib/walletConnect.ts` and the scaffold's own wallet
 * helper.
 *
 * Kit v2.2.0 API notes (the scaffold default shipped v1.9.5, which differs):
 *   - `StellarWalletsKit` is entirely STATIC — `StellarWalletsKit.init({...})`,
 *     not `new StellarWalletsKit(...)`.
 *   - The selector modal is `StellarWalletsKit.authModal()`, which both selects
 *     the module AND fetches the address, then resolves `{ address }`. On the
 *     user closing it the promise REJECTS.
 *   - `allowAllModules()` was removed; we instantiate the standard modules
 *     explicitly in `./walletModules`.
 *   - `WalletNetwork` was renamed `Networks` (see ../contracts/util).
 */

import {
	StellarWalletsKit,
	type ModuleInterface,
} from "@creit.tech/stellar-wallets-kit"
import { NidoModule, NIDO_ID } from "@nidohq/stellar-wallets-kit-module"
import { isContractId } from "@nidohq/passkey-sdk"
import { Horizon } from "@stellar/stellar-sdk"
import { networkPassphrase, stellarNetwork } from "../contracts/util"
import { withNidoFirst } from "./moduleOrder"
import storage from "./storage"

export { NIDO_ID }

/**
 * The Nido deployment apex origin (e.g. `https://nido.fyi`). The module
 * opens `<base>/connect/` for account selection and `<account>.<base>/sign/`
 * for the passkey ceremony.
 */
export function nidoBase(): string {
	return import.meta.env.PUBLIC_NIDO_BASE ?? "https://nido.fyi"
}

/**
 * Build the module list with Nido FIRST, followed by the standard wallets. Pure
 * (no kit interaction) so it can be unit-tested without a browser.
 */
export function buildModules(params: {
	base: string
	networkPassphrase: string
	standard: ModuleInterface[]
}): ModuleInterface[] {
	const nido = new NidoModule({
		base: params.base,
		networkPassphrase: params.networkPassphrase,
	})
	return withNidoFirst(nido, params.standard)
}

let inited = false

/**
 * Initialise the kit ONCE with Nido + the standard wallets. Idempotent. The
 * standard wallet SDKs are imported lazily so the rest of this module stays
 * importable (and unit-testable) without pulling them in.
 */
export async function initWalletKit(): Promise<void> {
	if (inited) return
	const { standardModules } = await import("./walletModules")
	StellarWalletsKit.init({
		modules: buildModules({
			base: nidoBase(),
			networkPassphrase,
			standard: standardModules(),
		}),
	})
	inited = true
}

/**
 * Open the selector modal, connect, and persist the chosen wallet id + address.
 * Mirrors the scaffold's localStorage persistence so `WalletProvider` can
 * restore the session on reload.
 */
export const connectWallet = async () => {
	await initWalletKit()
	try {
		const { address } = await StellarWalletsKit.authModal()
		const selectedId = StellarWalletsKit.selectedModule.productId
		if (address) {
			storage.setItem("walletId", selectedId)
			storage.setItem("walletAddress", address)
			// TODO(adsum UI task): auto-start session-key delegation on interactive
			// Nido connect (ported from lib/delegationHandover.ts, not carried into
			// this scaffold task).
		} else {
			storage.setItem("walletId", "")
			storage.setItem("walletAddress", "")
		}
	} catch {
		// authModal rejects when the user closes the modal — leave state as-is.
	}
}

export const disconnectWallet = async () => {
	try {
		await StellarWalletsKit.disconnect()
	} catch {
		/* nothing connected in this kit instance — local clear below is enough */
	}
	storage.removeItem("walletId")
	storage.removeItem("walletAddress")
	storage.removeItem("walletNetwork")
	storage.removeItem("networkPassphrase")
}

/**
 * The subset of the static kit the `WalletProvider` drives, plus our one-time
 * init. Exposed as an object so the provider can keep the scaffold's shape
 * (`wallet.setWallet`, `wallet.getAddress`, ...).
 */
export const wallet = {
	init: initWalletKit,
	setWallet: (id: string) => StellarWalletsKit.setWallet(id),
	getAddress: () => StellarWalletsKit.getAddress(),
	getNetwork: () => StellarWalletsKit.getNetwork(),
	disconnect: () => StellarWalletsKit.disconnect(),
	signTransaction: async (
		xdr: string,
		opts?: { networkPassphrase?: string; address?: string; path?: string },
	) => {
		try {
			return await StellarWalletsKit.signTransaction(xdr, opts)
		} catch (e) {
			// The Nido sign popup's "Use a different account" button rejects with
			// this typed error: the wallet has already dropped its cached account,
			// so drop our session too — the next Connect reopens the picker.
			if (e instanceof Error && e.name === "ACCOUNT_SWITCH_REQUESTED") {
				await disconnectWallet()
				throw new Error(
					"You chose to use a different account. Connect again, pick the account you want, then retry.",
				)
			}
			throw e
		}
	},
}

function getHorizonHost(mode: string) {
	switch (mode) {
		case "LOCAL":
			return "http://localhost:8000"
		case "FUTURENET":
			return "https://horizon-futurenet.stellar.org"
		case "TESTNET":
			return "https://horizon-testnet.stellar.org"
		case "PUBLIC":
			return "https://horizon.stellar.org"
		default:
			throw new Error(`Unknown Stellar network: ${mode}`)
	}
}

const horizon = new Horizon.Server(getHorizonHost(stellarNetwork), {
	allowHttp: stellarNetwork === "LOCAL",
})

const formatter = new Intl.NumberFormat()

export type MappedBalances = Record<string, Horizon.HorizonApi.BalanceLine>

export const fetchBalances = async (address: string): Promise<MappedBalances> => {
	// A Soroban smart account (C-address) is NOT a classic Horizon account, so
	// `/accounts/<C…>` just 404s. Its native XLM lives as a Stellar Asset
	// Contract balance, read over Soroban RPC instead (see lib/balance.ts in
	// status-message-dapp) — not carried into this scaffold task, so C-address
	// balances read as empty for now.
	// TODO(adsum UI task): restore XLM balance display for C-addresses.
	if (isContractId(address)) {
		return {}
	}

	try {
		const { balances } = await horizon.accounts().accountId(address).call()
		const mapped = balances.reduce((acc, b) => {
			b.balance = formatter.format(Number(b.balance))
			const key =
				b.asset_type === "native"
					? "xlm"
					: b.asset_type === "liquidity_pool_shares"
						? b.liquidity_pool_id
						: `${b.asset_code}:${b.asset_issuer}`
			acc[key] = b
			return acc
		}, {} as MappedBalances)
		return mapped
	} catch (err) {
		// `not found` is expected for an unfunded classic account (no `xlm` key).
		if (!(err instanceof Error && err.message.match(/not found/i))) {
			console.error(err)
		}
		return {}
	}
}
