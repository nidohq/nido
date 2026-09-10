/**
 * SPIKE: the three-tier policy read for accounts with the hybrid
 * `apply_doc` surface (contracts/smart-account/src/doc.rs):
 *
 *   a. `doc-verified` — a document recovered from the `DocApplied` event
 *      history whose canonical hash matches the STORED `applied_doc_hash`,
 *      AND whose lowering matches the live doc-managed chain rules. The
 *      rich, reviewer-grade view.
 *   b. `doc-drift` — the hash still verifies (the doc is authentic) but the
 *      live rules have drifted from its lowering — hybrid accounts keep the
 *      legacy mutators, so a doc-managed rule can be edited out from under
 *      its document. The doc is returned WITH the drift list.
 *   c. `decompiled` — no stored hash, no recoverable event doc, or a
 *      recovered doc that fails hash verification: fall back to the
 *      existing best-effort `decompileRules` view.
 *
 * Pure, like `decompileRules`: the caller fetches chain state and passes it
 * in. The three chain-side inputs come from:
 * - `applied_doc_hash()` / `doc_rule_ids()` — smart-account views,
 * - the doc JSON — the account's latest `DocApplied` contract event (topics
 *   `["doc_applied", <doc_hash: bytes>]`, data `{doc_json: bytes}`), e.g.
 *   via RPC `getEvents`. NOTE: RPC event retention is finite (days); past
 *   it, recovery needs an indexer — until then such accounts read as tier c
 *   even though a document is applied. A real adoption cost to weigh.
 *
 * Drift detection is deliberately spike-lean: it compares rule scope, name,
 * signer sets, expiry, and interpreter attachment, and — when interpreter
 * programs are provided — each program's committed doc_hash against the
 * stored hash (the interpreter install params commit to the document, so
 * this pins program CONTENT without re-deriving programs here). It does not
 * chase exotic mismatches beyond that.
 */

import { docHash, parsePolicyDocJson } from '@stellar-registry/perch';
import type { PolicyDoc } from '@stellar-registry/perch';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ChainRule, ChainSigner } from '../policyBlocks/types.js';
import { decompileRules } from './decompile.js';
import { lowerDoc } from './lower.js';
import type { DecompileContext, DecompileResult, LoweredRule } from './types.js';

/** Event name (first topic symbol) of the account's `DocApplied` event. */
export const DOC_APPLIED_EVENT = 'doc_applied';

export type PolicyReadTier = 'doc-verified' | 'doc-drift' | 'decompiled';

export interface ReadPolicyInputs {
  /** ALL of the account's chain rules (as for `decompileRules`). */
  chainRules: ChainRule[];
  /** The stored canonical hash from `applied_doc_hash()`, or null if the
   *  account never applied a document. Bytes or lowercase hex. */
  appliedDocHash: Uint8Array | string | null;
  /** Doc-managed rule ids from `doc_rule_ids()`, in install (= document)
   *  order. */
  docRuleIds: number[];
  /** The doc JSON recovered from the latest `DocApplied` event whose
   *  `doc_hash` topic equals `appliedDocHash`, if event history still
   *  reaches it. */
  eventDocJson?: string;
  /** Context for the decompile fallback; its `interpreterAddress` and
   *  `programs` also power the tier-a/b parity check. */
  decompileCtx: DecompileContext;
}

export interface ReadPolicyResult {
  tier: PolicyReadTier;
  /** Tiers a/b: the recovered, hash-verified document. */
  doc?: PolicyDoc;
  /** Tiers a/b: its lowercase-hex canonical hash (== the stored hash). */
  docHash?: string;
  /** Tier b: what drifted, human-readable, one entry per finding. */
  drift?: string[];
  /** Tier c: the best-effort decompiled view. */
  decompiled?: DecompileResult;
}

/** Classify an account's policy state into the three read tiers. */
export function readPolicy(inputs: ReadPolicyInputs): ReadPolicyResult {
  const stored = normalizeHash(inputs.appliedDocHash);
  const fallback = (): ReadPolicyResult => ({
    tier: 'decompiled',
    decompiled: decompileRules(inputs.chainRules, inputs.decompileCtx),
  });

  if (stored === null || inputs.eventDocJson === undefined) {
    return fallback();
  }

  let doc: PolicyDoc;
  try {
    doc = parsePolicyDocJson(inputs.eventDocJson);
  } catch {
    return fallback();
  }
  const hash = docHash(doc);
  if (hash !== stored) {
    // The recovered doc is not the applied one — treat as unrecoverable.
    return fallback();
  }

  const drift = diffDocAgainstChain(doc, inputs, stored);
  if (drift.length > 0) {
    return { tier: 'doc-drift', doc, docHash: hash, drift };
  }
  return { tier: 'doc-verified', doc, docHash: hash };
}

/** Compare the doc's lowering against the live doc-managed rules. */
function diffDocAgainstChain(
  doc: PolicyDoc,
  inputs: ReadPolicyInputs,
  storedHash: string,
): string[] {
  const ctx = inputs.decompileCtx;
  const drift: string[] = [];

  let lowered: LoweredRule[];
  try {
    lowered = lowerDoc(doc, { account: ctx.account }).rules;
  } catch (e) {
    // The doc verifies but this SDK cannot lower it (e.g. a newer doc
    // feature) — report as drift rather than pretending it matches.
    return [`document could not be lowered for comparison: ${e instanceof Error ? e.message : e}`];
  }

  if (lowered.length !== inputs.docRuleIds.length) {
    drift.push(
      `document lowers to ${lowered.length} rule(s) but ${inputs.docRuleIds.length} doc-managed rule id(s) are recorded on chain`,
    );
    return drift;
  }

  const byId = new Map(inputs.chainRules.map((r) => [r.ruleId, r]));
  lowered.forEach((docRule, i) => {
    const id = inputs.docRuleIds[i];
    const chainRule = byId.get(id);
    if (!chainRule) {
      drift.push(`doc rule "${docRule.name}": doc-managed rule ${id} no longer exists on chain`);
      return;
    }
    drift.push(...diffRule(docRule, chainRule, inputs, storedHash));
  });
  return drift;
}

function diffRule(
  docRule: LoweredRule,
  chainRule: ChainRule,
  inputs: ReadPolicyInputs,
  storedHash: string,
): string[] {
  const ctx = inputs.decompileCtx;
  const at = `rule ${chainRule.ruleId} ("${docRule.name}")`;
  const drift: string[] = [];

  if (chainRule.name !== docRule.name) {
    drift.push(`${at}: renamed to "${chainRule.name}"`);
  }
  if (
    chainRule.contextType.kind !== 'call-contract' ||
    chainRule.contextType.contract !== docRule.contract
  ) {
    drift.push(`${at}: scope changed (doc scopes it to ${docRule.contract})`);
  }

  const docSigners = new Set(docRule.signers.map(signerKey));
  const chainSigners = new Set(chainRule.signers.map(signerKey));
  for (const s of docSigners) {
    if (!chainSigners.has(s)) drift.push(`${at}: signer ${s} removed on chain`);
  }
  for (const s of chainSigners) {
    if (!docSigners.has(s)) drift.push(`${at}: signer ${s} added on chain`);
  }

  const docValidUntil = docRule.validUntil ?? null;
  if (chainRule.validUntil !== docValidUntil) {
    drift.push(
      `${at}: expiry changed (chain valid_until ${chainRule.validUntil}, doc lowers to ${docValidUntil})`,
    );
  }

  // Interpreter attachment: a constrained doc rule must carry the
  // interpreter (and nothing else in this spike's cap-less apply_doc); an
  // unconstrained one must be policy-free.
  if (ctx.interpreterAddress !== undefined) {
    const hasInterpreter = chainRule.policies.includes(ctx.interpreterAddress);
    if (docRule.program !== undefined && !hasInterpreter) {
      drift.push(`${at}: interpreter policy detached on chain`);
    }
    if (docRule.program === undefined && chainRule.policies.length > 0) {
      drift.push(`${at}: policies attached on chain to a policy-free doc rule`);
    }
  }
  // Program content: the interpreter install commits to the applied doc's
  // hash, so a fetched program committing to another hash was installed by
  // something other than this document.
  const program = ctx.programs?.[chainRule.ruleId];
  if (docRule.program !== undefined && program !== undefined) {
    const committed =
      typeof program.docHash === 'string'
        ? program.docHash.toLowerCase()
        : bytesToHex(program.docHash);
    if (committed !== storedHash) {
      drift.push(`${at}: interpreter program commits to a different doc_hash (${committed})`);
    }
  }
  return drift;
}

function signerKey(s: ChainSigner): string {
  return s.kind === 'delegated'
    ? `delegated:${s.address}`
    : `key:${s.verifier}:${bytesToHex(s.publicKey)}`;
}

function normalizeHash(h: Uint8Array | string | null): string | null {
  if (h === null) return null;
  return typeof h === 'string' ? h.toLowerCase() : bytesToHex(h);
}
