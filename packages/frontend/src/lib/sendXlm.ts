import { Asset, Networks, StrKey, xdr } from "@stellar/stellar-sdk";
import { signAndSubmit } from "./primaryPasskeySigner.js";
import { buildSendOperation } from "./transfer/buildSend.js";

/** Native-XLM Stellar Asset Contract id on testnet (same derivation as balance.ts). */
const XLM_SAC_ID = Asset.native().contractId(Networks.TESTNET);

/** True if `addr` is a valid Soroban contract (C…) or Stellar account (G…) address. */
export function validateRecipient(addr: string): boolean {
  return StrKey.isValidContract(addr) || StrKey.isValidEd25519PublicKey(addr);
}

/**
 * Build the unsigned operation for an outgoing native-XLM transfer — the
 * XLM-pinned special case of {@link buildSendOperation}.
 */
export function buildSendXlmOperation(args: {
  smartAccount: string;
  destination: string;
  stroops: bigint;
}): xdr.Operation {
  return buildSendOperation({
    smartAccount: args.smartAccount,
    tokenContractId: XLM_SAC_ID,
    destination: args.destination,
    amount: args.stroops,
  });
}

/**
 * Send native XLM from the user's smart account to `destination`, signed with
 * the primary passkey. Triggers the WebAuthn prompt inside `signAndSubmit` and
 * resolves once the transaction is confirmed on-chain (or throws).
 */
export async function sendXlm(args: {
  smartAccount: string;
  destination: string;
  stroops: bigint;
}): Promise<void> {
  const operation = buildSendXlmOperation(args);
  await signAndSubmit({ account: args.smartAccount, operation });
}
