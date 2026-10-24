// Pure parsing/validation of a dApp's scoped-session-key DOC request — the
// URL-param contract of /security/delegate-doc/ (the doc-based sibling of
// /security/delegate/). Kept pure so the param contract is unit-tested
// without a browser; the page does the RPC + handoff.
//
// Every request names one app key, one duration and one return trip:
//
//   origin         the dApp origin (http(s))
//   return         where to send the user back; same origin as `origin`
//   duration       24h|7d|30d|none, default 30d; every grant shares it
//   signer         the app's delegated key, C… or G…        ┐ exactly
//   pubkey         the app's passkey: the 65-byte SEC1       │ one of
//                  uncompressed P-256 key, hex (04…)         ┘ the two
//
// A passkey is named by its public key alone. Perch's doc compiler accepts
// a signer key only in its verifier-canonical form, and the WebAuthn
// verifier's is the bare 65-byte key: a credential-id suffix is refused
// (KeyNotCanonicalizable), so a request carrying `credential_id` is
// rejected. The app keeps its credential id for its own WebAuthn calls.
//
// and asks for one or more grants. A grant is one rule: the app key may
// call `target` (C…), only `functions` (comma-separated; absent = any),
// optionally spend-capped. `limit` is a decimal XLM cap with `limit_period`
// (day|week|30d, default day), or `none`: the app declares the rule
// uncapped, as a rule that only makes calls must be (a cap allows token
// transfers only, so it would block every other call). Without `limit` the
// user chooses between a cap and an explicit uncapped grant. `limit=none`
// spares the user that choice only when the rule allows no token function:
// its `functions` list is given and names none of TOKEN_MOVING_FUNCTIONS
// (limitNoneHonoured). Otherwise the grant is shown as one without `limit`.
//
// `to` (a G… or C… address) restricts whom a grant's `transfer` may pay:
// the rule carries an `address-eq` on transfer's argument 1, so the key can
// pay only that address (a muxed M… recipient fails closed on chain). It is
// accepted only on a grant whose functions are exactly `transfer`. A
// transfer grant without `to` can pay any address, up to its cap.
//
// One grant (the original format): `target`, `functions`, `limit`,
// `limit_period`, `to`, and `label` (the rule name, default "session").
//
// Several grants, installed by one approval as one document update: the
// same fields per grant as `grant.<i>.<field>`, for i = 0…n-1 (at most
// MAX_DOC_GRANTS). Each grant needs its own `label`, and the single-grant
// params may not appear alongside. For a game whose `guess` moves a 1 XLM
// stake from the player:
//
//   ?origin=https://game.example&return=https://game.example/play
//   &pubkey=04…&duration=24h
//   &grant.0.label=guess&grant.0.target=CGAME…&grant.0.functions=guess
//   &grant.0.limit=none
//   &grant.1.label=guess-xlm&grant.1.target=CXLM…&grant.1.functions=transfer
//   &grant.1.limit=2&grant.1.limit_period=day&grant.1.to=CGAME…
//
// An optional param is either absent (its default applies) or valid: a
// present-but-malformed `duration`, `limit`, `limit_period` or unknown
// `grant.*` field rejects the whole request, so a bad cap can never degrade
// into an uncapped grant.

import { canonicalJson, type PolicyDoc } from '@nidohq/passkey-sdk';
import { isContractAddress, isStellarAddress } from './policyDraft.js';
import {
  parseFunctionsInput,
  upsertSessionRules,
  type SessionDocDraft,
  type SessionSignerDraft,
} from './docDraft.js';
import { PERIOD_LEDGERS, stroopsFromXlm, type LimitPeriod } from '../spendingLimitParams.js';
import { httpOrigin, validateDappReturn, type OperationDescriptor } from '../signing/signRequest.js';
import { NO_CAP_NO_TOKEN_FUNCTIONS, NO_SPENDING_CAP, canMoveTokens } from './tokenFunctions.js';
import { canTransfer, capText } from './reviewText.js';

export const DOC_DURATIONS: Record<string, number | null> = {
  '24h': 17280,
  '7d': 17280 * 7,
  '30d': 17280 * 30,
  none: null,
};

export const DOC_DURATION_LABEL: Record<string, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
  none: 'Until revoked',
};

/** The most grants one request may carry. */
export const MAX_DOC_GRANTS = 8;

/** The app's session key, as the request names it. */
export type DocDelegateSigner =
  /** A delegated key the dApp holds (C… or G…). */
  | { kind: 'delegated'; address: string }
  /** A passkey: its 65-byte SEC1 public key (hex, lowercased). */
  | { kind: 'passkey'; publicKeyHex: string };

export interface DocDelegateGrant {
  target: string;
  /** Allowed function names; undefined = any function. */
  functions: string[] | undefined;
  /** The requested spending cap; `'none'` when the app declared the rule
   *  uncapped (`limit=none`); null when the request carries no `limit`. Null,
   *  and `'none'` unless limitNoneHonoured, is only a suggestion: the page
   *  still makes the user explicitly choose an uncapped grant. */
  cap: DocDelegateCap | 'none' | null;
  /** Rule name (doc rule + display). */
  label: string;
  /** The only address the grant's `transfer` may pay; absent = any. */
  to?: string;
}

export { TOKEN_MOVING_FUNCTIONS } from './tokenFunctions.js';

/** Whether the grant's `limit=none` skips the user's uncapped confirmation:
 *  only for a rule limited to functions none of which moves tokens. */
export function limitNoneHonoured(grant: Pick<DocDelegateGrant, 'cap' | 'functions'>): boolean {
  return grant.cap === 'none' && !canMoveTokens(grant.functions);
}

export interface DocDelegateRequest {
  origin: string;
  signer: DocDelegateSigner;
  /** Requested duration key (validated against DOC_DURATIONS). */
  duration: keyof typeof DOC_DURATIONS;
  /** One or more grants, each its own rule; their labels are distinct. */
  grants: DocDelegateGrant[];
  returnUrl: string;
}

export interface DocDelegateCap {
  /** Cap in stroops (from the decimal-XLM `limit` param). */
  stroops: string;
  period: LimitPeriod;
}

export type DocDelegateParse =
  | { ok: true; req: DocDelegateRequest }
  | { ok: false; error: string };

const GRANT_FIELDS = ['target', 'functions', 'label', 'limit', 'limit_period', 'to'] as const;
type GrantField = (typeof GRANT_FIELDS)[number];

export function parseDocDelegateParams(params: URLSearchParams): DocDelegateParse {
  const origin = params.get('origin') ?? '';
  const returnUrl = params.get('return') ?? '';

  if (!origin) return { ok: false, error: 'Missing origin parameter.' };
  // Reject javascript:/data:/opaque-origin values here (a bare `new URL().origin`
  // returns "null" for them, which later compares equal to an `origin=null`
  // param in the page's backToDapp sink).
  const normalizedOrigin = httpOrigin(origin);
  if (!normalizedOrigin) return { ok: false, error: 'Malformed origin parameter.' };

  const multi = [...params.keys()].some((k) => k.startsWith('grant.'));
  // The single-grant format checks its target first, as it always has.
  if (!multi) {
    const target = params.get('target') ?? '';
    if (!target || !isContractAddress(target)) {
      return { ok: false, error: 'Invalid target contract address.' };
    }
  }

  const signer = parseSigner(params);
  if ('error' in signer) return { ok: false, error: signer.error };

  if (!returnUrl) return { ok: false, error: 'Missing return URL.' };
  // Return URL must be a same-origin http(s) URL of the (normalized) request
  // origin — never a javascript:/data: callback.
  const check = validateDappReturn(normalizedOrigin, returnUrl);
  if ('error' in check) {
    return { ok: false, error: 'Return URL origin does not match request origin.' };
  }

  const duration = params.get('duration') ?? '30d';
  if (!Object.hasOwn(DOC_DURATIONS, duration)) {
    return {
      ok: false,
      error: `Invalid duration "${duration}" (expected 24h, 7d, 30d or none).`,
    };
  }

  const grants = multi ? parseGrantList(params) : parseGrant((f) => params.get(f), '', 'session');
  if ('error' in grants) return { ok: false, error: grants.error };

  return {
    ok: true,
    req: {
      origin: normalizedOrigin,
      signer: signer.signer,
      duration,
      grants: Array.isArray(grants) ? grants : [grants.grant],
      returnUrl,
    },
  };
}

function parseSigner(params: URLSearchParams): { signer: DocDelegateSigner } | { error: string } {
  const signer = params.get('signer');
  const pubkey = params.get('pubkey');
  if (params.has('credential_id')) {
    return {
      error:
        'credential_id is not part of the request: a passkey signer is its 65-byte public key alone (Perch refuses a key with a credential id appended). Keep the credential id in the app.',
    };
  }
  if (signer !== null && pubkey !== null) {
    return { error: 'Name the session signer once: signer= or pubkey=, not both.' };
  }
  if (pubkey !== null) {
    if (!/^04[0-9a-fA-F]{128}$/.test(pubkey)) {
      return {
        error:
          'Invalid session public key (expected the 65-byte SEC1 uncompressed P-256 key as 130 hex characters starting 04, with no 0x).',
      };
    }
    return { signer: { kind: 'passkey', publicKeyHex: pubkey.toLowerCase() } };
  }
  if (!signer || !isStellarAddress(signer)) {
    return {
      error: 'Invalid session signer (expected a C… or G… address as signer=, or a passkey as pubkey=).',
    };
  }
  return { signer: { kind: 'delegated', address: signer } };
}

/** The `grant.<i>.<field>` params as grants, in index order. */
function parseGrantList(params: URLSearchParams): DocDelegateGrant[] | { error: string } {
  const stray = GRANT_FIELDS.filter((f) => params.has(f));
  if (stray.length > 0) {
    return {
      error: `Pass grants either as grant.<i>.* or as one target/functions/label/limit, not both (found ${stray.join(', ')}).`,
    };
  }
  const indexes = new Set<number>();
  for (const key of new Set(params.keys())) {
    if (!key.startsWith('grant.')) continue;
    const m = /^grant\.(0|[1-9][0-9]*)\.([a-z_]+)$/.exec(key);
    if (!m || !(GRANT_FIELDS as readonly string[]).includes(m[2]!)) {
      return { error: `Unknown grant parameter "${key}".` };
    }
    if (params.getAll(key).length > 1) return { error: `${key} is given more than once.` };
    indexes.add(Number(m[1]));
  }
  if (Math.max(...indexes) >= MAX_DOC_GRANTS) {
    return { error: `A request carries at most ${MAX_DOC_GRANTS} grants.` };
  }
  const grants: DocDelegateGrant[] = [];
  for (let i = 0; i < indexes.size; i++) {
    if (!indexes.has(i)) return { error: `grant.${i} is missing: number grants 0, 1, 2, … with no gaps.` };
    const parsed = parseGrant((f) => params.get(`grant.${i}.${f}`), `grant.${i}: `, null);
    if ('error' in parsed) return parsed;
    if (grants.some((g) => g.label === parsed.grant.label)) {
      return { error: `Two grants name the rule "${parsed.grant.label}": each grant needs its own label.` };
    }
    grants.push(parsed.grant);
  }
  return grants;
}

/** One grant's fields. `where` prefixes each error; `defaultLabel` names an
 *  unlabelled grant, or null when the label is required. */
function parseGrant(
  get: (field: GrantField) => string | null,
  where: string,
  defaultLabel: string | null,
): { grant: DocDelegateGrant } | { error: string } {
  const target = get('target') ?? '';
  if (!target || !isContractAddress(target)) {
    return { error: `${where}Invalid target contract address.` };
  }

  const functions = parseFunctionsInput(get('functions') ?? '');

  const limitParam = get('limit');
  const periodParam = get('limit_period');
  let cap: DocDelegateGrant['cap'] = null;
  if (limitParam === null) {
    if (periodParam !== null) return { error: `${where}limit_period was given without a limit.` };
  } else if (limitParam === 'none') {
    if (periodParam !== null) return { error: `${where}limit_period was given with limit=none.` };
    cap = 'none';
  } else {
    let stroops: bigint;
    try {
      stroops = stroopsFromXlm(limitParam);
    } catch (e) {
      return { error: `${where}${e instanceof Error ? e.message : String(e)}` };
    }
    const period = periodParam ?? 'day';
    if (!Object.hasOwn(PERIOD_LEDGERS, period)) {
      return { error: `${where}Invalid limit_period "${period}" (expected day, week or 30d).` };
    }
    cap = { stroops: stroops.toString(), period: period as LimitPeriod };
  }

  const to = get('to');
  if (to !== null) {
    if (!isStellarAddress(to)) return { error: `${where}Invalid to address (expected a C… or G… address).` };
    if (functions?.length !== 1 || functions[0] !== 'transfer') {
      return { error: `${where}to= restricts whom transfer pays, so the grant's functions must be exactly transfer.` };
    }
  }

  const label = (get('label') ?? '').trim() || defaultLabel;
  if (label === null) return { error: `${where}A label is required (each grant is its own rule).` };

  return { grant: { target, functions, cap, label, ...(to !== null ? { to } : {}) } };
}

/**
 * The request's signer as a doc-draft signer. A passkey is declared against
 * `verifier` (the WebAuthn verifier the account trusts), its key the bare
 * public key (the verifier-canonical form Perch's compiler requires); null
 * until that verifier is known.
 */
export function sessionSignerDraft(
  signer: DocDelegateSigner,
  verifier: string | null,
): SessionSignerDraft | null {
  if (signer.kind === 'delegated') return { kind: 'delegated', address: signer.address };
  if (verifier === null) return null;
  return { kind: 'passkey', verifier, publicKeyHex: signer.publicKeyHex };
}

/**
 * The effective spend, payee and lifetime of a session grant as the user
 * will approve it, so the uncapped, pay-anyone and never-expiring cases are
 * stated as plainly as the bounded ones. An uncapped rule that allows a
 * token function is `warn`; one that allows none says no cap applies.
 * `recipient` says whom a rule that may call `transfer` can pay (null when
 * it cannot). (The page lists the functions itself, each shown as a method.)
 */
export function describeSessionScope(scope: {
  cap: DocDelegateCap | null;
  /** The rule's functions (undefined = any). */
  functions: string[] | undefined;
  /** The only address its `transfer` may pay (the request's `to`). */
  to?: string;
  duration: string;
  /** The anchored expiry ledger; null for "none" or before the ledger read. */
  notAfterLedger: number | null;
}): { amount: string; warn: boolean; recipient: string | null; expiry: string } {
  const warn = scope.cap === null && canMoveTokens(scope.functions);
  const amount = scope.cap
    ? capText(scope.cap.stroops, PERIOD_LEDGERS[scope.cap.period])
    : warn
      ? NO_SPENDING_CAP
      : NO_CAP_NO_TOKEN_FUNCTIONS;
  const recipient =
    scope.to !== undefined ? `only to ${scope.to}` : canTransfer(scope.functions) ? 'to any address' : null;
  const span = DOC_DURATION_LABEL[scope.duration];
  const expiry =
    DOC_DURATIONS[scope.duration] == null
      ? 'Never (until revoked)'
      : scope.notAfterLedger == null
        ? `After ${span}`
        : `At ledger ${scope.notAfterLedger.toLocaleString('en-US')} (≈ ${span})`;
  return { amount, warn, recipient, expiry };
}

/**
 * The ONE way a session grant becomes a signable operation: upsert the
 * session rules into the loaded baseline and wrap the merged document in an
 * `apply-policy-doc` descriptor. Every policy write is an `apply_doc` — a
 * grant flow must never emit `add_context_rule` (the doc-only contract
 * hard-refuses it outside the recovery-completion window). Both delegate
 * pages (passkey and delegated-key requests) build their /sign/ handoff
 * through this helper, so the invariant is testable in one place. Several
 * grants are one document update, so one approval installs them all.
 *
 * Precondition: `validateSessionDocDraft(draft, limits).ok` for each draft,
 * distinct draft names, and a loaded baseline (the applied doc, or the
 * owner-admin baseline on a first apply).
 */
export function buildSessionGrantOperation(args: {
  baseline: PolicyDoc;
  /** The configuration revision `baseline` was read at. */
  baselineRevision: bigint;
  /** True when nothing is applied yet — no prevDocJson (all-new diff). */
  isFirstApply: boolean;
  drafts: readonly SessionDocDraft[];
  networkPassphrase: string;
  /** Human-readable expiry label (e.g. "24 hours"). */
  expiryLabel: string;
}): Extract<OperationDescriptor, { type: 'apply-policy-doc' }> {
  const doc = upsertSessionRules(args.baseline, args.drafts, args.networkPassphrase);
  return {
    type: 'apply-policy-doc',
    docJson: canonicalJson(doc),
    ...(args.isFirstApply ? {} : { prevDocJson: canonicalJson(args.baseline) }),
    expectedRevision: args.baselineRevision.toString(),
    expiryLabel: args.expiryLabel,
  };
}
