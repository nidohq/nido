/**
 * Submit strategies extracted from signAndSubmit.
 *
 * - relayerSubmitAndConfirm: ships {func, auth} to the Channels relayer and
 *   polls until confirmed. Skips enforce re-sim (Channels does it server-side).
 * - classicSubmitAndPoll: enforce re-sim + fee refit + sign + RPC send + poll.
 */
import { rpc, TransactionBuilder, Keypair, xdr } from "@stellar/stellar-sdk";
import type { Transaction } from "@stellar/stellar-sdk";
import {
  type RelayerStatus,
  RelayerError,
  extractFuncAndAuth,
  submitSorobanTransaction,
  waitForConfirmation,
} from "../relayerClient";
import { RELAYER_URL, NETWORK_PASSPHRASE } from "../network";

export { type RelayerStatus };

/**
 * Normalize a failure raised AFTER the signed authorization was sent into a
 * RelayerError whose code marks the payment's outcome uncertain (so the retry
 * guard blocks a fresh-payment retry). WAIT_TIMEOUT / ONCHAIN_FAILED already
 * carry that meaning (and their attached last-poll details), so they pass
 * through unchanged; everything else — a bare connection-loss error, a non-JSON
 * body, acceptance without a transaction handle, or a relayer-reported failure
 * carrying any server-supplied code — collapses to SUBMIT_UNKNOWN. The
 * server-supplied code is deliberately discarded here: once we have sent the
 * authorization, only trusted on-chain reconciliation (handled by the caller)
 * may re-open a retry, never the relayer's own word.
 */
function uncertainSubmitError(err: unknown): RelayerError {
  if (err instanceof RelayerError && (err.code === "WAIT_TIMEOUT" || err.code === "ONCHAIN_FAILED")) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  const details = err instanceof RelayerError ? err.details : undefined;
  return new RelayerError(message, "SUBMIT_UNKNOWN", details);
}

export async function relayerSubmitAndConfirm(
  signedTx: Transaction,
  opts?: {
    onPoll?: (info: {
      status: RelayerStatus | null;
      attempt: number;
      maxAttempts: number;
    }) => void;
    baseUrl?: string;
  },
): Promise<{ hash: string }> {
  const baseUrl = opts?.baseUrl ?? RELAYER_URL;
  const { func, auth } = extractFuncAndAuth(signedTx);
  if (auth.length > 1) {
    throw new Error(
      `Expected a single auth entry, got ${auth.length} — only the first is passkey-signed.`,
    );
  }
  // From here the signed authorization leaves the browser. The relayer may hold
  // a usable copy the instant we start the POST, so EVERY failure past this
  // point is an uncertain outcome, not a safe no-event — including a missing
  // transaction handle (acceptance we cannot track) or a confirmation without a
  // hash (a tx that already landed). Funnel them all through
  // uncertainSubmitError so a fresh-payment retry stays blocked.
  try {
    const submitted = await submitSorobanTransaction({ func, auth }, baseUrl);
    if (!submitted.transactionId) {
      throw new RelayerError(
        "Relayer accepted the transaction but returned no transaction id",
        "SUBMIT_UNKNOWN",
      );
    }
    const confirmed = await waitForConfirmation(submitted.transactionId, baseUrl, {
      onPoll: opts?.onPoll,
    });
    if (!confirmed.hash) {
      throw new RelayerError("Relayer confirmed without a transaction hash", "SUBMIT_UNKNOWN");
    }
    return { hash: confirmed.hash };
  } catch (err) {
    throw uncertainSubmitError(err);
  }
}

export async function classicSubmitAndPoll(
  assembledTx: Transaction,
  submitter: Keypair,
  server: rpc.Server,
): Promise<rpc.Api.SendTransactionResponse> {
  // Re-simulate in ENFORCE mode — verifies the auth and recomputes the
  // resource footprint to cover __check_auth's reads.
  const final_sim = await server.simulateTransaction(assembledTx, undefined, "enforce");
  if (rpc.Api.isSimulationError(final_sim)) {
    throw new Error(
      `Final simulation failed: ${(final_sim as rpc.Api.SimulateTransactionErrorResponse).error}`,
    );
  }
  const successFinalSim = final_sim as rpc.Api.SimulateTransactionSuccessResponse;
  const newSorobanData = successFinalSim.transactionData.build();
  const newResourceFee = BigInt(newSorobanData.resourceFee().toString());
  const classicFee =
    BigInt(assembledTx.fee) -
    BigInt(
      (
        assembledTx
          .toEnvelope()
          .v1()
          .tx()
          .ext()
          .value() as xdr.SorobanTransactionData | undefined
      )
        ?.resourceFee()
        .toString() ?? "0",
    );
  const refittedBuilder = TransactionBuilder.cloneFrom(assembledTx, {
    fee: (classicFee + newResourceFee).toString(),
    sorobanData: newSorobanData,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  // cloneFrom carries operations across as-is (including the signed auth
  // entries on our InvokeHostFunction op). build() emits a new Transaction
  // with the right footprint AND our signature intact.
  const refitted_tx = refittedBuilder.build();
  refitted_tx.sign(submitter);
  const sendResult = await server.sendTransaction(refitted_tx);
  if (sendResult.status === "ERROR") {
    const detail = sendResult.errorResult?.toXDR("base64") ?? "unknown";
    throw new Error(`Submit rejected: ${detail}`);
  }
  if (sendResult.status === "DUPLICATE" || sendResult.status === "TRY_AGAIN_LATER") {
    throw new Error(`Submit ${sendResult.status}: ${sendResult.hash}`);
  }
  // PENDING — poll until we see SUCCESS or FAILED.
  let getResult = await server.getTransaction(sendResult.hash);
  for (let i = 0; getResult.status === "NOT_FOUND" && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(sendResult.hash);
  }
  if (getResult.status !== "SUCCESS") {
    throw new Error(`Tx ${sendResult.hash} ${getResult.status}`);
  }
  return sendResult;
}
