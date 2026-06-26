/**
 * Pure parsing + caching helpers for the redirect/return handover.
 *
 * The wallet hands control back to the dApp by redirecting to the `return`
 * URL with query params. These functions read those params off a query string
 * (so they're trivially unit-testable: pass `window.location.search`) and the
 * cache helpers persist the user's chosen C-address in the dApp origin's
 * localStorage. The address is non-secret — it's only an identifier — so
 * caching it at the dApp origin is fine.
 */

import { isContractId } from '@nidohq/passkey-sdk';

const ADDRESS_CACHE_KEY = 'nido:wallet-kit:address';

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ConnectReturn =
  | { status: 'ok'; address: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

/**
 * Read the result of a `/connect/` ceremony off a query string. Returns
 * `null` if the query carries none of the connect params (i.e. this wasn't a
 * return navigation from the picker).
 */
export function parseConnectReturn(search: string): ConnectReturn | null {
  const p = new URLSearchParams(search);
  const addr = p.get('nido_address');
  const connect = p.get('nido_connect');
  if (addr) {
    const upper = addr.toUpperCase();
    if (!isContractId(upper)) {
      return { status: 'error', error: `Returned address is not a contract id: ${addr}` };
    }
    return { status: 'ok', address: upper };
  }
  if (connect === 'cancelled') return { status: 'cancelled' };
  if (connect === 'error') {
    return { status: 'error', error: p.get('nido_error') ?? 'Unknown connect error' };
  }
  return null;
}

export type SignKind = 'tx' | 'message' | 'authEntry';

export type SignReturn =
  | { status: 'ok'; kind: SignKind; result: string }
  /**
   * The Nido relayer already submitted the transaction on-chain (model A:
   * smart-account path). `result` is the submitted transaction hash.
   * The dApp MUST NOT re-broadcast; use the hash directly to track the tx.
   */
  | { status: 'submitted'; kind: SignKind; result: string }
  | { status: 'cancelled' }
  | { status: 'switch-account' }
  | { status: 'error'; error: string };

/**
 * Read the result of a `/sign/` ceremony off a query string. `result` is the
 * signed XDR / message / auth-entry depending on `kind`. `switch-account`
 * means the user asked to sign with a different account — the sign page is
 * structurally bound to one account (WebAuthn rpId = its subdomain), so the
 * only way out is back through connect. Returns `null` if the query carries
 * none of the sign params.
 *
 * For smart-account transactions, the `/sign/` page may submit the tx via the
 * relayer and return `nido_submitted=<hash>&kind=tx` instead of
 * `nido_signed=<xdr>&kind=tx`. In that case `status` is `'submitted'` and
 * `result` is the transaction hash — the dApp must NOT re-broadcast.
 * The legacy `nido_signed` return is preserved for non-relayer paths.
 */
export function parseSignReturn(search: string): SignReturn | null {
  const p = new URLSearchParams(search);
  const signed = p.get('nido_signed');
  const submitted = p.get('nido_submitted');
  const sign = p.get('nido_sign');
  if (signed) {
    const kind = (p.get('kind') as SignKind) ?? 'tx';
    return { status: 'ok', kind, result: signed };
  }
  if (submitted) {
    const kind = (p.get('kind') as SignKind) ?? 'tx';
    return { status: 'submitted', kind, result: submitted };
  }
  if (sign === 'cancelled') return { status: 'cancelled' };
  if (sign === 'switch-account') return { status: 'switch-account' };
  if (sign === 'error') {
    return { status: 'error', error: p.get('nido_error') ?? 'Unknown signing error' };
  }
  return null;
}

/**
 * Load the C-address the user last selected for this dApp origin, or `null`.
 */
export function loadCachedAddress(): string | null {
  const v = localStorage.getItem(ADDRESS_CACHE_KEY);
  return v && isContractId(v) ? v : null;
}

/** Cache the user's selected C-address at this dApp origin. */
export function saveCachedAddress(address: string): void {
  if (!isContractId(address)) {
    throw new Error(`saveCachedAddress: not a contract id: ${address}`);
  }
  localStorage.setItem(ADDRESS_CACHE_KEY, address);
}

/** Forget the cached address (e.g. on an explicit disconnect). */
export function clearCachedAddress(): void {
  localStorage.removeItem(ADDRESS_CACHE_KEY);
}
