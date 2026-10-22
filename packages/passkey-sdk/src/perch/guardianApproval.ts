/**
 * What a `G…` guardian's wallet may be asked to sign for an approval.
 *
 * A `G…` guardian approves by signing a whole transaction it is the source
 * of, so every authorization entry in it with `SourceAccount` credentials is
 * the guardian's: the call it approves, and every call nested beneath that
 * call, a token `transfer` out of the guardian's account included. The
 * controller writes that tree when the transaction is simulated, and the
 * controller is the one the requesting account adopted, not one the guardian
 * chose. So the envelope is checked, exactly as the wallet will receive it,
 * against the approval the guardian reviewed: one operation calling the
 * controller's `submit_guardian` or `approve_change`, and one authorization,
 * that call for the statement's digest (the controller's
 * `require_auth_for_args((digest,))`) with nothing beneath it.
 */

import { Buffer } from 'buffer';
import { Address, encodeMuxedAccountToAddress, xdr } from '@stellar/stellar-sdk';

/** A guardian's approval as the guardian reviewed it. */
export interface GuardianApproval {
  /** The recovery controller the approval is recorded at. */
  controller: string;
  /** `submit_guardian` for an attempt, `approve_change` for a change. */
  fn: 'submit_guardian' | 'approve_change';
  /** `statementDigest` of the statement approved. */
  digest: Uint8Array;
}

function callName(call: xdr.InvokeContractArgs): string {
  return `${call.functionName().toString()} on ${Address.fromScAddress(call.contractAddress()).toString()}`;
}

function invocationName(inv: xdr.SorobanAuthorizedInvocation): string {
  const fn = inv.function();
  return fn.switch() === xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()
    ? callName(fn.contractFn())
    : 'a contract deployment';
}

function isCall(call: xdr.InvokeContractArgs, approval: GuardianApproval): boolean {
  return (
    Address.fromScAddress(call.contractAddress()).toString() === approval.controller &&
    call.functionName().toString() === approval.fn
  );
}

/** Why the base64 transaction envelope `envelope` must not be signed as
 *  `guardian`'s `approval`, or undefined when it asks for exactly that. */
export function guardianApprovalProblem(
  envelope: string,
  guardian: string,
  approval: GuardianApproval,
): string | undefined {
  const refuse = (what: string) =>
    `Nido stopped this approval before your wallet signed it: the transaction ${what}. ` +
    'Approving authorizes one call at the recovery controller, and nothing else.';

  let env: xdr.TransactionEnvelope;
  try {
    env = xdr.TransactionEnvelope.fromXDR(envelope, 'base64');
  } catch {
    return refuse('could not be read');
  }
  if (env.switch() !== xdr.EnvelopeType.envelopeTypeTx()) return refuse('is not a plain transaction');
  const tx = env.v1().tx();
  if (encodeMuxedAccountToAddress(tx.sourceAccount(), true) !== guardian) {
    return refuse(`is not from your account ${guardian}`);
  }
  const ops = tx.operations();
  if (ops.length !== 1) return refuse(`holds ${ops.length} operations, not one`);
  const op = ops[0]!;
  if (op.sourceAccount()) return refuse('names its own source account for the call');
  if (op.body().switch() !== xdr.OperationType.invokeHostFunction()) {
    return refuse('is not a contract call');
  }
  const invoke = op.body().invokeHostFunctionOp();
  const host = invoke.hostFunction();
  if (
    host.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract() ||
    !isCall(host.invokeContract(), approval)
  ) {
    return refuse(`does not call ${approval.fn} on the recovery controller ${approval.controller}`);
  }

  const auth = invoke.auth();
  if (auth.length !== 1) return refuse(`asks for ${auth.length} authorizations, not one`);
  const entry = auth[0]!;
  if (entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()) {
    return refuse('asks for an authorization other than your signature on it');
  }
  const root = entry.rootInvocation();
  const fn = root.function();
  if (
    fn.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn() ||
    !isCall(fn.contractFn(), approval)
  ) {
    return refuse(`would authorize ${invocationName(root)} instead of the approval`);
  }
  const args = fn.contractFn().args();
  if (
    args.length !== 1 ||
    args[0]!.switch() !== xdr.ScValType.scvBytes() ||
    !Buffer.from(args[0]!.bytes()).equals(Buffer.from(approval.digest))
  ) {
    return refuse('would approve a different statement than the one shown');
  }
  const nested = root.subInvocations();
  if (nested.length > 0) {
    return refuse(
      `would also authorize ${nested.length === 1 ? 'a call' : `${nested.length} calls`} in your name ` +
        `(${invocationName(nested[0]!)})`,
    );
  }
  return undefined;
}
