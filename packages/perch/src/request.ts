// An ERC-7715-shaped permission *request* that maps 1:1 onto a perch PolicyDoc.
//
// perch is the on-chain enforcement half of a 7715-style split: a dapp/wallet
// asks for a scoped, time-bounded, optionally-capped delegation, and that
// request lowers to a canonical PolicyDoc whose `doc_hash` the Rust compiler
// then lowers to an on-chain Plan. This module is the request → PolicyDoc half;
// producing the Plan is Rust-side (compile()) / a TS follow-up on #8.
//
// The mapping is deliberately total and lossless: `requestToPolicyDoc` produces
// a document that `parsePolicyDoc` accepts (fail-closed) and that canonicalizes
// to the same bytes — and therefore the same `doc_hash` — the Rust model would.

import type { ArgConstraint, CapConstraint, PolicyDoc, SignerDecl } from './schema.js';
import { parsePolicyDoc } from './schema.js';

/** Where a permission applies: the account itself, or one contract. */
export type PermissionScope = 'self-admin' | { contract: string };

/** One requested permission — becomes one rule. Only the `all`-principals shape
 *  is expressible here (every listed signer must authorize); the rarer
 *  self-authenticating rule is authored directly as a PolicyDoc. */
export interface Permission {
  name: string;
  on: PermissionScope;
  /** Signer ids that must all authorize (maps to `principals: all`). */
  by: string[];
  functions?: string[];
  args?: ArgConstraint[];
  /** Ledger sequence at/after which the permission stops (not-after-ledger). */
  until?: number;
  cap?: CapConstraint;
}

/** A 7715-shaped permission request over a set of declared signers. */
export interface PolicyRequest {
  network?: string;
  signers: SignerDecl[];
  permissions: Permission[];
}

/** Lower a request to its canonical PolicyDoc, validating fail-closed. The
 *  returned document canonicalizes (and hashes) identically to the same policy
 *  authored directly or built by the Rust model. */
export function requestToPolicyDoc(req: PolicyRequest): PolicyDoc {
  const rules = req.permissions.map((p) => ({
    name: p.name,
    scope: p.on === 'self-admin' ? { type: 'self-admin' } : { type: 'contract', address: p.on.contract },
    principals: { type: 'all', signers: p.by },
    ...(p.functions !== undefined ? { functions: p.functions } : {}),
    ...(p.args !== undefined ? { args: p.args } : {}),
    ...(p.until !== undefined ? { 'not-after-ledger': p.until } : {}),
    ...(p.cap !== undefined ? { cap: p.cap } : {}),
  }));
  const doc = {
    version: 1,
    ...(req.network !== undefined ? { network: req.network } : {}),
    signers: req.signers,
    rules,
  };
  // Fail closed: a request that does not map to a valid PolicyDoc throws.
  return parsePolicyDoc(doc);
}
