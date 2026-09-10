// Pure validation + document construction for the policy builder's DOC mode
// (sibling of policyDraft.ts, which backs the raw add_context_rule mode).
//
// Doc mode emits a perch PolicyDoc — for the showcase, the canned v1
// template: one scoped session key (a delegated signer restricted to one
// contract's named functions, with an expiry) optionally composed with a
// cumulative spending cap. The pure layer validates the form draft, builds
// the document via the SDK, and decides which apply route the transaction
// takes; the component does the RPC + signing.

import { parsePolicyDoc, scopedSessionKeyDoc, type PolicyDoc } from '@nidohq/passkey-sdk';
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

/**
 * Upsert the template's session rule into the account's currently applied
 * document. `apply_doc` is a whole-document write: applying a standalone
 * single-rule doc to an account that already has one would REPLACE the
 * applied set, so an update must carry the current document forward with
 * the new rule merged in.
 *
 * - No current doc → the standalone template document.
 * - Same rule name exists → the new rule replaces it (a "modified" rule in
 *   the diff).
 * - Signer reuse: an existing declaration for the SAME key is reused; an id
 *   collision with a DIFFERENT key allocates "session-2", "session-3", ….
 * - Signer declarations no longer referenced by any rule are pruned.
 *
 * Precondition: `validateSessionDocDraft(draft).ok`. Throws when the current
 * doc is bound to a different network than the draft targets.
 */
export function upsertSessionRule(
  current: PolicyDoc | null,
  draft: SessionDocDraft,
  networkPassphrase: string,
): { doc: PolicyDoc; signerId: string } {
  const template = draftToDoc(draft, networkPassphrase);
  if (current === null) return { doc: template, signerId: template.signers[0].id };
  if (current.network !== undefined && current.network !== networkPassphrase) {
    throw new Error(
      `policy doc: the applied document is bound to "${current.network}" but this update targets "${networkPassphrase}"`,
    );
  }

  const newSigner = template.signers[0];
  const newKey = 'address' in newSigner ? `delegated:${newSigner.address}` : `external:${newSigner.verifier}:${newSigner.key}`;
  const keyOf = (s: (typeof current.signers)[number]) =>
    'address' in s ? `delegated:${s.address}` : `external:${s.verifier}:${s.key}`;

  const sameKey = current.signers.find((s) => keyOf(s) === newKey);
  let signerId: string;
  let signers: PolicyDoc['signers'];
  if (sameKey !== undefined) {
    signerId = sameKey.id;
    signers = [...current.signers];
  } else {
    const taken = new Set(current.signers.map((s) => s.id));
    signerId = newSigner.id;
    for (let n = 2; taken.has(signerId); n++) signerId = `${newSigner.id}-${n}`;
    signers = [...current.signers, { ...newSigner, id: signerId }];
  }

  const rule = {
    ...template.rules[0],
    principals: { type: 'all' as const, signers: [signerId] },
  };
  const rules = current.rules.some((r) => r.name === rule.name)
    ? current.rules.map((r) => (r.name === rule.name ? rule : r))
    : [...current.rules, rule];

  // Prune declarations no rule references any more (e.g. the sole signer of
  // a rule this upsert replaced).
  const referenced = new Set(
    rules.flatMap((r) => (r.principals.type === 'self-authenticating' ? [] : r.principals.signers)),
  );
  signers = signers.filter((s) => referenced.has(s.id));

  // Re-validate through the schema so a malformed merge fails closed here,
  // not at the compiler.
  const doc = parsePolicyDoc({
    ...current,
    network: networkPassphrase,
    signers,
    rules,
  });
  return { doc, signerId };
}

