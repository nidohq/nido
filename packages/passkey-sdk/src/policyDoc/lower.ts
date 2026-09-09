/**
 * Lowering: PolicyDoc → OZ context-rule install plan.
 *
 * A faithful TS mirror of perch's Rust compiler (`perch-compile`), with one
 * nido-specific mapping: a rule's cumulative `cap` lowers onto nido's stock
 * spending-limit policy deployment rather than perch's own. The invariants
 * come from perch-compile (INV-1/INV-2):
 *
 * - Only a bare `all` (N-of-N) rule with no functions, no args and no cap
 *   lowers policy-free, riding OZ's native all-signers-must-match. This is
 *   the deliberate anti-brick path (the admin rule).
 * - Everything else attaches the perch interpreter with a program of shape
 *   `[MinSigners(m), FnIn(fns)?, <arg preds…>, All(leaves)]`, so a
 *   constrained rule always fails zero-signature auth.
 * - A capped rule attaches the spending-limit policy AND the interpreter on
 *   the same context rule; OZ enforces every attached policy, so both must
 *   pass. The `MinSigners` floor holds independently of spending-limit's
 *   single-signer floor.
 * - The doc's `not-after-ledger` is exclusive ("dead at or after X"); OZ's
 *   `valid_until` is inclusive — lower to `X - 1`.
 *
 * perch's TS package ships schema + hashing but no semantic `validate()`
 * (tracked upstream on perch#8), so this module performs the semantic checks
 * lowering depends on and fails closed on anything it cannot express.
 */

import { docHash } from '@stellar-registry/perch';
import type { ArgConstraint, PolicyDoc, Rule, SignerDecl } from '@stellar-registry/perch';
import { hexToBytes } from '@noble/hashes/utils.js';
import type { Op, RpnProgram } from '@nidohq/perch-interpreter';
import type { ChainSigner } from '../policyBlocks/types.js';
import type { LoweredCap, LoweredDoc, LoweredRule } from './types.js';

/** Interpreter program-format version this lowering targets (perch-program). */
export const PROGRAM_VERSION = 1;
/** Structural limits mirrored from perch-program's `rpn::validate`. */
const MAX_PROGRAM_LEN = 256;
const MAX_STACK_DEPTH = 128;

const I128_MAX = 2n ** 127n - 1n;

export interface LowerOptions {
  /** The smart account the plan installs onto — a `self-admin` doc rule
   *  lowers to `CallContract(account)`. */
  account: string;
}

class LowerErr extends Error {
  constructor(rule: string, message: string) {
    super(`policyDoc: rule "${rule}": ${message}`);
  }
}

/**
 * Lower a parsed PolicyDoc to a pure install plan (no network access, no
 * addresses). Throws on any rule v1 cannot express — a document is never
 * silently degraded. Turn the plan into transactions with
 * `buildDocInstallTxs`.
 */
export function lowerDoc(doc: PolicyDoc, opts: LowerOptions): LoweredDoc {
  const seenSigners = new Set<string>();
  for (const s of doc.signers) {
    if (seenSigners.has(s.id)) {
      throw new Error(`policyDoc: duplicate signer id "${s.id}"`);
    }
    seenSigners.add(s.id);
  }
  const seenRules = new Set<string>();
  const rules = doc.rules.map((rule) => {
    if (seenRules.has(rule.name)) {
      throw new Error(`policyDoc: duplicate rule name "${rule.name}"`);
    }
    seenRules.add(rule.name);
    return lowerRule(doc, rule, opts.account);
  });
  return {
    docHash: docHash(doc),
    ...(doc.network !== undefined ? { network: doc.network } : {}),
    rules,
    usesInterpreter: rules.some((r) => r.program !== undefined),
    usesSpendingLimit: rules.some((r) => r.cap !== undefined),
  };
}

function lowerRule(doc: PolicyDoc, rule: Rule, account: string): LoweredRule {
  const contract = rule.scope.type === 'contract' ? rule.scope.address : account;

  if (rule.principals.type === 'self-authenticating') {
    throw new LowerErr(
      rule.name,
      'self-authenticating rules need a policy-call op not in program v1',
    );
  }
  const signerIds = rule.principals.signers;
  if (signerIds.length === 0) {
    throw new LowerErr(rule.name, 'principals list must be non-empty');
  }
  const signers = signerIds.map((id) => resolveSigner(doc, rule.name, id));
  const minSigners = signerIds.length; // `all` is N-of-N (the TS doc schema has no threshold shape yet)

  const cap = lowerCap(rule);

  // INV-2: only a bare `all` rule lowers policy-free.
  const constraintFree =
    rule.functions === undefined && rule.args === undefined && cap === undefined;

  const notAfter = rule['not-after-ledger'];
  if (notAfter !== undefined && notAfter < 1) {
    throw new LowerErr(rule.name, `not-after-ledger must be >= 1, got ${notAfter}`);
  }

  return {
    name: rule.name,
    contract,
    signers,
    ...(notAfter !== undefined ? { validUntil: notAfter - 1 } : {}),
    ...(constraintFree ? {} : { program: buildProgram(rule, minSigners) }),
    ...(cap !== undefined ? { cap } : {}),
  };
}

function resolveSigner(doc: PolicyDoc, ruleName: string, id: string): ChainSigner {
  const decl = doc.signers.find((s) => s.id === id);
  if (!decl) {
    throw new LowerErr(ruleName, `references undeclared signer id "${id}"`);
  }
  return signerDeclToChain(decl);
}

/** A doc signer declaration as the chain-facing signer shape. */
export function signerDeclToChain(decl: SignerDecl): ChainSigner {
  if ('address' in decl) {
    return { kind: 'delegated', address: decl.address };
  }
  let publicKey: Uint8Array;
  try {
    publicKey = hexToBytes(decl.key);
  } catch {
    throw new Error(`policyDoc: signer "${decl.id}": key is not valid hex`);
  }
  return { kind: 'external', verifier: decl.verifier, publicKey };
}

function lowerCap(rule: Rule): LoweredCap | undefined {
  const cap = rule.cap;
  if (cap === undefined) return undefined;
  // Mirror perch-ir's five fail-closed cap checks.
  if (rule.scope.type !== 'contract') {
    throw new LowerErr(rule.name, 'a cap needs a contract scope (no token to meter on self-admin)');
  }
  if (!/^[0-9]+$/.test(cap.limit)) {
    throw new LowerErr(rule.name, `cap.limit "${cap.limit}" is not a positive decimal integer`);
  }
  const limitStroops = BigInt(cap.limit);
  if (limitStroops <= 0n || limitStroops > I128_MAX) {
    throw new LowerErr(rule.name, `cap.limit ${cap.limit} out of range (positive i128 required)`);
  }
  if (cap['period-ledgers'] === 0) {
    throw new LowerErr(rule.name, 'cap.period-ledgers must be non-zero');
  }
  if (cap.token !== undefined && cap.token !== rule.scope.address) {
    throw new LowerErr(
      rule.name,
      `cap.token ${cap.token} differs from the rule's contract scope ${rule.scope.address} — it would silently meter a different contract`,
    );
  }
  return { limitStroops, periodLedgers: cap['period-ledgers'] };
}

/** Build the interpreter program for a constrained rule (perch-compile's
 *  `build_program`): `All(` MinSigners(m) + the function allowlist + each
 *  argument predicate `)`. */
function buildProgram(rule: Rule, minSigners: number): RpnProgram {
  const ops: Op[] = [{ tag: 'MinSigners', values: [Math.max(minSigners, 1)] }];
  let leaves = 1;

  if (rule.functions !== undefined) {
    ops.push({ tag: 'FnIn', values: [[...rule.functions]] });
    leaves += 1;
  }
  for (const c of rule.args ?? []) {
    ops.push(lowerArgPred(rule.name, c));
    leaves += 1;
  }
  ops.push({ tag: 'All', values: [leaves] });

  const program: RpnProgram = { version: PROGRAM_VERSION, ops };
  const err = validateProgram(program);
  if (err !== null) {
    throw new LowerErr(rule.name, `lowered program failed validation: ${err}`);
  }
  return program;
}

function lowerArgPred(ruleName: string, c: ArgConstraint): Op {
  const { index, pred } = c;
  switch (pred.type) {
    case 'is-self':
      return { tag: 'ArgAddrIsSelf', values: [index] };
    case 'address-eq':
      return { tag: 'ArgAddrEq', values: [index, pred.address] };
    case 'u32-eq':
      return { tag: 'ArgU32Eq', values: [index, pred.value] };
    case 'string-in':
      return { tag: 'ArgStrIn', values: [index, [...pred.values]] };
    case 'string-prefix':
      return { tag: 'ArgStrPrefix', values: [index, pred.prefix] };
    default: {
      const exhaustive: never = pred;
      throw new LowerErr(ruleName, `unknown arg predicate ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Structural program validation, mirroring perch-program's `rpn::validate`
 * (the interpreter re-runs this at install time and panics `InvalidProgram`;
 * checking client-side fails earlier and cheaper). Returns an error string,
 * or null when the program is valid.
 */
export function validateProgram(program: RpnProgram): string | null {
  if (program.version !== PROGRAM_VERSION) return `unknown version ${program.version}`;
  if (program.ops.length === 0) return 'empty program';
  if (program.ops.length > MAX_PROGRAM_LEN) {
    return `program too large (${program.ops.length} > ${MAX_PROGRAM_LEN} ops)`;
  }
  let depth = 0;
  for (const op of program.ops) {
    let pops = 0;
    if (op.tag === 'Not') {
      pops = 1;
    } else if (op.tag === 'All' || op.tag === 'Any') {
      const n = op.values[0];
      if (n === 0) return `${op.tag}(0) arity mismatch`;
      pops = n;
    }
    if (depth < pops) return `stack underflow at ${op.tag}`;
    depth = depth - pops + 1;
    if (depth > MAX_STACK_DEPTH) return `stack overflow (> ${MAX_STACK_DEPTH})`;
  }
  return depth === 1 ? null : `program leaves ${depth} results on the stack, expected 1`;
}
