import { Address, Operation, nativeToScVal, xdr } from "@stellar/stellar-sdk";

/**
 * Build the unsigned operation for an outgoing transfer of ANY SAC- or
 * SEP-41-backed token.
 *
 * The smart account invokes its own `execute(target, target_fn, target_args)`
 * entrypoint to call the token's `transfer(from, to, amount)`. The
 * `require_auth()` inside `execute` is the single auth entry the passkey signs
 * — the inner transfer's `require_auth(from = account)` is satisfied by the
 * call stack — so this op slots straight into `signAndSubmit`.
 *
 * `buildSendXlmOperation` (in sendXlm.ts) is the XLM-pinned special case of
 * this, passing the native SAC as the token.
 */
export function buildSendOperation(args: {
  smartAccount: string;
  tokenContractId: string;
  destination: string;
  amount: bigint;
}): xdr.Operation {
  const targetArgs = xdr.ScVal.scvVec([
    Address.fromString(args.smartAccount).toScVal(), // from
    Address.fromString(args.destination).toScVal(), // to
    nativeToScVal(args.amount, { type: "i128" }), // amount
  ]);

  return Operation.invokeContractFunction({
    contract: args.smartAccount,
    function: "execute",
    args: [
      Address.fromString(args.tokenContractId).toScVal(), // target = the token
      nativeToScVal("transfer", { type: "symbol" }), // target_fn
      targetArgs, // target_args: Vec<Val>
    ],
  });
}
