/**
 * Verifier names (Perch M7, `perch/verifiers`). An external signer names its
 * verifier by `verifier-name` (`<name>@<version>`) beside its `verifier`; the
 * doc compiler resolves the name in Perch's managed `perch/verifiers`
 * registry and refuses the document unless it is the signer's verifier.
 * One by contract id alone is unverified: refused in an admin document (a
 * self-admin rule or a recovery member, so every `apply_doc` and every
 * recovery target), flagged in a scoped document.
 */
import type { PolicyDoc } from '@stellar-registry/perch';

/** `doc` with each external signer whose verifier `names` maps, and that
 *  has no `verifier-name` yet, naming it. `doc` itself when nothing
 *  changes. */
export function withVerifierNames(doc: PolicyDoc, names: Readonly<Record<string, string>>): PolicyDoc {
  let changed = false;
  const signers = doc.signers.map((s) => {
    if (!('verifier' in s) || s['verifier-name'] !== undefined) return s;
    const name = names[s.verifier];
    if (name === undefined) return s;
    changed = true;
    return { ...s, 'verifier-name': name };
  });
  return changed ? { ...doc, signers } : doc;
}
