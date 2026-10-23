/**
 * What happened to an `apply_doc` the relayer refused, from the account itself.
 *
 * A refusal is the relayer's word, and it already holds the signed
 * authorization, so for a payment the outcome stays uncertain. A policy
 * document is different: the account says which document it has applied, and
 * the apply names the revision it was built from, so a retry can never apply
 * twice (a second apply over a moved revision is refused on chain). If the
 * account does not hold the requested document, the request was not applied
 * and the user may try again; if it does, it landed despite the refusal.
 */
import { docHash, parsePolicyDocJson } from '@nidohq/passkey-sdk';
import { fetchDocSurface, toHex } from '../policy/docPolicyFetch.js';

export type RefusedApplyOutcome = 'applied' | 'not-applied' | 'unknown';

/** The outcome from the account's applied document hash (`null` = none
 *  applied, `undefined` = could not be read) and the requested one. */
export function refusedApplyOutcome(
  appliedHashHex: string | null | undefined,
  requestedHashHex: string,
): RefusedApplyOutcome {
  if (appliedHashHex === undefined) return 'unknown';
  return appliedHashHex?.toLowerCase() === requestedHashHex.toLowerCase() ? 'applied' : 'not-applied';
}

/** Read `account`'s applied document hash and compare it with `docJson`'s. */
export async function checkRefusedApply(account: string, docJson: string): Promise<RefusedApplyOutcome> {
  try {
    const surface = await fetchDocSurface(account);
    if (!surface.supported) return 'unknown';
    const applied = surface.appliedDocHash === null ? null : toHex(surface.appliedDocHash);
    return refusedApplyOutcome(applied, docHash(parsePolicyDocJson(docJson)));
  } catch {
    return 'unknown';
  }
}
