// Pure validation + document construction for the policy builder's DOC mode
// (sibling of policyDraft.ts, which backs the raw add_context_rule mode).
//
// Doc mode emits a perch PolicyDoc — for the showcase, the canned v1
// template: one scoped session key (a delegated signer restricted to one
// contract's named functions, with an expiry) optionally composed with a
// cumulative spending cap. The pure layer validates the form draft, builds
// the document via the SDK, and decides which apply route the transaction
// takes; the component does the RPC + signing.

import { scopedSessionKeyDoc, type PolicyDoc } from '@nidohq/passkey-sdk';
import { isContractAddress, isStellarAddress, MAX_RULE_NAME_LEN } from './policyDraft.js';

/** Soroban symbol constraints for function names (SCSymbol: [A-Za-z0-9_],
 *  max 32 bytes). Checked client-side so a typo'd function list fails with a
 *  real message instead of a doomed simulation. */
const FN_NAME_RE = /^[A-Za-z0-9_]{1,32}$/;

export interface SessionDocDraft {
  /** Rule name (becomes the doc rule's name — shown losslessly on read). */
  name: string;
  /** The delegated session signer (G… account or C… contract strkey). */
  sessionAddress: string;
  /** The one contract the key may call. */
  targetContract: string;
  /** Raw comma/space-separated function-name input; empty = any function. */
  functionsInput: string;
  /** Exclusive not-after ledger, or null for no expiry. */
  notAfterLedger: number | null;
  /** Cumulative cap, or null for none. */
  cap: { stroops: string; periodLedgers: number } | null;
}

/** Parse the functions input to a doc function list. Empty input means the
 *  rule allows any function (the doc omits `functions`). */
export function parseFunctionsInput(raw: string): string[] | undefined {
  const names = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.length > 0 ? names : undefined;
}

export interface DocValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSessionDocDraft(draft: SessionDocDraft): DocValidationResult {
  const errors: string[] = [];

  const name = draft.name.trim();
  if (name.length === 0) errors.push('Give the rule a name.');
  else if (new TextEncoder().encode(name).length > MAX_RULE_NAME_LEN) {
    errors.push(`Name must be at most ${MAX_RULE_NAME_LEN} bytes.`);
  }

  if (!isStellarAddress(draft.sessionAddress.trim())) {
    errors.push('Session key is not a valid C- or G-address.');
  }
  if (!isContractAddress(draft.targetContract.trim())) {
    errors.push('Target contract is not a valid C-address.');
  }

  for (const fn of parseFunctionsInput(draft.functionsInput) ?? []) {
    if (!FN_NAME_RE.test(fn)) {
      errors.push(`Function "${fn}" is not a valid contract function name.`);
    }
  }

  if (draft.notAfterLedger !== null) {
    if (!Number.isInteger(draft.notAfterLedger) || draft.notAfterLedger <= 0) {
      errors.push('Expiry ledger must be a positive integer.');
    }
  }

  if (draft.cap !== null) {
    let stroops: bigint | null = null;
    try {
      stroops = BigInt(draft.cap.stroops);
    } catch {
      stroops = null;
    }
    if (stroops === null || stroops <= 0n) errors.push('Spending cap must be a positive amount.');
    if (!Number.isInteger(draft.cap.periodLedgers) || draft.cap.periodLedgers <= 0) {
      errors.push('Spending-cap window must be a positive number of ledgers.');
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Build the template document from a validated draft.
 *  Precondition: `validateSessionDocDraft(draft).ok`. */
export function draftToDoc(draft: SessionDocDraft, networkPassphrase: string): PolicyDoc {
  const functions = parseFunctionsInput(draft.functionsInput);
  return scopedSessionKeyDoc({
    sessionAddress: draft.sessionAddress.trim(),
    targetContract: draft.targetContract.trim(),
    ...(functions !== undefined ? { functions } : {}),
    ...(draft.notAfterLedger !== null ? { notAfterLedger: draft.notAfterLedger } : {}),
    ...(draft.cap !== null
      ? {
          cap: {
            limitStroops: BigInt(draft.cap.stroops),
            periodLedgers: draft.cap.periodLedgers,
          },
        }
      : {}),
    network: networkPassphrase,
    name: draft.name.trim(),
    signerId: 'session',
  });
}

export type ApplyRoute = 'apply-doc' | 'per-rule';

/**
 * Which install path a document takes:
 *
 * - `apply-doc` — the one-transaction on-chain compile path. Requires the
 *   account's `apply_doc` surface AND an uncapped doc (the hybrid contract
 *   refuses capped docs: it cannot resolve the stock spending-limit policy
 *   in-contract).
 * - `per-rule` — the SDK lowers client-side and installs one
 *   `add_context_rule` per rule. Works on every account; the only path for
 *   capped docs.
 */
export function chooseApplyRoute(args: { hasDocSurface: boolean; docHasCap: boolean }): ApplyRoute {
  if (args.docHasCap || !args.hasDocSurface) return 'per-rule';
  return 'apply-doc';
}

/** Does the document carry any cumulative cap? (Drives the route choice and
 *  the builder's route hint.) */
export function docHasCap(doc: PolicyDoc): boolean {
  return doc.rules.some((r) => r.cap !== undefined);
}
