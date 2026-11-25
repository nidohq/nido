import { StrKey } from "@stellar/stellar-sdk";
import { accountUrl } from "@nidohq/passkey-sdk";

/**
 * Where the "Already have a Nido?" form in the My Nido menu sends someone:
 * the account page on the account's own address, where a synced passkey can
 * sign in. Returns null unless `input` is a valid contract (C…) address.
 *
 * The input becomes part of a hostname, so it must be a full strkey check
 * (`StrKey.isValidContract`), not `isContractId`'s length-and-prefix check:
 * a 56-character string starting with "C" could otherwise carry a different
 * host (`C….evil.com/`).
 */
export function existingNidoTarget(host: string, input: string): string | null {
  const address = input.trim().toUpperCase();
  if (!StrKey.isValidContract(address)) return null;
  return accountUrl(host, address, "/account/");
}
