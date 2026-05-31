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

import { createSessionPasskey, saveSessionKeyMaterial, buf2hex } from '@g2c/passkey-sdk';

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
