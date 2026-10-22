// What a dApp grant (an apply-policy-doc request from the delegate pages)
// actually grants. apply_doc replaces the whole document, which also carries
// the account's own admin rule, so the grant card must describe the rule the
// request adds or changes — never simply the document's first rule.

import type { PolicyDoc, Rule, SignerDecl } from '@nidohq/passkey-sdk';
import { diffPolicyDocs } from './docDiff.js';

export type GrantReview =
  | { ok: true; rule: Rule; signers: SignerDecl[] }
  | { ok: false; reason: string };

/**
 * The single contract-scoped rule `next` adds or changes relative to the
 * applied `prev` (null on a first apply), with the signer declarations it
 * names. Refused when the request is not exactly one such grant: when it
 * removes a rule, changes an account-scoped rule (on a first apply the
 * account-scoped rule is the admin baseline being written for the first
 * time, shown in the diff), grants several rules, or changes nothing.
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
  const grants = changed.filter((r) => r.scope.type === 'contract');
  if (grants.length !== 1) {
    return {
      ok: false,
      reason: `This request would grant ${grants.length} rules at once. An app grant is exactly one.`,
    };
  }
  const rule = grants[0]!;
  const ids = rule.principals.type === 'self-authenticating' ? [] : rule.principals.signers;
  const signers = ids.flatMap((id) => next.signers.filter((s) => s.id === id));
  return { ok: true, rule, signers };
}
