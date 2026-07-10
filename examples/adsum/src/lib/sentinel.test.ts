import {
	type AssembledTransaction,
	type SignTransaction,
} from "@stellar/stellar-sdk/contract"
import { describe, expect, it, vi } from "vitest"
import { signAndSendWithSentinel } from "./sentinel"

/**
 * A fake `AssembledTransaction` whose `signAndSend` mirrors the shape of the
 * real one closely enough to exercise the sentinel: it calls the provided
 * `signTransaction` callback (which may throw the sentinel), and only then
 * calls `broadcast()` — standing in for the SDK's real network submit step.
 * If the sentinel is working, `broadcast` must never be reached.
 */
function fakeTx() {
	const broadcast = vi.fn(() => ({
		sendTransactionResponse: { hash: "network-hash" },
	}))
	const tx = {
		signAndSend: async ({
			signTransaction,
		}: {
			signTransaction: SignTransaction
		}) => {
			const signed = await signTransaction("fake-xdr", {})
			// A real signAndSend would broadcast the signed envelope here.
			return broadcast(signed)
		},
	}
	return { tx: tx as unknown as AssembledTransaction<unknown>, broadcast }
}

describe("signAndSendWithSentinel", () => {
	it("short-circuits when the wallet reports it already submitted the tx", async () => {
		const { tx, broadcast } = fakeTx()
		const signTransaction = vi.fn(async () => ({
			signedTxXdr: "hash-abc",
			submitted: true,
		}))

		const result = await signAndSendWithSentinel(tx, signTransaction)

		expect(result).toEqual({ submittedByWallet: true })
		expect(broadcast).not.toHaveBeenCalled()
	})

	it("returns the network hash on a normal sign-and-send", async () => {
		const { tx, broadcast } = fakeTx()
		const signTransaction = vi.fn(async () => ({
			signedTxXdr: "signed-xdr",
		}))

		const result = await signAndSendWithSentinel(tx, signTransaction)

		expect(result).toEqual({ hash: "network-hash", submittedByWallet: false })
		expect(broadcast).toHaveBeenCalledOnce()
	})

	it("re-throws errors that are not the sentinel", async () => {
		const { tx } = fakeTx()
		const boom = new Error("boom")
		const signTransaction = vi.fn(async () => {
			throw boom
		})

		await expect(signAndSendWithSentinel(tx, signTransaction)).rejects.toBe(
			boom,
		)
	})
})
