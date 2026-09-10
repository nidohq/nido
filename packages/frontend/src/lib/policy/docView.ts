// Pure display model for a perch policy DOCUMENT (tiers a/b of the SDK's
// three-tier `readPolicy`), sibling of policyView.ts (which models raw chain
// rules — tier c).
//
// The point of the doc view is losslessness: the document carries the names
// its author wrote — signer ids, rule names, function lists — so the
// inspector can show *those* instead of reverse-engineered chain state. Keep
// everything here pure (no RPC, no DOM) so it unit-tests like policyView.

import type { PolicyDoc, Rule, SignerDecl } from '@nidohq/passkey-sdk';
import { truncate } from './policyView.js';

/** One declared signer, displayed with the doc's own id as the label. */
export interface DocSignerView {
  id: string;
  kind: 'passkey' | 'delegated';
  /** Short kind label, e.g. "Passkey" / "Delegated key". */
  kindLabel: string;
  /** Truncated identifier (address or hex key). */
  detail: string;
  /** Full identifier for copy/verify. */
  full: string;
}

export function describeDocSigner(decl: SignerDecl): DocSignerView {
  if ('address' in decl) {
    return {
      id: decl.id,
      kind: 'delegated',
      kindLabel: 'Delegated key',
      detail: truncate(decl.address),
      full: decl.address,
    };
  }
  return {
    id: decl.id,
    kind: 'passkey',
    kindLabel: 'Passkey',
    detail: truncate(decl.key, 8, 8),
    full: decl.key,
  };
}

export interface DocRuleView {
  name: string;
  /** "One contract" / "This account" heading. */
  scopeLabel: string;
  /** Target contract address, or null for self-admin. */
  contract: string | null;
  /** The doc's own signer ids for this rule, in doc order. */
  signerIds: string[];
  /** "All must sign" / "Any m of n". */
  quorumLabel: string;
  /** Named functions the rule allows, or null for "any function". */
  functions: string[] | null;
  /** Exclusive not-after ledger from the doc, or null for no expiry. */
  notAfterLedger: number | null;
  /** Cumulative cap, if the rule carries one. */
  cap: { limit: string; periodLedgers: number } | null;
  /** True when the rule constrains args (rendered as a badge only — arg
   *  predicates have no compact prose form yet). */
  hasArgConstraints: boolean;
  /** Plain-language sentence of what this rule permits. */
  permission: string;
}

export function describeDocRule(rule: Rule): DocRuleView {
  const contract = rule.scope.type === 'contract' ? rule.scope.address : null;
  const scopeLabel = contract === null ? 'This account' : 'One contract';
  const signerIds = rule.principals.type === 'self-authenticating' ? [] : rule.principals.signers;
  const quorumLabel =
    rule.principals.type === 'threshold'
      ? `Any ${rule.principals.m} of ${signerIds.length}`
      : signerIds.length > 1
        ? 'All must sign'
        : 'One key';
  const functions = rule.functions !== undefined ? [...rule.functions] : null;
  const notAfterLedger = rule['not-after-ledger'] ?? null;
  const cap =
    rule.cap !== undefined
      ? { limit: rule.cap.limit, periodLedgers: rule.cap['period-ledgers'] }
      : null;

  return {
    name: rule.name,
    scopeLabel,
    contract,
    signerIds,
    quorumLabel,
    functions,
    notAfterLedger,
    cap,
    hasArgConstraints: rule.args !== undefined,
    permission: docPermissionSentence({ rule, contract, signerIds, functions }),
  };
}

function signerPhrase(rule: Rule, signerIds: string[]): string {
  if (signerIds.length === 0) return 'No signer';
  if (signerIds.length === 1) return `"${signerIds[0]}"`;
  const names = signerIds.map((s) => `"${s}"`).join(', ');
  if (rule.principals.type === 'threshold') {
    return `any ${rule.principals.m} of ${names}`;
  }
  return `${names} together`;
}

function docPermissionSentence(args: {
  rule: Rule;
  contract: string | null;
  signerIds: string[];
  functions: string[] | null;
}): string {
  const who = signerPhrase(args.rule, args.signerIds);
  const what =
    args.functions === null
      ? 'call any function'
      : args.functions.length === 1
        ? `call ${args.functions[0]}`
        : `call ${args.functions.join(', ')}`;
  const where = args.contract === null ? 'on this account' : `on ${truncate(args.contract)}`;
  return `${who} can ${what} ${where}.`;
}

export interface DocViewModel {
  /** Lowercase-hex canonical doc hash (== the stored on-chain hash). */
  docHash: string;
  /** Truncated hash for the badge. */
  docHashShort: string;
  signers: DocSignerView[];
  rules: DocRuleView[];
}

/** Build the display model for a hash-verified document (tier a — under
 *  doc-only there is no drift tier: the live rules ARE the doc's lowering). */
export function summarizeDoc(doc: PolicyDoc, docHashHex: string): DocViewModel {
  return {
    docHash: docHashHex,
    docHashShort: truncate(docHashHex, 8, 8),
    signers: doc.signers.map(describeDocSigner),
    rules: doc.rules.map(describeDocRule),
  };
}
