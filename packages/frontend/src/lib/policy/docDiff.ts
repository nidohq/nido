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
//
// Completeness: two documents are identical only when their canonical JSON is
// (so their doc_hash is), and every difference is shown. Fields the
// field-level lines do not describe (a cap's `token`, a self-authenticating
// rule's `policy`, `install-param-hex` and `ack`, the document's `recovery`
// and `network`, anything newer) are named in an "other changes" line, on
// the rule, or in `otherChanges` for signers and the document itself.

import { canonicalJson, type PolicyDoc, type Rule, type SignerDecl } from '@nidohq/passkey-sdk';
import { canTransfer, capText, capToken, ruleRecipient } from './reviewText.js';
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
  /** Differences outside the rules the lines above describe: signer and
   *  document fields (e.g. `recovery`, `network`), or an order change. */
  otherChanges: string[];
  /** True when the documents' canonical JSON is the same (no-op apply). */
  identical: boolean;
}

type Json = Record<string, unknown>;

/** The fields, one level into nested objects, as dotted paths, whose
 *  canonical values differ between `a` and `b`. */
function differingFields(a: Json, b: Json): string[] {
  const out: string[] = [];
  const nested = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const [va, vb] = [a[key], b[key]];
    // Absent and present differ; canonical JSON has no null to stand for absent.
    const form = (v: unknown) => (v === undefined ? undefined : canonicalJson(v));
    if (form(va) === form(vb)) continue;
    if (nested(va) && nested(vb)) out.push(...differingFields(va, vb).map((k) => `${key}.${k}`));
    else out.push(key);
  }
  return out;
}

/** `value` as plain JSON without `drop` (dotted paths, one level deep). */
function withoutFields(value: object, drop: readonly string[]): Json {
  const o = JSON.parse(JSON.stringify(value)) as Json;
  for (const path of drop) {
    const [head, tail] = path.split('.') as [string, string | undefined];
    if (tail === undefined) delete o[head];
    else if (typeof o[head] === 'object' && o[head] !== null) delete (o[head] as Json)[tail];
  }
  return o;
}

/** The rule fields `diffRuleFields` describes. (A cap's `token` is not one:
 *  the cap line reads the effective token, not whether it is spelled out.) */
const RENDERED_RULE_FIELDS = [
  'name',
  'scope',
  'principals.type',
  'principals.signers',
  'principals.m',
  'functions',
  'not-after-ledger',
  'cap.limit',
  'cap.period-ledgers',
  'args',
];

/** The signer fields `signerKey` compares. */
const RENDERED_SIGNER_FIELDS = ['id', 'address', 'verifier', 'key'];

function otherChangesLine(fields: string[]): string {
  return `other changes: ${fields.join(', ')}`;
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
    const show = (f: readonly string[] | undefined) =>
      f === undefined ? 'any function' : f.map((fn) => `${fn}()`).join(', ');
    changes.push(`functions: ${show(before.functions)} → ${show(after.functions)}`);
  }

  const expB = before['not-after-ledger'];
  const expA = after['not-after-ledger'];
  if (expB !== expA) {
    const show = (v: number | undefined) => (v === undefined ? 'no expiry' : `ledger ${v}`);
    changes.push(`expiry: ${show(expB)} → ${show(expA)}`);
  }

  const capOf = (r: Rule) =>
    r.cap === undefined
      ? 'no cap'
      : capText(r.cap.limit, r.cap['period-ledgers'], capToken(r)).replace(/^Up to/, 'up to');
  if (capOf(before) !== capOf(after)) {
    changes.push(`cap: ${capOf(before)} → ${capOf(after)}`);
  }

  const argsOf = (r: Rule) => JSON.stringify(r.args ?? null);
  if (argsOf(before) !== argsOf(after)) {
    // A transfer recipient, in words, on a rule that may call transfer; any
    // other argument condition (e.g. approve's spender) generically.
    const payee = (r: Rule) => {
      if (!canTransfer(r.functions)) return null;
      const to = ruleRecipient(r);
      return to !== null ? `only ${truncate(to)}` : r.args === undefined ? 'any address' : null;
    };
    const [pb2, pa2] = [payee(before), payee(after)];
    const otherArgs = (r: Rule) => JSON.stringify((r.args ?? []).filter((a) => a.index !== 1));
    if (pb2 !== null && pa2 !== null && otherArgs(before) === otherArgs(after)) {
      changes.push(`pays: ${pb2} → ${pa2}`);
    } else {
      changes.push('argument conditions changed');
    }
  }

  const unrendered = differingFields(
    withoutFields(before, RENDERED_RULE_FIELDS),
    withoutFields(after, RENDERED_RULE_FIELDS),
  );
  if (unrendered.length > 0) changes.push(otherChangesLine(unrendered));

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
      otherChanges: [],
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

  const identical = canonicalJson(prev) === canonicalJson(next);
  const otherChanges: string[] = [];
  // Signer fields `signerKey` does not compare, on a declaration that kept
  // its id and key.
  for (const s of next.signers) {
    const old = prevById.get(s.id);
    if (old === undefined || signerKey(old) !== signerKey(s)) continue;
    const fields = differingFields(
      withoutFields(old, RENDERED_SIGNER_FIELDS),
      withoutFields(s, RENDERED_SIGNER_FIELDS),
    );
    if (fields.length > 0) otherChanges.push(`signer "${s.id}": ${otherChangesLine(fields)}`);
  }
  // Document fields other than its rules and signers.
  const docFields = differingFields(withoutFields(prev, ['rules', 'signers']), withoutFields(next, ['rules', 'signers']));
  if (docFields.length > 0) otherChanges.push(`document: ${otherChangesLine(docFields)}`);
  // Whatever is left (rules or signers in another order): never "no changes"
  // for documents that differ.
  const shown =
    signers.length + rulesAdded.length + rulesRemoved.length + rulesModified.length + otherChanges.length;
  if (!identical && shown === 0) otherChanges.push('other changes: the order of rules or signers');

  return {
    firstApply: false,
    signers,
    rulesAdded,
    rulesRemoved,
    rulesModified,
    unchangedRuleNames,
    otherChanges,
    identical,
  };
}
