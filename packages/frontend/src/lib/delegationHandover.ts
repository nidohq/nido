/**
 * dApp-side delegation flow.
 *
 * Design: the dApp creates a fresh WebAuthn passkey at its own origin to act
 * as the session key, persists its (credentialId, publicKey) via
 * `saveSessionKeyMaterial`, and redirects the user to the wallet. The wallet
 * receives only the *public* key (hex) in the URL, builds the install
 * transaction, gets the user's primary-passkey signature, submits, and
 * redirects back. The private key never leaves the authenticator — XSS at
 * the dApp origin cannot exfiltrate it.
 *
 * Replaces the earlier flows: (a) wallet generates the key and posts private
 * bytes back via postMessage; (b) dApp generates an in-memory P-256 key and
 * stores private bytes in localStorage. Both required raw-key handling; this
 * one doesn't.
 */

import { createSessionPasskey, saveSessionKeyMaterial, buf2hex } from '@nidohq/passkey-sdk';

// ---------------------------------------------------------------------------
// Pending-delegation persistence.
//
// `startDelegation` does a full-page redirect to the wallet; the wallet sends
// the user back with ONLY `?delegation=ok|cancelled`. Per its
// anti-redirect-abuse policy the wallet REPLACES the dApp's returnUrl query
// string (`url.search = qs`), so we can't smuggle the account/target back
// through the URL. Persist the request locally before leaving and read it back
// on return, so the dApp knows which account+contract the round-trip was for
// (and can locate the session-key material it saved, which is keyed by them).
// ---------------------------------------------------------------------------

const PENDING_KEY = 'nido:pendingDelegation';

/** Minimal Storage shape so the store is testable with a fake. */
export type DelegationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): DelegationStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The account/contract a just-started delegation is for. */
export interface PendingDelegation {
  /** Smart account the session key is being installed on. */
  account: string;
  /** Target contract the session key authorises. */
  target: string;
  /** Optional human-readable label. */
  label?: string;
}

/** Record the in-flight delegation before redirecting to the wallet. */
export function writePendingDelegation(
  pending: PendingDelegation,
  store: DelegationStorage | null = defaultStorage(),
): void {
  store?.setItem(PENDING_KEY, JSON.stringify(pending));
}

/**
 * Read AND clear the pending-delegation record (it's single-use — consumed on
 * the return trip). Returns null if absent or corrupt.
 */
export function consumePendingDelegation(
  store: DelegationStorage | null = defaultStorage(),
): PendingDelegation | null {
  if (!store) return null;
  const raw = store.getItem(PENDING_KEY);
  if (!raw) return null;
  store.removeItem(PENDING_KEY);
  try {
    const o = JSON.parse(raw) as Partial<PendingDelegation>;
    if (o && typeof o.account === 'string' && typeof o.target === 'string') {
      return { account: o.account, target: o.target, label: o.label };
    }
  } catch {
    /* corrupt entry — treat as absent */
  }
  return null;
}

export interface StartDelegationOptions {
  /** Full origin of the wallet for this account, e.g. https://<account>.<base>. */
  walletOrigin: string;
  /** Smart account address the session key will be installed on. */
  account: string;
  /** Target contract the session key authorises. */
  targetContract: string;
  /** Session-key lifetime. */
  duration: '24h' | '7d' | '30d' | 'none';
  /** Where the wallet should send the user back. Same-origin as window.location. */
  returnUrl: string;
  /** Optional human-readable label stored locally with the session-key material. */
  label?: string;
}

/**
 * Generate the session key, store it locally, then navigate the user to the
 * wallet's delegate page with the public key + scope in URL params. This is a
 * full-page redirect — no popup, no postMessage. The wallet redirects back to
 * `returnUrl` on success or cancel.
 */
export async function startDelegation(opts: StartDelegationOptions): Promise<void> {
  // Create a resident WebAuthn passkey at the current origin. The OS shows
  // its usual create-passkey UI; the user accepts. The private key stays in
  // the authenticator's secure element; we only get the public key and the
  // credentialId back.
  const k = await createSessionPasskey({
    rpId: window.location.hostname,
    rpName: window.location.host,
    userName: `session-key:${opts.account}`,
  });

  // Persist only the credentialId and pubkey at THIS origin. If the user
  // cancels at the wallet, the orphaned material is harmless — next
  // delegation overwrites it. No private bytes to worry about.
  const pubkeyHex = buf2hex(k.publicKey);
  saveSessionKeyMaterial(opts.account, opts.targetContract, {
    credentialId: k.credentialId,
    publicKey: pubkeyHex,
    label: opts.label,
  });

  // Remember which account+contract this delegation is for. The wallet's
  // return redirect carries only `?delegation=...` (it overwrites our
  // returnUrl query string), so on return the dApp recovers the account from
  // here rather than from the URL.
  writePendingDelegation({
    account: opts.account,
    target: opts.targetContract,
    label: opts.label,
  });

  const url = new URL(`${opts.walletOrigin}/security/delegate/`);
  url.searchParams.set('origin', window.location.origin);
  url.searchParams.set('target', opts.targetContract);
  url.searchParams.set('pubkey', pubkeyHex);
  url.searchParams.set('duration', opts.duration);
  url.searchParams.set('return', opts.returnUrl);

  // Full-page redirect: the user reviews the request at the wallet, signs,
  // and the wallet sends them back to `returnUrl` with ?delegation=ok or
  // ?delegation=cancelled.
  window.location.href = url.toString();
}

/**
 * Inspect URL params on a page that may have just been redirected to from the
 * wallet. Returns the status if present, null otherwise. `search` is injectable
 * for testing; it defaults to the live `window.location.search`.
 */
export function readDelegationReturn(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): 'ok' | 'cancelled' | null {
  const v = new URLSearchParams(search).get('delegation');
  if (v === 'ok' || v === 'cancelled') return v;
  return null;
}
