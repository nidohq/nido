/**
 * The document caps Perch's doc compiler enforces on every `compile_doc` and
 * `derive_target` (`perch_doc_compiler::MAX_DOC_*`, spec §7.5): a document
 * over any of them fails `apply_doc` with `DocTooLarge`. They bound the
 * worst-case recovery completion, so they are much tighter than OZ's own
 * limits. `caps.test.ts` reads them from Perch's source, so a Perch change
 * fails the test until these follow.
 */

import { canonicalJson } from '@stellar-registry/perch';
import type { PolicyDoc } from '@stellar-registry/perch';

/** Declared signers (every passkey, device, and app-grant key). */
export const MAX_DOC_SIGNERS = 8;
/** Rules in the document (the recovery member's rule is not one of them). */
export const MAX_DOC_RULES = 11;
/** Bytes of the document's canonical JSON. */
export const MAX_DOC_CANONICAL_BYTES = 8192;
/** Bytes of a rule name (OZ's context-rule name limit). */
export const MAX_RULE_NAME_BYTES = 20;

const enc = new TextEncoder();

/** Why Perch would refuse `doc` as too large, in words a wallet can show, or
 *  undefined when it fits every cap. */
export function docCapProblem(doc: PolicyDoc): string | undefined {
  if (doc.signers.length > MAX_DOC_SIGNERS) {
    return `This document declares ${doc.signers.length} keys; an account holds at most ${MAX_DOC_SIGNERS} (passkeys, devices, and app keys together). Remove one first.`;
  }
  if (doc.rules.length > MAX_DOC_RULES) {
    return `This document has ${doc.rules.length} rules; an account holds at most ${MAX_DOC_RULES}. Remove a rule or an app grant first.`;
  }
  const long = doc.rules.find((r) => enc.encode(r.name).length > MAX_RULE_NAME_BYTES);
  if (long) return `The rule name "${long.name}" is longer than ${MAX_RULE_NAME_BYTES} bytes.`;
  const size = enc.encode(canonicalJson(doc)).length;
  if (size > MAX_DOC_CANONICAL_BYTES) {
    return `This document is ${size} bytes; an account's document holds at most ${MAX_DOC_CANONICAL_BYTES}.`;
  }
  return undefined;
}
