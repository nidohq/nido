/**
 * wallet.ts — wires the @creit.tech/stellar-wallets-kit wallet selector with the
 * g2c passkey smart account registered alongside the standard wallets, so g2c
 * shows up IN the kit's picker. Adapted from the g2c repo's
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
import { G2cModule, G2C_ID } from "@g2c/stellar-wallets-kit-module"
import { Horizon } from "@stellar/stellar-sdk"
import { networkPassphrase, stellarNetwork } from "../contracts/util"
import { withG2cFirst } from "./moduleOrder"
import storage from "./storage"

export { G2C_ID }

/**
 * The g2c deployment apex origin (e.g. `https://mysoroban.xyz`). The module
 * opens `<base>/connect/` for account selection and `<account>.<base>/sign/`
 * for the passkey ceremony.
 */
export function g2cBase(): string {
	return import.meta.env.PUBLIC_G2C_BASE ?? "https://mysoroban.xyz"
}

/**
 * Build the module list with g2c FIRST, followed by the standard wallets. Pure
 * (no kit interaction) so it can be unit-tested without a browser.
 */
export function buildModules(params: {
	base: string
	networkPassphrase: string
	standard: ModuleInterface[]
}): ModuleInterface[] {
	const g2c = new G2cModule({
		base: params.base,
		networkPassphrase: params.networkPassphrase,
	})
	return withG2cFirst(g2c, params.standard)
}

let inited = false

/**
 * Initialise the kit ONCE with g2c + the standard wallets. Idempotent. The
 * standard wallet SDKs are imported lazily so the rest of this module stays
 * importable (and unit-testable) without pulling them in.
 */
export async function initWalletKit(): Promise<void> {
	if (inited) return
	const { standardModules } = await import("./walletModules")
	StellarWalletsKit.init({
		modules: buildModules({
			base: g2cBase(),
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
	signTransaction: (
		xdr: string,
		opts?: { networkPassphrase?: string; address?: string; path?: string },
	) => StellarWalletsKit.signTransaction(xdr, opts),
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

export const fetchBalances = async (address: string) => {
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
		// `not found` is expected for an unfunded wallet (no `xlm` key results).
		if (!(err instanceof Error && err.message.match(/not found/i))) {
			console.error(err)
		}
		return {}
	}
}
