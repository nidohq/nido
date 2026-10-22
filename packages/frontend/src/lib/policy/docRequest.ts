// Pure parsing/validation of a dApp's scoped-session-key DOC request — the
// URL-param contract of /security/delegate-doc/ (the doc-based sibling of
// /security/delegate/). Kept pure so the param contract is unit-tested
// without a browser; the page does the RPC + handoff.
//
// Params: `origin` (dApp origin), `target` (C…), `signer` (the delegated
// session key, C… or G… — the dApp holds this key), optional `functions`
// (comma-separated), `duration` (24h|7d|30d|none, default 30d), optional
// `limit` (decimal XLM) + `limit_period` (day|week|30d, default day, only
// alongside `limit`), optional `label` (rule name), `return` (URL).
//
// An optional param is either absent (its default applies) or valid: a
// present-but-malformed `duration`, `limit` or `limit_period` rejects the
// whole request, so a bad cap can never degrade into an uncapped grant.

import { canonicalJson, type PolicyDoc } from '@nidohq/passkey-sdk';
import { isContractAddress, isStellarAddress } from './policyDraft.js';
import { parseFunctionsInput, upsertSessionRule, type SessionDocDraft } from './docDraft.js';
import { PERIOD_LABEL, PERIOD_LEDGERS, stroopsFromXlm, type LimitPeriod } from '../spendingLimitParams.js';
import { stroopsToXlm } from '../money.js';
import { httpOrigin, validateDappReturn, type OperationDescriptor } from '../signing/signRequest.js';

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

export interface DocDelegateRequest {
  origin: string;
  target: string;
  /** The delegated session signer the dApp holds (C… or G…). */
  signer: string;
  /** Allowed function names; undefined = any function. */
  functions: string[] | undefined;
  /** Requested duration key (validated against DOC_DURATIONS). */
  duration: keyof typeof DOC_DURATIONS;
  /** The requested spending cap, or null when the request carries no
   *  `limit` param. Null is only a suggestion: the page still makes the user
   *  explicitly choose an uncapped grant. */
  cap: DocDelegateCap | null;
  /** Rule name (doc rule + display), default "session". */
  label: string;
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

export function parseDocDelegateParams(params: URLSearchParams): DocDelegateParse {
  const origin = params.get('origin') ?? '';
  const target = params.get('target') ?? '';
  const signer = params.get('signer') ?? '';
  const returnUrl = params.get('return') ?? '';

  if (!origin) return { ok: false, error: 'Missing origin parameter.' };
  // Reject javascript:/data:/opaque-origin values here (a bare `new URL().origin`
  // returns "null" for them, which later compares equal to an `origin=null`
  // param in the page's backToDapp sink).
  const normalizedOrigin = httpOrigin(origin);
  if (!normalizedOrigin) return { ok: false, error: 'Malformed origin parameter.' };
  if (!target || !isContractAddress(target)) {
    return { ok: false, error: 'Invalid target contract address.' };
  }
  if (!signer || !isStellarAddress(signer)) {
    return { ok: false, error: 'Invalid session signer (expected a C… or G… address).' };
  }
  if (!returnUrl) return { ok: false, error: 'Missing return URL.' };
  // Return URL must be a same-origin http(s) URL of the (normalized) request
  // origin — never a javascript:/data: callback.
  const check = validateDappReturn(normalizedOrigin, returnUrl);
  if ('error' in check) {
    return { ok: false, error: 'Return URL origin does not match request origin.' };
  }

  const functions = parseFunctionsInput(params.get('functions') ?? '');

  const duration = params.get('duration') ?? '30d';
  if (!Object.hasOwn(DOC_DURATIONS, duration)) {
    return {
      ok: false,
      error: `Invalid duration "${duration}" (expected 24h, 7d, 30d or none).`,
    };
  }

  const limitParam = params.get('limit');
  const periodParam = params.get('limit_period');
  let cap: DocDelegateCap | null = null;
  if (limitParam === null) {
    if (periodParam !== null) {
      return { ok: false, error: 'limit_period was given without a limit.' };
    }
  } else {
    let stroops: bigint;
    try {
      stroops = stroopsFromXlm(limitParam);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const period = periodParam ?? 'day';
    if (!Object.hasOwn(PERIOD_LEDGERS, period)) {
      return {
        ok: false,
        error: `Invalid limit_period "${period}" (expected day, week or 30d).`,
      };
    }
    cap = { stroops: stroops.toString(), period: period as LimitPeriod };
  }

  const label = (params.get('label') ?? '').trim() || 'session';

  return {
    ok: true,
    req: {
      origin: normalizedOrigin,
      target,
      signer,
      functions,
      duration,
      cap,
      label,
      returnUrl,
    },
  };
}

/**
 * The effective scope of a session grant as the user will approve it, one
 * line per dimension, so the uncapped and never-expiring cases are stated
 * as plainly as the bounded ones.
 */
export function describeSessionScope(scope: {
  target: string;
  functions: string[] | undefined;
  cap: DocDelegateCap | null;
  duration: string;
  /** The anchored expiry ledger; null for "none" or before the ledger read. */
  notAfterLedger: number | null;
}): { functions: string; amount: string; expiry: string } {
  const functions = scope.functions
    ? `Only ${scope.functions.join(', ')} on ${scope.target}`
    : `Any function on ${scope.target}`;
  const amount = scope.cap
    ? `Up to ${stroopsToXlm(BigInt(scope.cap.stroops))} XLM ${PERIOD_LABEL[scope.cap.period]}`
    : 'No spending cap';
  const span = DOC_DURATION_LABEL[scope.duration];
  const expiry =
    DOC_DURATIONS[scope.duration] == null
      ? 'Never (until revoked)'
      : scope.notAfterLedger == null
        ? `After ${span}`
        : `At ledger ${scope.notAfterLedger.toLocaleString('en-US')} (≈ ${span})`;
  return { functions, amount, expiry };
}

/**
 * The ONE way a session grant becomes a signable operation: upsert the
 * session rule into the loaded baseline and wrap the merged document in an
 * `apply-policy-doc` descriptor. Every policy write is an `apply_doc` — a
 * grant flow must never emit `add_context_rule` (the doc-only contract
 * hard-refuses it outside the recovery-completion window). Both delegate
 * pages (passkey and delegated-key requests) build their /sign/ handoff
 * through this helper, so the invariant is testable in one place.
 *
 * Precondition: `validateSessionDocDraft(draft, limits).ok` and a loaded baseline
 * (the applied doc, or the owner-admin baseline on a first apply).
 */
export function buildSessionGrantOperation(args: {
  baseline: PolicyDoc;
  /** The configuration revision `baseline` was read at. */
  baselineRevision: bigint;
  /** True when nothing is applied yet — no prevDocJson (all-new diff). */
  isFirstApply: boolean;
  draft: SessionDocDraft;
  networkPassphrase: string;
  /** Human-readable expiry label (e.g. "24 hours"). */
  expiryLabel: string;
}): Extract<OperationDescriptor, { type: 'apply-policy-doc' }> {
  const { doc } = upsertSessionRule(args.baseline, args.draft, args.networkPassphrase);
  return {
    type: 'apply-policy-doc',
    docJson: canonicalJson(doc),
    ...(args.isFirstApply ? {} : { prevDocJson: canonicalJson(args.baseline) }),
    expectedRevision: args.baselineRevision.toString(),
    expiryLabel: args.expiryLabel,
  };
}
