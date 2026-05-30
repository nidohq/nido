/**
 * dApp-side delegation flow.
 *
 * Design: the dApp generates a fresh P-256 session key in its own origin and
 * persists it via `saveSessionKeyMaterial` BEFORE redirecting the user to the
 * wallet. The wallet receives only the *public* key (hex) in the URL, builds
 * the install transaction, gets the user's primary-passkey signature, submits,
 * and redirects back. Private bytes never cross origins.
 *
 * Replaces the earlier popup + postMessage handover where the wallet
 * generated the key and posted private bytes back.
 */

import { generateSessionKey, saveSessionKeyMaterial, buf2hex } from '@g2c/passkey-sdk';

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
  const k = await generateSessionKey();

  // Persist the private bytes in *this origin* before navigating away. If the
  // user cancels at the wallet, the orphaned material is harmless; the next
  // delegation attempt overwrites it.
  saveSessionKeyMaterial(opts.account, opts.targetContract, {
    privateKey: k.privateKey,
    credentialId: k.credentialId,
    label: opts.label,
  });

  // 65-byte SEC1 uncompressed → hex (starts with "04"). The wallet validates
  // the shape before building the install tx.
  const pubkeyHex = buf2hex(k.publicKey);

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
 * wallet. Returns the status if present, null otherwise.
 */
export function readDelegationReturn(): 'ok' | 'cancelled' | null {
  const v = new URLSearchParams(window.location.search).get('delegation');
  if (v === 'ok' || v === 'cancelled') return v;
  return null;
}
