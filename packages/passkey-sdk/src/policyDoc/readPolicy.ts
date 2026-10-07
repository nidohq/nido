/**
 * Doc-only: the two-tier policy read for accounts whose sole policy
 * write path is `apply_doc` (contracts/smart-account/src/doc.rs):
 *
 *   a. `doc-verified` — a document read from the on-chain copy
 *      (`get_applied_doc`, lossless, no indexer needed) or recovered from
 *      the `DocApplied` event history, whose canonical hash matches the
 *      STORED `applied_doc_hash`. Under doc-only there is no drift tier BY
 *      CONSTRUCTION: the account has no rule mutators, so the live rules
 *      are exactly the applied document's lowering (plus the protected
 *      zk-recovery rule and, transiently after a recovery completion, the
 *      "recovered" rule — both outside the document by design).
 *   b. `decompiled` — no stored hash (a pre-doc account or a foreign
 *      account), no recoverable doc, or a candidate that fails hash
 *      verification: fall back to the best-effort `decompileRules` view.
 *
 * Pure, like `decompileRules`: the caller fetches chain state and passes it
 * in. The chain-side inputs come from:
 * - `applied_doc_hash()` — the smart-account view,
 * - the doc JSON, from either source (prefer the view):
 *   - `applied_doc()` — the on-chain canonical copy (`storedDocJson`).
 *     Lossless and always available while the entry lives; the primary
 *     source, and on a Perch account the only one on chain.
 *   - a copy archived elsewhere (`eventDocJson`), e.g. by an indexer that
 *     kept each applied document. A Perch account's `DocApplied` event
 *     (topics `["doc_applied", <doc_hash>]`, data: how many rules, signers,
 *     and policies the apply added, removed, or edited) names the hash but
 *     carries no document.
 */

import { docHash, parsePolicyDocJson } from '@stellar-registry/perch';
import type { PolicyDoc } from '@stellar-registry/perch';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ChainRule } from '../policyBlocks/types.js';
import { decompileRules } from './decompile.js';
import type { DecompileContext, DecompileResult } from './types.js';

/** Event name (first topic symbol) of the account's `DocApplied` event. */
export const DOC_APPLIED_EVENT = 'doc_applied';

export type PolicyReadTier = 'doc-verified' | 'decompiled';

export interface ReadPolicyInputs {
  /** ALL of the account's chain rules (as for `decompileRules`). */
  chainRules: ChainRule[];
  /** The stored canonical hash from `applied_doc_hash()`, or null if the
   *  account never applied a document. Bytes or lowercase hex. */
  appliedDocHash: Uint8Array | string | null;
  /** The on-chain canonical doc JSON from `get_applied_doc()` — the
   *  primary, lossless doc source (decoded to a string). */
  storedDocJson?: string;
  /** A document archived elsewhere whose hash should equal
   *  `appliedDocHash`. Fallback source when the view isn't fetched. */
  eventDocJson?: string;
  /** Context for the decompile fallback. */
  decompileCtx: DecompileContext;
}

export interface ReadPolicyResult {
  tier: PolicyReadTier;
  /** Tier a: the recovered, hash-verified document — the policy, losslessly. */
  doc?: PolicyDoc;
  /** Tier a: its lowercase-hex canonical hash (== the stored hash). */
  docHash?: string;
  /** Tier b: the best-effort decompiled view. */
  decompiled?: DecompileResult;
}

/** Classify an account's policy state into the two read tiers. */
export function readPolicy(inputs: ReadPolicyInputs): ReadPolicyResult {
  const stored = normalizeHash(inputs.appliedDocHash);
  const fallback = (): ReadPolicyResult => ({
    tier: 'decompiled',
    decompiled: decompileRules(inputs.chainRules, inputs.decompileCtx),
  });

  if (stored === null) {
    return fallback();
  }

  // Prefer the on-chain copy (`get_applied_doc`), fall back to the
  // event-recovered JSON. Either way a candidate is trusted only if it
  // parses AND canonicalizes to the STORED hash.
  for (const candidate of [inputs.storedDocJson, inputs.eventDocJson]) {
    if (candidate === undefined) continue;
    try {
      const parsed = parsePolicyDocJson(candidate);
      if (docHash(parsed) === stored) {
        return { tier: 'doc-verified', doc: parsed, docHash: stored };
      }
    } catch {
      // Unparseable candidate — try the next source.
    }
  }
  return fallback();
}

function normalizeHash(h: Uint8Array | string | null): string | null {
  if (h === null) return null;
  return typeof h === 'string' ? h.toLowerCase() : bytesToHex(h);
}
