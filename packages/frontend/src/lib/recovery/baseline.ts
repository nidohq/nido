import type { PolicyDoc } from '@nidohq/passkey-sdk';

/**
 * Strip expiring rules from a recovery baseline document.
 *
 * SECURITY: a
 * Protected account's compromise recovery restores the account to a published
 * baseline "restore point". If that baseline captures a rule carrying a
 * `not-after-ledger` (every Nido dApp session rule does, unless "until revoked"
 * was chosen), then once that session expires — or the owner merely renews it
 * in place, changing the installed rule — the recovery completion reverts with
 * `PastValidUntil` and compromise recovery becomes permanently impossible. A
 * thief holding the owner key can even trigger this deliberately.
 *
 * Until Perch treats an expired baseline rule as a no-op, Nido must not enrol a
 * baseline that contains expiring rules. A restore point should hold only the
 * durable configuration anyway: the admin rule and any permanent (non-expiring)
 * rules. Transient sessions are intentionally dropped — restoring one would
 * re-grant a possibly-stale delegation, and an expired rule authorizes nothing.
 *
 * Returns a new document with every rule that has a `not-after-ledger` removed,
 * and any signer left unreferenced by the surviving rules pruned (so the
 * baseline compiles and carries no orphaned session keys).
 */
export function baselineWithoutExpiringRules(doc: PolicyDoc): PolicyDoc {
  const rules = doc.rules.filter((r) => r['not-after-ledger'] === undefined);
  const referenced = new Set<string>(
    // `self-authenticating` principals carry no signer ids.
    rules.flatMap((r) => ('signers' in r.principals ? r.principals.signers : [])),
  );
  const signers = doc.signers.filter((s) => referenced.has(s.id));
  return { ...doc, rules, signers };
}

/** True when `doc` carries at least one rule with an expiry — i.e. enrolling it
 *  as a baseline would be unsafe without {@link baselineWithoutExpiringRules}. */
export function hasExpiringRules(doc: PolicyDoc): boolean {
  return doc.rules.some((r) => r['not-after-ledger'] !== undefined);
}
