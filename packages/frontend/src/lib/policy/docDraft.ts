// Pure validation + document construction for the policy builder's DOC mode
// (sibling of policyDraft.ts, which backs the raw add_context_rule mode).
//
// Doc mode emits a perch PolicyDoc — for the showcase, the canned v1
// template: one scoped session key (a delegated signer restricted to one
// contract's named functions, with an expiry) optionally composed with a
// cumulative spending cap. The pure layer validates the form draft, builds
// the document via the SDK, and decides which apply route the transaction
// takes; the component does the RPC + signing.

import { buildPolicyDoc, parsePolicyDoc, scopedSessionKeyDoc, type PolicyDoc } from '@nidohq/passkey-sdk';
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

/** The account's primary passkey, as read off its live auth rule (the
 *  constructor default rule before the first apply; the doc's own admin
 *  rule afterwards — but then the applied doc IS the baseline and this is
 *  not needed). */
export interface OwnerPasskey {
  /** WebAuthn verifier contract the account trusts. */
  verifier: string;
  /** SEC1 uncompressed P-256 public key, hex. */
  publicKeyHex: string;
}

/**
 * The FIRST-APPLY baseline: a document holding only the anti-brick admin
 * rule — the account's own passkey with policy-free self-admin authority.
 * `apply_doc` replaces EVERY rule (the constructor's default passkey rule
 * included) and refuses documents without a policy-free self-admin rule
 * (`DocAdminLockout`), so a first apply must never submit a session rule
 * alone: it upserts into this baseline instead.
 */
export function ownerAdminBaseline(owner: OwnerPasskey, networkPassphrase: string): PolicyDoc {
  return buildPolicyDoc({
    network: networkPassphrase,
    signers: [
      { id: 'owner', kind: 'passkey', verifier: owner.verifier, publicKey: owner.publicKeyHex },
    ],
    permissions: [{ name: 'admin', on: 'self-admin', by: ['owner'] }],
  });
}

/**
 * Upsert the template's session rule into `base` — the account's currently
 * applied document, or {@link ownerAdminBaseline} on a first apply.
 * `apply_doc` is a whole-document write: it REPLACES the applied set, so an
 * update must carry the base document forward with the new rule merged in
 * (and a base is REQUIRED — a standalone session doc would trip the
 * contract's `DocAdminLockout` anti-brick check).
 *
 * - Same rule name exists → the new rule replaces it (a "modified" rule in
 *   the diff).
 * - Signer reuse: an existing declaration for the SAME key is reused; an id
 *   collision with a DIFFERENT key allocates "session-2", "session-3", ….
 * - Signer declarations no longer referenced by any rule are pruned.
 *
 * Precondition: `validateSessionDocDraft(draft).ok`. Throws when the base
 * doc is bound to a different network than the draft targets.
 */
export function upsertSessionRule(
  current: PolicyDoc,
  draft: SessionDocDraft,
  networkPassphrase: string,
): { doc: PolicyDoc; signerId: string } {
  const template = draftToDoc(draft, networkPassphrase);
  assertSameNetwork(current, networkPassphrase);

  const { signers: merged, signerId } = mergeSignerDecl(current.signers, template.signers[0]);
  const rule = {
    ...template.rules[0],
    principals: { type: 'all' as const, signers: [signerId] },
  };
  const rules = current.rules.some((r) => r.name === rule.name)
    ? current.rules.map((r) => (r.name === rule.name ? rule : r))
    : [...current.rules, rule];

  return { doc: rebuildDoc(current, merged, rules, networkPassphrase), signerId };
}

// --- Shared doc-merge helpers ----------------------------------------------

type WireSigner = PolicyDoc['signers'][number];
type WireRule = PolicyDoc['rules'][number];

function assertSameNetwork(doc: PolicyDoc, networkPassphrase: string): void {
  if (doc.network !== undefined && doc.network !== networkPassphrase) {
    throw new Error(
      `policy doc: the applied document is bound to "${doc.network}" but this update targets "${networkPassphrase}"`,
    );
  }
}

/** Structural identity of a signer declaration (id excluded). */
function signerKeyOf(s: WireSigner): string {
  return 'address' in s ? `delegated:${s.address}` : `external:${s.verifier}:${s.key}`;
}

/** Merge one declaration into a signer list: reuse an existing declaration
 *  for the SAME key; on an id collision with a DIFFERENT key allocate
 *  "<id>-2", "<id>-3", …. */
function mergeSignerDecl(
  signers: readonly WireSigner[],
  decl: WireSigner,
): { signers: WireSigner[]; signerId: string } {
  const sameKey = signers.find((s) => signerKeyOf(s) === signerKeyOf(decl));
  if (sameKey !== undefined) return { signers: [...signers], signerId: sameKey.id };
  const taken = new Set(signers.map((s) => s.id));
  let signerId = decl.id;
  for (let n = 2; taken.has(signerId); n++) signerId = `${decl.id}-${n}`;
  return { signers: [...signers, { ...decl, id: signerId }], signerId };
}

/** Drop declarations no rule references, then re-validate through the
 *  schema so a malformed merge fails closed here, not at the compiler. */
function rebuildDoc(
  base: PolicyDoc,
  signers: readonly WireSigner[],
  rules: readonly WireRule[],
  networkPassphrase: string,
): PolicyDoc {
  const referenced = new Set(
    rules.flatMap((r) => (r.principals.type === 'self-authenticating' ? [] : r.principals.signers)),
  );
  return parsePolicyDoc({
    ...base,
    network: networkPassphrase,
    signers: signers.filter((s) => referenced.has(s.id)),
    rules,
  });
}

// --- Admin keys -------------------------------------------------------------

/** An ADMIN rule is the anti-brick shape: policy-free, cap-free self-admin
 *  authority (bare `all` principals, no functions, no args, no cap, no
 *  expiry — full account authority for its signer). */
export function isAdminRule(rule: WireRule): boolean {
  return (
    rule.scope.type === 'self-admin' &&
    rule.principals.type === 'all' &&
    rule.functions === undefined &&
    rule.args === undefined &&
    rule.cap === undefined &&
    rule['not-after-ledger'] === undefined
  );
}

/** The document's admin rules, in doc order. */
export function adminRules(doc: PolicyDoc): WireRule[] {
  return doc.rules.filter(isAdminRule);
}

/** Next free "admin-N" rule name for the add form's default. */
export function nextAdminRuleName(doc: PolicyDoc): string {
  const taken = new Set(doc.rules.map((r) => r.name));
  if (!taken.has('admin')) return 'admin';
  for (let n = 2; ; n++) {
    if (!taken.has(`admin-${n}`)) return `admin-${n}`;
  }
}

/** The new admin signer: a passkey (WebAuthn ceremony or pasted key) or a
 *  delegated address. */
export interface AdminKeyDraft {
  /** Rule name for the new admin rule. */
  name: string;
  signer:
    | { kind: 'passkey'; verifier: string; publicKeyHex: string }
    | { kind: 'delegated'; address: string };
}

export function validateAdminKeyDraft(draft: AdminKeyDraft, base: PolicyDoc): DocValidationResult {
  const errors: string[] = [];

  const name = draft.name.trim();
  if (name.length === 0) errors.push('Give the admin rule a name.');
  else if (new TextEncoder().encode(name).length > MAX_RULE_NAME_LEN) {
    errors.push(`Name must be at most ${MAX_RULE_NAME_LEN} bytes.`);
  } else if (base.rules.some((r) => r.name === name)) {
    // Never silently REPLACE an existing rule from the admin form — a
    // colliding name must be an explicit error, not a surprise overwrite.
    errors.push(`The document already has a rule named "${name}" — pick another name.`);
  }

  if (draft.signer.kind === 'delegated') {
    if (!isStellarAddress(draft.signer.address.trim())) {
      errors.push('Admin key is not a valid C- or G-address.');
    }
  } else {
    if (!isContractAddress(draft.signer.verifier.trim())) {
      errors.push('Verifier is not a valid C-address.');
    }
    if (!/^[0-9a-fA-F]{2,512}$/.test(draft.signer.publicKeyHex.trim()) || draft.signer.publicKeyHex.trim().length % 2 !== 0) {
      errors.push('Public key is not valid hex.');
    }
  }

  // Refuse enrolling a key that already holds admin authority.
  if (errors.length === 0) {
    const decl = adminDraftToDecl(draft, 'probe');
    const existing = base.signers.find((s) => signerKeyOf(s) === signerKeyOf(decl));
    if (
      existing !== undefined &&
      adminRules(base).some(
        (r) => r.principals.type !== 'self-authenticating' && r.principals.signers.includes(existing.id),
      )
    ) {
      errors.push('This key is already an admin on the account.');
    }
  }

  return { ok: errors.length === 0, errors };
}

function adminDraftToDecl(draft: AdminKeyDraft, id: string): WireSigner {
  return draft.signer.kind === 'delegated'
    ? { id, address: draft.signer.address.trim() }
    : {
        id,
        verifier: draft.signer.verifier.trim(),
        key: draft.signer.publicKeyHex.trim().toLowerCase(),
      };
}

/**
 * Add an admin key: the signer declaration plus its own policy-free
 * self-admin rule (each admin key gets its OWN rule — `all` principals are
 * N-of-N, so sharing one rule would require both keys to co-sign).
 * Precondition: `validateAdminKeyDraft(draft, base).ok`.
 */
export function addAdminKey(
  base: PolicyDoc,
  draft: AdminKeyDraft,
  networkPassphrase: string,
): { doc: PolicyDoc; signerId: string } {
  assertSameNetwork(base, networkPassphrase);
  const { signers, signerId } = mergeSignerDecl(base.signers, adminDraftToDecl(draft, 'admin'));
  const rule: WireRule = {
    name: draft.name.trim(),
    scope: { type: 'self-admin' },
    principals: { type: 'all', signers: [signerId] },
  };
  return {
    doc: rebuildDoc(base, signers, [...base.rules, rule], networkPassphrase),
    signerId,
  };
}

/**
 * Remove an admin rule (and prune its signer if nothing else references
 * it). Refuses to remove the LAST admin rule — the contract's
 * `DocAdminLockout` anti-brick check would reject the document anyway, so
 * the refusal surfaces here with a human-readable reason instead of a
 * failed simulation.
 */
export function removeAdminRule(
  base: PolicyDoc,
  ruleName: string,
  networkPassphrase: string,
): PolicyDoc {
  assertSameNetwork(base, networkPassphrase);
  const target = base.rules.find((r) => r.name === ruleName);
  if (target === undefined) {
    throw new Error(`policy doc: no rule named "${ruleName}"`);
  }
  if (!isAdminRule(target)) {
    throw new Error(`policy doc: rule "${ruleName}" is not an admin rule`);
  }
  if (adminRules(base).length <= 1) {
    throw new Error(
      'policy doc: cannot remove the last admin key — the account would have no admin authority (the contract refuses such documents)',
    );
  }
  return rebuildDoc(
    base,
    base.signers,
    base.rules.filter((r) => r.name !== ruleName),
    networkPassphrase,
  );
}

