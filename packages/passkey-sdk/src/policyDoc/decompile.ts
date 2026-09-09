/**
 * Decompiling chain rules → a best-effort PolicyDoc view.
 *
 * The inverse of `lowerDoc`, for the policy inspector: each OZ context rule
 * either maps back to a perch doc rule (scope, signers, functions, args,
 * expiry, cap) or falls back to a `raw` entry with a reason. A raw entry
 * still carries the full `ChainRule` so the UI can always render it — a rule
 * that cannot be displayed cannot be revoked.
 *
 * Interpreter-backed rules decode only the compiler's canonical program shape
 * (`[MinSigners(m), FnIn?, <arg preds…>, All(leaves)]`). Hand-built programs
 * using other ops (Any/Not/ledger guards/…) are valid on-chain but have no
 * doc equivalent, so they fall back to raw. Each decoded program also yields
 * the doc_hash the installation committed to — the identity of the ORIGINAL
 * document, which a reviewer can compare against a doc they hold.
 */

import { docHash, parsePolicyDoc } from '@stellar-registry/perch';
import type { ArgConstraint, Rule, SignerDecl } from '@stellar-registry/perch';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Op, RpnProgram } from '@nidohq/perch-interpreter';
import type { ChainRule, ChainSigner } from '../policyBlocks/types.js';
import { PROGRAM_VERSION } from './lower.js';
import type { DecompileContext, DecompiledRule, DecompileResult } from './types.js';

/** Decompile chain rules into a best-effort document view. Pure — the caller
 *  supplies fetched context (programs, spending limits) via `ctx`. */
export function decompileRules(chainRules: ChainRule[], ctx: DecompileContext): DecompileResult {
  const signerIds = new SignerIdAllocator();
  const rules: DecompiledRule[] = [];
  const committedDocHashes: string[] = [];

  for (const chainRule of chainRules) {
    const mapped = mapRule(chainRule, ctx);
    if (typeof mapped === 'string') {
      rules.push({ kind: 'raw', ruleId: chainRule.ruleId, chainRule, reason: mapped });
      continue;
    }
    // Allocate signer ids only after the rule is definitely mappable, so raw
    // rules never leak declarations into the assembled doc.
    const ids = chainRule.signers.map((s) => signerIds.idFor(s));
    const rule: Rule = {
      name: chainRule.name,
      scope:
        mapped.contract === ctx.account
          ? { type: 'self-admin' }
          : { type: 'contract', address: mapped.contract },
      principals: { type: 'all', signers: ids },
      ...(mapped.functions !== undefined ? { functions: mapped.functions } : {}),
      ...(mapped.args !== undefined ? { args: mapped.args } : {}),
      ...(chainRule.validUntil !== null ? { 'not-after-ledger': chainRule.validUntil + 1 } : {}),
      ...(mapped.cap !== undefined ? { cap: mapped.cap } : {}),
    };
    if (mapped.committedDocHash !== undefined && !committedDocHashes.includes(mapped.committedDocHash)) {
      committedDocHashes.push(mapped.committedDocHash);
    }
    rules.push({
      kind: 'doc',
      ruleId: chainRule.ruleId,
      rule,
      signers: ids.map((id) => signerIds.decl(id)),
      ...(mapped.committedDocHash !== undefined
        ? { committedDocHash: mapped.committedDocHash }
        : {}),
    });
  }

  const docRules = rules.filter((r) => r.kind === 'doc');
  let doc = null;
  let hash = null;
  if (docRules.length > 0) {
    try {
      doc = parsePolicyDoc({
        version: 1,
        signers: signerIds.all(),
        rules: docRules.map((r) => r.rule),
      });
      hash = docHash(doc);
    } catch {
      doc = null; // a chain rule produced an un-parseable view; keep per-rule entries
    }
  }
  return { rules, doc, docHash: hash, committedDocHashes };
}

/** What one chain rule maps to, before signer ids exist; a string is a raw-
 *  fallback reason. */
interface MappedRule {
  contract: string;
  functions?: string[];
  args?: ArgConstraint[];
  cap?: Rule['cap'];
  committedDocHash?: string;
}

function mapRule(chainRule: ChainRule, ctx: DecompileContext): MappedRule | string {
  if (chainRule.contextType.kind !== 'call-contract') {
    return `a ${chainRule.contextType.kind} rule has no doc equivalent (perch docs describe contract-call and self-admin scopes)`;
  }
  if (chainRule.signers.length === 0) {
    return 'zero-signer rule (policy-only rules such as ZK recovery have no doc equivalent)';
  }

  const mapped: MappedRule = { contract: chainRule.contextType.contract };

  for (const policy of chainRule.policies) {
    if (ctx.interpreterAddress !== undefined && policy === ctx.interpreterAddress) {
      const entry = ctx.programs?.[chainRule.ruleId];
      if (!entry) {
        return 'interpreter program not fetched (pass it via ctx.programs to decode)';
      }
      const decoded = decodeCanonicalProgram(entry.program, chainRule.signers.length);
      if (typeof decoded === 'string') return decoded;
      if (decoded.functions !== undefined) mapped.functions = decoded.functions;
      if (decoded.args !== undefined) mapped.args = decoded.args;
      mapped.committedDocHash =
        typeof entry.docHash === 'string' ? entry.docHash.toLowerCase() : bytesToHex(entry.docHash);
    } else if (ctx.spendingLimitAddress !== undefined && policy === ctx.spendingLimitAddress) {
      const cap = ctx.spendingLimits?.[chainRule.ruleId];
      if (!cap) {
        return 'spending-limit params not fetched (pass them via ctx.spendingLimits to decode)';
      }
      mapped.cap = { limit: cap.limitStroops.toString(), 'period-ledgers': cap.periodLedgers };
    } else if (ctx.multisigPolicyAddress !== undefined && policy === ctx.multisigPolicyAddress) {
      return 'M-of-N threshold rules are not expressible in doc v1 (the TS schema has no threshold principals yet)';
    } else {
      return `unrecognized policy contract ${policy}`;
    }
  }
  return mapped;
}

interface DecodedProgram {
  functions?: string[];
  args?: ArgConstraint[];
}

/** Decode the compiler's canonical program shape, or explain why not. */
function decodeCanonicalProgram(
  program: RpnProgram,
  signerCount: number,
): DecodedProgram | string {
  if (program.version !== PROGRAM_VERSION) {
    return `interpreter program version ${program.version} unknown (expected ${PROGRAM_VERSION})`;
  }
  const ops = program.ops;
  if (ops.length < 2) return 'non-canonical interpreter program (too short)';

  const head = ops[0];
  if (head.tag !== 'MinSigners') {
    return `non-canonical interpreter program (starts with ${head.tag}, expected MinSigners)`;
  }
  const last = ops[ops.length - 1];
  if (last.tag !== 'All' || last.values[0] !== ops.length - 1) {
    return 'non-canonical interpreter program (does not end with All over every leaf)';
  }
  if (head.values[0] !== signerCount) {
    return `MinSigners(${head.values[0]}) over ${signerCount} signers is an M-of-N quorum, not expressible in doc v1 (the TS schema has no threshold principals yet)`;
  }

  const decoded: DecodedProgram = {};
  const middle = ops.slice(1, -1);
  for (const [i, op] of middle.entries()) {
    if (op.tag === 'FnIn') {
      if (i !== 0) return 'non-canonical interpreter program (FnIn not first after MinSigners)';
      decoded.functions = [...op.values[0]];
      continue;
    }
    const arg = decodeArgPred(op);
    if (arg === null) {
      return `interpreter program op ${op.tag} has no doc equivalent`;
    }
    (decoded.args ??= []).push(arg);
  }
  return decoded;
}

function decodeArgPred(op: Op): ArgConstraint | null {
  switch (op.tag) {
    case 'ArgAddrIsSelf':
      return { index: op.values[0], pred: { type: 'is-self' } };
    case 'ArgAddrEq':
      return { index: op.values[0], pred: { type: 'address-eq', address: op.values[1] } };
    case 'ArgU32Eq':
      return { index: op.values[0], pred: { type: 'u32-eq', value: op.values[1] } };
    case 'ArgStrIn':
      return { index: op.values[0], pred: { type: 'string-in', values: [...op.values[1]] } };
    case 'ArgStrPrefix':
      return { index: op.values[0], pred: { type: 'string-prefix', prefix: op.values[1] } };
    default:
      return null;
  }
}

/** Dedupes chain signers into doc declarations with synthesized, stable ids
 *  (`delegated-1`, `key-1`, … in first-seen order). */
class SignerIdAllocator {
  private readonly byIdentity = new Map<string, string>();
  private readonly decls = new Map<string, SignerDecl>();
  private delegatedCount = 0;
  private externalCount = 0;

  idFor(signer: ChainSigner): string {
    const identity =
      signer.kind === 'delegated'
        ? `d:${signer.address}`
        : `e:${signer.verifier}:${bytesToHex(signer.publicKey)}`;
    const existing = this.byIdentity.get(identity);
    if (existing !== undefined) return existing;
    let id: string;
    let decl: SignerDecl;
    if (signer.kind === 'delegated') {
      id = `delegated-${++this.delegatedCount}`;
      decl = { id, address: signer.address };
    } else {
      id = `key-${++this.externalCount}`;
      decl = { id, verifier: signer.verifier, key: bytesToHex(signer.publicKey) };
    }
    this.byIdentity.set(identity, id);
    this.decls.set(id, decl);
    return id;
  }

  decl(id: string): SignerDecl {
    const d = this.decls.get(id);
    if (!d) throw new Error(`policyDoc: no declaration for signer id "${id}"`);
    return d;
  }

  all(): SignerDecl[] {
    return [...this.decls.values()];
  }
}
