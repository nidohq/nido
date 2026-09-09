// Fail-closed zod schemas mirroring perch-ir's PolicyDoc, using the wire
// (kebab-case) field names verbatim so a parsed document canonicalizes to bytes
// identical to the Rust model. Every object is `.strict()` — an unknown field
// anywhere in the tree is rejected, matching perch-ir's `deny_unknown_fields`.
//
// Not yet mirrored from perch-ir (tracked for a follow-up on #8): duplicate JSON
// key rejection (JSON.parse silently keeps the last value; perch-ir rejects at
// the raw-text level) and the full semantic `validate()` pass. This schema
// covers shape + version + fail-closed unknown-field rejection.

import { z } from 'zod';

/** Author must paste this verbatim to acknowledge a rule with no signature
 *  check of its own. Mirrors perch-ir's ACK_SENTINEL. */
export const ACK_SENTINEL = 'this-policy-authenticates-or-anyone-can-fire-this-rule';

const u32 = z.number().int().gte(0).lte(0xffff_ffff);

// Signer shapes are discriminated by fields, not a `type` tag (mirroring
// perch-ir): `verifier`+`key` is external, `address` is delegated (CAP-0071 —
// the host authenticates the address inside the account's own auth entry).
// Both branches are strict, so a mixed shape matches neither and fails closed.
const externalSignerDecl = z
  .object({ id: z.string(), verifier: z.string(), key: z.string() })
  .strict();
const delegatedSignerDecl = z.object({ id: z.string(), address: z.string() }).strict();
const signerDecl = z.union([externalSignerDecl, delegatedSignerDecl]);

const contractScope = z.object({ type: z.literal('contract'), address: z.string() }).strict();
const selfAdminScope = z.object({ type: z.literal('self-admin') }).strict();
const scope = z.discriminatedUnion('type', [contractScope, selfAdminScope]);

const allPrincipals = z
  .object({ type: z.literal('all'), signers: z.array(z.string()) })
  .strict();
const selfAuthenticatingPrincipals = z
  .object({
    type: z.literal('self-authenticating'),
    policy: z.string(),
    'install-param-hex': z.string(),
    ack: z.string(),
  })
  .strict();
const principals = z.discriminatedUnion('type', [allPrincipals, selfAuthenticatingPrincipals]);

const isSelfPred = z.object({ type: z.literal('is-self') }).strict();
const addressEqPred = z.object({ type: z.literal('address-eq'), address: z.string() }).strict();
const stringInPred = z.object({ type: z.literal('string-in'), values: z.array(z.string()) }).strict();
const stringPrefixPred = z.object({ type: z.literal('string-prefix'), prefix: z.string() }).strict();
const u32EqPred = z.object({ type: z.literal('u32-eq'), value: u32 }).strict();
const argPred = z.discriminatedUnion('type', [
  isSelfPred,
  addressEqPred,
  stringInPred,
  stringPrefixPred,
  u32EqPred,
]);

const argConstraint = z.object({ index: u32, pred: argPred }).strict();

// A cumulative spend cap; lowers (Rust-side) to an OZ spending_limit policy.
// `limit` is a decimal string, not a number, because the canonical form carries
// only u32 numbers (see CANONICAL.md) and an i128 amount does not fit a JSON
// number safely. Mirrors perch-ir's CapConstraint.
const capConstraint = z
  .object({
    token: z.string().optional(),
    limit: z.string(),
    'period-ledgers': u32,
  })
  .strict();

const rule = z
  .object({
    name: z.string(),
    scope,
    principals,
    functions: z.array(z.string()).optional(),
    args: z.array(argConstraint).optional(),
    'not-after-ledger': u32.optional(),
    cap: capConstraint.optional(),
  })
  .strict();

export const policyDocSchema = z
  .object({
    version: z.literal(1),
    network: z.string().optional(),
    signers: z.array(signerDecl),
    rules: z.array(rule),
  })
  .strict();

export type PolicyDoc = z.infer<typeof policyDocSchema>;
export type SignerDecl = z.infer<typeof signerDecl>;
export type Scope = z.infer<typeof scope>;
export type Principals = z.infer<typeof principals>;
export type Rule = z.infer<typeof rule>;
export type ArgConstraint = z.infer<typeof argConstraint>;
export type ArgPred = z.infer<typeof argPred>;
export type CapConstraint = z.infer<typeof capConstraint>;

/** Parse and validate an already-JSON-parsed value into a PolicyDoc, throwing a
 *  ZodError on any shape/version/unknown-field violation (fail-closed). */
export function parsePolicyDoc(value: unknown): PolicyDoc {
  return policyDocSchema.parse(value);
}

/** Parse from a JSON string. Note: JSON.parse silently keeps the last of any
 *  duplicate keys — raw-text duplicate rejection is a tracked follow-up. */
export function parsePolicyDocJson(json: string): PolicyDoc {
  return parsePolicyDoc(JSON.parse(json));
}
