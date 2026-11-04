/**
 * runSign — unified lifecycle engine for the /sign/ page.
 *
 * Branches on `req.operation.type`:
 *  - Non-raw-xdr (own actions): buildOperation → signAndSubmit → { hash }
 *  - raw-xdr (dApp): signTransactionXdr → relayerSubmitAndConfirm → { hash }
 *
 * Does NOT call postResultToOpener — that is the route's responsibility.
 */

import { TransactionBuilder } from "@stellar/stellar-sdk";
import type { SignRequest } from "./signRequest";
import { buildOperationChecked } from "./operationBuilders";
import { signAndSubmit } from "../primaryPasskeySigner";
import { relayerSubmitAndConfirm } from "./submit";
import { signTransactionXdr } from "../walletSign.js";
import { LOCAL_SUBMITTER, NETWORK_PASSPHRASE } from "../network.js";
import { submitLocally } from "../localSubmitter.js";

export interface RunSignHooks {
  onProgress?: (p: { phase: string; detail?: string }) => void;
  /** For a dApp transaction: the authorization tree the user reviewed
   *  (`previewTransactionAuth`'s `invocationXdr`). Required on that path. */
  reviewedInvocationXdr?: string;
}

export interface RunSignResult {
  hash: string;
}

export async function runSign(req: SignRequest, hooks?: RunSignHooks): Promise<RunSignResult> {
  if (req.operation.type !== "raw-xdr") {
    // Own-action path: build the op then sign+submit via primary passkey.
    const { operation, checks } = await buildOperationChecked(req.operation, req.account);
    const res = await signAndSubmit({
      account: req.account,
      operation,
      checks,
      onProgress: hooks?.onProgress,
    });
    return { hash: res.hash };
  }

  // dApp raw-xdr path (submitMode: "return-to-dapp"): Nido signs and submits
  // via relayer (Model A), then returns the confirmed hash to the caller.
  // The route is responsible for postResultToOpener.
  const networkPassphrase = req.networkPassphrase ?? NETWORK_PASSPHRASE;
  if (!hooks?.reviewedInvocationXdr) {
    throw new Error("This transaction's authorization wasn't reviewed, so it can't be signed.");
  }

  const onStatus = (msg: string) => {
    hooks?.onProgress?.({ phase: "sign", detail: msg });
  };

  const signed = await signTransactionXdr({
    account: req.account,
    txXdr: req.operation.xdr,
    networkPassphrase,
    reviewedInvocationXdr: hooks.reviewedInvocationXdr,
    onStatus,
  });

  const tx = TransactionBuilder.fromXDR(signed, networkPassphrase);
  if (LOCAL_SUBMITTER) {
    hooks?.onProgress?.({ phase: "confirm" });
    return { hash: await submitLocally(tx as Parameters<typeof submitLocally>[0]) };
  }

  const onPoll = (info: { status: import("./submit").RelayerStatus | null; attempt: number; maxAttempts: number }) => {
    hooks?.onProgress?.({
      phase: "confirm",
      detail: `poll ${info.attempt}/${info.maxAttempts} status=${String(info.status)}`,
    });
  };

  const { hash } = await relayerSubmitAndConfirm(tx as Parameters<typeof relayerSubmitAndConfirm>[0], { onPoll });
  return { hash };
}
