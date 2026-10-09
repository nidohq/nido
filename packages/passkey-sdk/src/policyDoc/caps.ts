/**
 * Perch's document limits in words a wallet can show. The limits themselves
 * are never hard-coded here: they are what the account's doc compiler
 * reports (`limits()`, perch-js `FlatDocLimits`), read from the chain with
 * the account's snapshot (`snapshot.limits`, or `accountSnapshotReader(...)
 * .limits()`). A document over any of them fails `apply_doc` with
 * `DocTooLarge`; perch-js's `checkLimits` refuses it locally first, and
 * `docCapProblem` explains why.
 */

import { checkLimits, OverLimits, type FlatDocLimits } from '@stellar-registry/perch';
import type { PolicyDoc } from '@stellar-registry/perch';

export type { FlatDocLimits };

const enc = new TextEncoder();

/** `err`, a perch-js `OverLimits` for `doc`, as a sentence a wallet can show. */
export function overLimitsMessage(err: OverLimits, doc?: PolicyDoc): string {
  switch (err.limit) {
    case 'max_signers':
      return `This document declares ${err.value} keys; an account holds at most ${err.max} (passkeys, devices, and app keys together). Remove one first.`;
    case 'max_rules':
      return `This document has ${err.value} rules; an account holds at most ${err.max}. Remove a rule or an app grant first.`;
    case 'max_rule_name_bytes': {
      const long = doc?.rules.find((r) => enc.encode(r.name).length === err.value);
      return long
        ? `The rule name "${long.name}" is ${err.value} bytes; Perch allows at most ${err.max}.`
        : `A rule name is ${err.value} bytes; Perch allows at most ${err.max}.`;
    }
    case 'max_canonical_bytes':
      return `This document is ${err.value} bytes; an account's document holds at most ${err.max}.`;
  }
}

/** Why the account's compiler would refuse `doc` under `limits` (perch-js
 *  `checkLimits`), or undefined when it fits. */
export function docCapProblem(doc: PolicyDoc, limits: FlatDocLimits): string | undefined {
  try {
    checkLimits(doc, limits);
    return undefined;
  } catch (err) {
    if (err instanceof OverLimits) return overLimitsMessage(err, doc);
    throw err;
  }
}
