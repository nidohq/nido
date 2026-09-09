/**
 * Types for the perch PolicyDoc layer.
 *
 * A perch `PolicyDoc` (see `@stellar-registry/perch`) is nido's policy source
 * of truth at the document layer: a declarative, reviewable, content-hashed
 * JSON description of what each signer on a smart account may do. This module
 * lowers documents onto the OZ context rules nido accounts already run on —
 * stock nido policy contracts where the shape fits (spending-limit for
 * cumulative caps), the perch interpreter for what they can't express — and
 * decompiles existing chain rules back into a best-effort document view.
 */

import type { PolicyDoc, Rule, SignerDecl } from '@stellar-registry/perch';
import type { ChainRule, ChainSigner, TxBuild } from '../policyBlocks/types.js';

/** Ops of the interpreter's postfix constraint program, in the generated
 *  bindings' `{tag, values}` union shape (see `@nidohq/perch-interpreter`). */
export type { Op as RpnOp, RpnProgram, InstallParams as InterpreterInstallParams } from '@nidohq/perch-interpreter';
import type { RpnProgram } from '@nidohq/perch-interpreter';

/** A cumulative spending cap, lowered onto nido's stock spending-limit
 *  policy (OZ `SpendingLimitAccountParams`). Perch constraints are stateless
 *  by design, so cumulative accounting always lives in this stateful sibling
 *  policy, attached to the same context rule as the interpreter. */
export interface LoweredCap {
  /** Cap in stroops over the rolling window (i128 on-chain). */
  limitStroops: bigint;
  /** Rolling-window length in ledgers (~5s each). */
  periodLedgers: number;
}

/**
 * One doc rule lowered onto one OZ context rule. Pure data — no addresses of
 * the policy contracts yet (those are resolved when building transactions),
 * so a plan can be inspected/tested without any network access.
 */
export interface LoweredRule {
  /** OZ context rule name (from the doc rule's `name`). */
  name: string;
  /** Always a CallContract scope: a `self-admin` doc rule lowers to
   *  `CallContract(the account itself)`. */
  contract: string;
  /** Resolved signers, in doc order. Reuses the chain-facing signer shape. */
  signers: ChainSigner[];
  /** OZ `valid_until` (inclusive), from the doc's exclusive
   *  `not-after-ledger` minus one. */
  validUntil?: number;
  /** Present ⇒ attach the perch interpreter with
   *  `InstallParams { program, doc_hash }`. Absent ⇒ the rule is
   *  constraint-free and rides OZ's native all-signers-must-match. */
  program?: RpnProgram;
  /** Present ⇒ also attach the stock spending-limit policy. A capped rule
   *  always carries `program` too (the `MinSigners` floor must hold
   *  independently of spending-limit's single-signer floor). */
  cap?: LoweredCap;
}

/** The full lowering of a document: an install plan of one OZ context rule
 *  per doc rule, in document order. */
export interface LoweredDoc {
  /** Lowercase-hex sha256 of the document's canonical JSON — the identity a
   *  reviewer approves and every interpreter install param commits to. */
  docHash: string;
  rules: LoweredRule[];
  /** True iff any rule attaches the interpreter. */
  usesInterpreter: boolean;
  /** True iff any rule attaches the spending-limit policy. */
  usesSpendingLimit: boolean;
}

/** One install transaction of a plan: an `add_context_rule` invocation the
 *  existing signing flow (`signAndSubmit`) can execute. */
export interface DocInstallStep extends TxBuild {
  /** The doc rule this step installs. */
  ruleName: string;
}

/** Result of decompiling one chain rule: either a perch doc-rule view, or a
 *  raw fallback the UI must still render (never hide a rule — hiding it would
 *  hide its Revoke path). */
export type DecompiledRule =
  | {
      kind: 'doc';
      ruleId: number;
      /** The doc rule (wire shape), suitable for inspector cards. */
      rule: Rule;
      /** Signer declarations this rule references, resolved from the chain
       *  signers (ids are synthesized — see `decompileRules`). */
      signers: SignerDecl[];
      /** The doc_hash the on-chain interpreter program commits to, when the
       *  rule carries one. This is the hash of the ORIGINAL installed
       *  document, not of the reconstructed view. */
      committedDocHash?: string;
    }
  | {
      kind: 'raw';
      ruleId: number;
      chainRule: ChainRule;
      /** Why this rule could not be expressed as a doc rule. */
      reason: string;
    };

/** Everything `decompileRules` may use. All fields except `account` are
 *  optional: the less context provided, the more rules fall back to raw. */
export interface DecompileContext {
  /** The smart account address — a rule scoped to it decompiles to
   *  `self-admin`. */
  account: string;
  /** The perch interpreter's address; rules carrying other policies at this
   *  address are decoded via `programs`. */
  interpreterAddress?: string;
  /** Nido's stock spending-limit policy address. */
  spendingLimitAddress?: string;
  /** Nido's multisig (threshold) policy address — recognized so the raw
   *  fallback can say why (M-of-N is not expressible in doc v1's TS schema). */
  multisigPolicyAddress?: string;
  /** Interpreter install params per rule id, fetched by the caller via the
   *  interpreter's public `get_program(smart_account, context_rule_id)` view
   *  (see `@nidohq/perch-interpreter`). Rules that carry the interpreter but
   *  have no entry here fall back to raw. */
  programs?: Record<number, { program: RpnProgram; docHash: Uint8Array | string }>;
  /** Spending-limit params per rule id, fetched by the caller (the frontend
   *  already does this for its session-key cards). */
  spendingLimits?: Record<number, LoweredCap>;
}

/** Best-effort document view of an account's chain rules. */
export interface DecompileResult {
  /** One entry per input rule, in input order. */
  rules: DecompiledRule[];
  /** A document assembled from the mapped rules (deduped signers, doc-order
   *  rules), or null when nothing mapped. This is a VIEW: its hash will not
   *  match the originally installed document (signer ids and rule ordering
   *  are not stored on chain) — for that, see `committedDocHashes`. */
  doc: PolicyDoc | null;
  /** Lowercase-hex doc_hash of `doc`, or null. */
  docHash: string | null;
  /** Distinct doc hashes committed by on-chain interpreter programs, in
   *  first-seen order. A single entry means every interpreter rule on the
   *  account came from the same document. */
  committedDocHashes: string[];
}
