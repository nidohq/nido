// What a dApp grant (an apply-policy-doc request from the delegate pages)
// actually grants. apply_doc replaces the whole document, which also carries
// the account's own admin rule, so the grant card must describe the rules the
// request adds or changes — never simply the document's first rule.

import type { PolicyDoc, Rule, SignerDecl } from '@nidohq/passkey-sdk';
import { diffPolicyDocs } from './docDiff.js';
import { MAX_DOC_GRANTS } from './docRequest.js';

/** One rule the request grants, with the signer declarations it names. */
export interface ReviewedGrant {
  rule: Rule;
  signers: SignerDecl[];
}

export type GrantReview =
  | { ok: true; grants: ReviewedGrant[] }
  | { ok: false; reason: string };

/**
 * The contract-scoped rules `next` adds or changes relative to the applied
 * `prev` (null on a first apply), in document order, each with the signer
 * declarations it names. A delegate-doc request grants one key one or more
 * rules (at most MAX_DOC_GRANTS) with one expiry, so anything else is
 * refused: removing a rule, changing an account-scoped rule (on a first
 * apply the account-scoped rule is the admin baseline being written for the
 * first time, shown in the diff), granting no rule, more rules than a
 * request carries, rules for different keys or with different expiries, or
 * changing nothing.
 */
export function reviewGrant(prev: PolicyDoc | null, next: PolicyDoc): GrantReview {
  const diff = diffPolicyDocs(prev, next);
  if (diff.identical) {
    return { ok: false, reason: 'This access is already in place; there is nothing new to approve.' };
  }
  if (diff.rulesRemoved.length > 0) {
    return {
      ok: false,
      reason: `This request would remove the rule "${diff.rulesRemoved[0]!.name}". An app grant only adds access.`,
    };
  }
  const changed = [...diff.rulesAdded, ...diff.rulesModified.map((m) => m.after)];
  const core = changed.find((r) => r.scope.type !== 'contract');
  if (core && !diff.firstApply) {
    return {
      ok: false,
      reason: `This request would change your account's own rule "${core.name}". An app grant can't do that.`,
    };
  }
  const changedNames = new Set(changed.map((r) => r.name));
  const rules = next.rules.filter((r) => r.scope.type === 'contract' && changedNames.has(r.name));
  if (rules.length === 0) {
    return { ok: false, reason: 'This request grants no app access.' };
  }
  if (rules.length > MAX_DOC_GRANTS) {
    return {
      ok: false,
      reason: `This request would grant ${rules.length} rules at once. An app request grants at most ${MAX_DOC_GRANTS}.`,
    };
  }
  const grants = rules.map((rule) => {
    const ids = rule.principals.type === 'self-authenticating' ? [] : rule.principals.signers;
    return { rule, signers: ids.flatMap((id) => next.signers.filter((s) => s.id === id)) };
  });
  const keyOf = (g: ReviewedGrant) =>
    JSON.stringify(g.signers.map((s) => ('address' in s ? s.address : `${s.verifier}:${s.key}`)).sort());
  if (grants.some((g) => keyOf(g) !== keyOf(grants[0]!))) {
    return { ok: false, reason: 'These rules are for different keys. An app request grants access to one key.' };
  }
  if (grants.some((g) => g.rule['not-after-ledger'] !== grants[0]!.rule['not-after-ledger'])) {
    return { ok: false, reason: 'These rules expire at different times. An app request has one expiry.' };
  }
  return { ok: true, grants };
}
