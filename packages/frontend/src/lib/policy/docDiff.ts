// Pure diff between two perch policy documents (canonical wire forms, as
// returned by `parsePolicyDoc[Json]`): what changes when `next` replaces
// `prev` as an account's applied document.
//
// apply_doc is a whole-document write — every update REPLACES the applied
// document — so before confirming, the user must see exactly what moves:
// rules added / removed / modified (name-level, with field-level detail on
// modified rules) and signer declarations added / removed. Rule identity is
// the rule NAME (unique within a valid doc — lowering enforces it); signer
// identity is the declaration id.

import type { PolicyDoc, Rule, SignerDecl } from '@nidohq/passkey-sdk';
import { truncate } from './policyView.js';

export interface RuleModification {
  name: string;
  before: Rule;
  after: Rule;
  /** Human-readable field-level change lines, one per changed field. */
  changes: string[];
}

export interface SignerChange {
  decl: SignerDecl;
  /** 'added' | 'removed' | 'rekeyed' — rekeyed means the same id now
   *  declares a different key/address (shown once, on the new decl). */
  kind: 'added' | 'removed' | 'rekeyed';
}

export interface DocDiff {
  /** True when there is no currently applied document — everything is new. */
  firstApply: boolean;
  signers: SignerChange[];
  rulesAdded: Rule[];
  rulesRemoved: Rule[];
  rulesModified: RuleModification[];
  /** Rules present in both docs with no changes. */
  unchangedRuleNames: string[];
  /** True when the documents are canonically identical (no-op apply). */
  identical: boolean;
}

function signerKey(s: SignerDecl): string {
  return 'address' in s ? `delegated:${s.address}` : `external:${s.verifier}:${s.key}`;
}

function signerLabel(s: SignerDecl): string {
  return 'address' in s ? truncate(s.address) : truncate(s.key, 8, 8);
}

function sameStringArray(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Field-level change lines for one renamed-to-itself rule pair. */
export function diffRuleFields(before: Rule, after: Rule): string[] {
  const changes: string[] = [];

  const scopeOf = (r: Rule) => (r.scope.type === 'contract' ? r.scope.address : 'this account');
  if (scopeOf(before) !== scopeOf(after)) {
    changes.push(`scope: ${truncate(scopeOf(before))} → ${truncate(scopeOf(after))}`);
  }

  const pb = before.principals;
  const pa = after.principals;
  const sigsOf = (p: Rule['principals']) => (p.type === 'self-authenticating' ? [] : p.signers);
  if (!sameStringArray(sigsOf(pb), sigsOf(pa))) {
    changes.push(`signers: ${sigsOf(pb).join(', ') || '(none)'} → ${sigsOf(pa).join(', ') || '(none)'}`);
  }
  const quorumOf = (p: Rule['principals']) =>
    p.type === 'threshold' ? `${p.m} of ${p.signers.length}` : p.type;
  if (quorumOf(pb) !== quorumOf(pa)) {
    changes.push(`quorum: ${quorumOf(pb)} → ${quorumOf(pa)}`);
  }

  if (!sameStringArray(before.functions, after.functions)) {
    const show = (f: readonly string[] | undefined) => (f === undefined ? 'any function' : f.join(', '));
    changes.push(`functions: ${show(before.functions)} → ${show(after.functions)}`);
  }

  const expB = before['not-after-ledger'];
  const expA = after['not-after-ledger'];
  if (expB !== expA) {
    const show = (v: number | undefined) => (v === undefined ? 'no expiry' : `ledger ${v}`);
    changes.push(`expiry: ${show(expB)} → ${show(expA)}`);
  }

  const capOf = (r: Rule) =>
    r.cap === undefined ? 'no cap' : `${r.cap.limit} stroops per ${r.cap['period-ledgers']} ledgers`;
  if (capOf(before) !== capOf(after)) {
    changes.push(`cap: ${capOf(before)} → ${capOf(after)}`);
  }

  const argsOf = (r: Rule) => JSON.stringify(r.args ?? null);
  if (argsOf(before) !== argsOf(after)) {
    changes.push('argument conditions changed');
  }

  return changes;
}

/** Diff `next` against the currently applied `prev` (null = first apply). */
export function diffPolicyDocs(prev: PolicyDoc | null, next: PolicyDoc): DocDiff {
  if (prev === null) {
    return {
      firstApply: true,
      signers: next.signers.map((decl) => ({ decl, kind: 'added' as const })),
      rulesAdded: [...next.rules],
      rulesRemoved: [],
      rulesModified: [],
      unchangedRuleNames: [],
      identical: false,
    };
  }

  // Signers: by id first (rekey detection), then by full identity.
  const prevById = new Map(prev.signers.map((s) => [s.id, s]));
  const nextById = new Map(next.signers.map((s) => [s.id, s]));
  const signers: SignerChange[] = [];
  for (const s of next.signers) {
    const old = prevById.get(s.id);
    if (old === undefined) signers.push({ decl: s, kind: 'added' });
    else if (signerKey(old) !== signerKey(s)) signers.push({ decl: s, kind: 'rekeyed' });
  }
  for (const s of prev.signers) {
    if (!nextById.has(s.id)) signers.push({ decl: s, kind: 'removed' });
  }

  const prevRules = new Map(prev.rules.map((r) => [r.name, r]));
  const nextRules = new Map(next.rules.map((r) => [r.name, r]));
  const rulesAdded: Rule[] = [];
  const rulesRemoved: Rule[] = [];
  const rulesModified: RuleModification[] = [];
  const unchangedRuleNames: string[] = [];

  for (const r of next.rules) {
    const old = prevRules.get(r.name);
    if (old === undefined) {
      rulesAdded.push(r);
      continue;
    }
    const changes = diffRuleFields(old, r);
    // A rule whose own fields are identical still changes meaning when a
    // signer id it references was rekeyed — surface that as a field line.
    const rekeyed = signers.filter(
      (c) =>
        c.kind === 'rekeyed' &&
        r.principals.type !== 'self-authenticating' &&
        r.principals.signers.includes(c.decl.id),
    );
    for (const c of rekeyed) {
      changes.push(`signer "${c.decl.id}" now declares a different key (${signerLabel(c.decl)})`);
    }
    if (changes.length > 0) rulesModified.push({ name: r.name, before: old, after: r, changes });
    else unchangedRuleNames.push(r.name);
  }
  for (const r of prev.rules) {
    if (!nextRules.has(r.name)) rulesRemoved.push(r);
  }

  return {
    firstApply: false,
    signers,
    rulesAdded,
    rulesRemoved,
    rulesModified,
    unchangedRuleNames,
    identical:
      signers.length === 0 &&
      rulesAdded.length === 0 &&
      rulesRemoved.length === 0 &&
      rulesModified.length === 0,
  };
}
