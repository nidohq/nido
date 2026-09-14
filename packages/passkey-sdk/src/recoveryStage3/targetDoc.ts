//! Target-document construction + diff for Stage 3 recovery
//! (`docs/recovery/TRANSITION_SPEC.md` §4/§4.2,
//! `contracts/recovery-controller/src/contract.rs::begin_attempt`'s doc
//! comment):
//!
//!   lost-key target   = CURRENT live document, with named roles replaced
//!   compromise target = ENROLLED BASELINE document, with named roles replaced
//!
//! This contract has no doc-parsing access of its own (see the crate doc
//! comment's "Known limits" — `replaced_credential_ids` is a client-declared
//! bookkeeping input, not an on-chain-verified doc diff); the trust boundary
//! is evidence providers reviewing the target-document PREVIEW this module
//! produces (`diffPolicyDocs`) before approving. There is no existing
//! doc-diff helper elsewhere in the codebase (checked `packages/frontend/src`
//! and `packages/passkey-sdk/src` — none), so this is a plain, from-scratch
//! before/after structural diff, matching the brief's "a simple before/after
//! JSON diff is fine given 'plain' is explicitly acceptable here."
import { sha256 } from '@noble/hashes/sha2.js';
import { docHash } from '@stellar-registry/perch';
import type { PolicyDoc, Rule, SignerDecl } from '@stellar-registry/perch';
import type { CredentialReplacement } from './types.js';

export class TargetDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetDocError';
  }
}

function cloneSigner(s: SignerDecl): SignerDecl {
  return 'address' in s ? { id: s.id, address: s.address } : { id: s.id, verifier: s.verifier, key: s.key };
}

/** Applies role→newCredential replacements to `source`'s `signers` array,
 *  preserving every rule untouched (rules reference signer IDS, not raw
 *  keys, so swapping the `signers` entry at a given id automatically
 *  re-binds every rule that names that id — no rule edits needed). Refuses
 *  (throws `TargetDocError`) if a replacement names a signer id the source
 *  document doesn't have, mirroring `TRANSITION_SPEC.md` §7's
 *  `STALE_REPLACEMENT` rule. */
function applyReplacements(source: PolicyDoc, replacements: CredentialReplacement[]): PolicyDoc {
  const signers = source.signers.map(cloneSigner);
  for (const r of replacements) {
    const idx = signers.findIndex((s) => s.id === r.signerId);
    if (idx === -1) {
      throw new TargetDocError(
        `buildTargetDoc: signer id "${r.signerId}" not found in the source document — refusing (stale replacement)`,
      );
    }
    signers[idx] =
      'address' in r.newSigner
        ? { id: r.signerId, address: r.newSigner.address }
        : { id: r.signerId, verifier: r.newSigner.verifier, key: r.newSigner.key };
  }
  return { ...source, signers };
}

/** `LostKey` target: the account's CURRENT live document (captured by the
 *  caller via `readPolicy` at `begin_attempt` time — see that function's own
 *  doc comment on why this contract trusts the caller's snapshot), with
 *  `replacements` applied. */
export function buildLostKeyTargetDoc(currentDoc: PolicyDoc, replacements: CredentialReplacement[]): PolicyDoc {
  return applyReplacements(currentDoc, replacements);
}

/** `Compromise` target: the ENROLLED BASELINE document (never the live
 *  document — this is what discards anything an attacker planted after the
 *  baseline was approved), with `replacements` applied. `begin_attempt`
 *  requires this doc's hash to equal `config.baseline_doc_hash` exactly, so
 *  callers MUST pass the same baseline document the account enrolled with. */
export function buildCompromiseTargetDoc(baselineDoc: PolicyDoc, replacements: CredentialReplacement[]): PolicyDoc {
  return applyReplacements(baselineDoc, replacements);
}

/** The canonical `doc_hash` a target document commits to — what
 *  `begin_attempt`'s `target_doc_hash` argument and, later, the completing
 *  `apply_doc` call's submitted bytes must both hash to. Thin re-export of
 *  perch's `docHash` so callers don't need a second import. */
export function targetDocHash(doc: PolicyDoc): string {
  return docHash(doc);
}

/** Deterministic 32-byte identifier for a signer declaration, used to build
 *  `begin_attempt`'s `replacedCredentialIds` argument. This is CLIENT-side
 *  bookkeeping only — the contract never verifies it against document
 *  content (see the crate doc comment's "Known limits"), so any stable
 *  derivation is fine as long as this SDK derives it the SAME way on every
 *  call for the same credential (this function does — sha256 over a fixed
 *  string encoding of the signer's identifying fields). */
export function credentialIdForSigner(signer: SignerDecl): Uint8Array {
  const encoder = new TextEncoder();
  const material =
    'address' in signer ? `delegated:${signer.address}` : `external:${signer.verifier}:${signer.key}`;
  return sha256(encoder.encode(material));
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface SignerDiffEntry {
  id: string;
  before?: SignerDecl;
  after?: SignerDecl;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}

export interface RuleDiffEntry {
  name: string;
  before?: Rule;
  after?: Rule;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}

export interface PolicyDocDiff {
  beforeHash: string;
  afterHash: string;
  identical: boolean;
  signers: SignerDiffEntry[];
  rules: RuleDiffEntry[];
}

function signerEqual(a: SignerDecl, b: SignerDecl): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ruleEqual(a: Rule, b: Rule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Plain, structural before/after diff between the CURRENT live document and
 *  a proposed target document — for the evidence-review UI (guardians and,
 *  for ZK evidence, the human generating a proof) to see exactly what would
 *  change before approving. Diffs `signers` by `id` and `rules` by `name`
 *  (perch doc rules don't carry a separate stable id); anything not
 *  identically JSON-equal is reported `changed`. */
export function diffPolicyDocs(before: PolicyDoc, after: PolicyDoc): PolicyDocDiff {
  const beforeSigners = new Map(before.signers.map((s) => [s.id, s]));
  const afterSigners = new Map(after.signers.map((s) => [s.id, s]));
  const signerIds = new Set([...beforeSigners.keys(), ...afterSigners.keys()]);
  const signers: SignerDiffEntry[] = [...signerIds].map((id) => {
    const b = beforeSigners.get(id);
    const a = afterSigners.get(id);
    let status: SignerDiffEntry['status'];
    if (!b) status = 'added';
    else if (!a) status = 'removed';
    else status = signerEqual(b, a) ? 'unchanged' : 'changed';
    return { id, before: b, after: a, status };
  });

  const beforeRules = new Map(before.rules.map((r) => [r.name, r]));
  const afterRules = new Map(after.rules.map((r) => [r.name, r]));
  const ruleNames = new Set([...beforeRules.keys(), ...afterRules.keys()]);
  const rules: RuleDiffEntry[] = [...ruleNames].map((name) => {
    const b = beforeRules.get(name);
    const a = afterRules.get(name);
    let status: RuleDiffEntry['status'];
    if (!b) status = 'added';
    else if (!a) status = 'removed';
    else status = ruleEqual(b, a) ? 'unchanged' : 'changed';
    return { name, before: b, after: a, status };
  });

  const beforeHash = docHash(before);
  const afterHash = docHash(after);
  return {
    beforeHash,
    afterHash,
    identical: beforeHash === afterHash,
    signers,
    rules,
  };
}
