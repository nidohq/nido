import {
	type AssembledTransaction,
	type SignTransaction,
} from "@stellar/stellar-sdk/contract"

/**
 * The result of a write call routed through `signAndSendWithSentinel`.
 *
 * `hash` is the submitted transaction's hash, when known. `submittedByWallet`
 * is `true` when the wallet itself already broadcast the transaction (the
 * Nido relayer / model A flow — see the sentinel note below) — in that case
 * we never reach the network ourselves, so no confirmed hash is available
 * here.
 */
export interface SendResult {
	hash?: string
	submittedByWallet: boolean
}

/**
 * Thrown from inside the `signTransaction` callback passed to
 * `AssembledTransaction#signAndSend` to short-circuit its broadcast step.
 *
 * IMPLEMENTATION ASSUMPTION: stellar-sdk's `signAndSend` does NOT catch or
 * wrap errors thrown from the `signTransaction` callback — it lets them
 * propagate as-is, so throwing here reliably aborts before the SDK submits
 * the transaction itself. If a future stellar-sdk version wraps callback
 * errors, this sentinel would be re-thrown from `signAndSend` instead of
 * being caught below, and the `submitted: true` path would incorrectly
 * surface as a failure.
 *
 * Ported verbatim (mechanism-wise) from
 * `examples/status-message-dapp/src/components/StatusMessage.tsx`'s `save()`.
 */
class AlreadySubmittedError extends Error {
	constructor() {
		super("nido:already_submitted")
		this.name = "AlreadySubmittedError"
	}
}

/**
 * Sign and send `tx`, guarding against double-submission by a wallet that
 * already broadcasts on the signer's behalf (the Nido relayer): when the
 * wallet's `signTransaction` result carries `submitted: true`, this throws a
 * sentinel from inside the callback so the SDK's own broadcast step never
 * runs, then reports `submittedByWallet: true` instead of treating that as
 * an error.
 */
export async function signAndSendWithSentinel(
	tx: AssembledTransaction<unknown>,
	signTransaction: SignTransaction,
): Promise<SendResult> {
	try {
		const sent = await tx.signAndSend({
			signTransaction: async (xdr, opts) => {
				const result = await signTransaction(xdr, opts)
				// When the Nido relayer submitted on our behalf, `result` carries
				// `submitted: true` and `signedTxXdr` is the tx hash. Throw the
				// sentinel so `signAndSend` never tries to broadcast.
				if (result && "submitted" in result && result.submitted) {
					throw new AlreadySubmittedError()
				}
				return result
			},
		})
		return {
			hash: sent.sendTransactionResponse?.hash,
			submittedByWallet: false,
		}
	} catch (e) {
		// Re-throw anything that isn't our own sentinel.
		if (!(e instanceof AlreadySubmittedError)) throw e
		// Otherwise: the wallet already submitted the tx — treat as success.
		return { submittedByWallet: true }
	}
}
