// Pure parsing/validation of a dApp's scoped-session-key DOC request — the
// URL-param contract of /security/delegate-doc/ (the doc-based sibling of
// /security/delegate/). Kept pure so the param contract is unit-tested
// without a browser; the page does the RPC + handoff.
//
// Params: `origin` (dApp origin), `target` (C…), `signer` (the delegated
// session key, C… or G… — the dApp holds this key), optional `functions`
// (comma-separated), `duration` (24h|7d|30d|none), optional `limit` (decimal
// XLM) + `limit_period`, optional `label` (rule name), `return` (URL).

import { isContractAddress, isStellarAddress } from './policyDraft.js';
import { parseFunctionsInput } from './docDraft.js';
import { PERIOD_LEDGERS, stroopsFromXlm, type LimitPeriod } from '../spendingLimitParams.js';

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
  /** Requested cap in stroops (from the decimal-XLM `limit` param), or null.
   *  A malformed limit is treated as "no cap" — never block the flow on it. */
  limitStroops: string | null;
  limitPeriod: LimitPeriod;
  /** Rule name (doc rule + display), default "session". */
  label: string;
  returnUrl: string;
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
  if (!target || !isContractAddress(target)) {
    return { ok: false, error: 'Invalid target contract address.' };
  }
  if (!signer || !isStellarAddress(signer)) {
    return { ok: false, error: 'Invalid session signer (expected a C… or G… address).' };
  }
  if (!returnUrl) return { ok: false, error: 'Missing return URL.' };
  try {
    new URL(returnUrl);
  } catch {
    return { ok: false, error: 'Malformed return URL.' };
  }

  const functions = parseFunctionsInput(params.get('functions') ?? '');

  const durationParam = params.get('duration') ?? '30d';
  const duration = durationParam in DOC_DURATIONS ? durationParam : '30d';

  const limitParam = params.get('limit');
  let limitStroops: string | null = null;
  if (limitParam) {
    try {
      limitStroops = stroopsFromXlm(limitParam).toString();
    } catch {
      limitStroops = null;
    }
  }
  const periodParam = params.get('limit_period') ?? 'day';
  const limitPeriod: LimitPeriod =
    periodParam in PERIOD_LEDGERS ? (periodParam as LimitPeriod) : 'day';

  const label = (params.get('label') ?? '').trim() || 'session';

  return {
    ok: true,
    req: {
      origin,
      target,
      signer,
      functions,
      duration,
      limitStroops,
      limitPeriod,
      label,
      returnUrl,
    },
  };
}
