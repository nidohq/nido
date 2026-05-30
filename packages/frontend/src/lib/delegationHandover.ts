import { saveSessionKeyMaterial } from '@g2c/passkey-sdk';

export interface DelegationResult {
  account: string;
  target: string;
  verifier: string;
  ruleId: number | null;
  sessionPubkey: Uint8Array;
  privateKey: Uint8Array;
  credentialId: string;
}

export interface OpenDelegationOptions {
  /** Full origin of the wallet account, e.g. https://<account>.<base>. */
  walletOrigin: string;
  targetContract: string;
  duration: '24h' | '7d' | '30d' | 'none';
}

/** Opens the wallet's delegate page in a popup, listens for the handover
 *  postMessage, validates origin + payload, stores the session-key material
 *  in the dApp's localStorage, and resolves with the parsed material. */
export async function openDelegationPopup(
  opts: OpenDelegationOptions,
): Promise<DelegationResult> {
  const url = new URL(`${opts.walletOrigin}/security/delegate/`);
  url.searchParams.set('origin', window.location.origin);
  url.searchParams.set('target', opts.targetContract);
  url.searchParams.set('duration', opts.duration);

  const popup = window.open(url.toString(), '_blank', 'width=480,height=720');
  if (!popup) throw new Error('Popup blocked — please allow popups for this site.');

  return new Promise<DelegationResult>((resolve, reject) => {
    let settled = false;
    function done(fn: () => void) {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', listener);
      clearInterval(poll);
      fn();
    }

    function listener(ev: MessageEvent) {
      // Validate origin, source, payload fields.
      if (ev.origin !== opts.walletOrigin) return;
      if (ev.source !== popup) return;
      const m = ev.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'g2c-session-key-error') {
        return done(() => reject(new Error(`Wallet: ${m.error ?? 'unknown error'}`)));
      }
      if (m.type !== 'g2c-session-key') return;
      const p = m.payload;
      if (p?.origin !== window.location.origin) {
        return done(() => reject(new Error('Origin mismatch in handover.')));
      }
      if (p?.target !== opts.targetContract) {
        return done(() => reject(new Error('Target mismatch in handover.')));
      }
      const result: DelegationResult = {
        account: p.account,
        target: p.target,
        verifier: p.verifier,
        ruleId: p.ruleId ?? null,
        sessionPubkey: new Uint8Array(p.sessionPubkey),
        privateKey: new Uint8Array(p.privateKey),
        credentialId: p.credentialId,
      };
      saveSessionKeyMaterial(result.account, result.target, {
        privateKey: result.privateKey,
        credentialId: result.credentialId,
        label: opts.targetContract,
      });
      done(() => resolve(result));
    }
    window.addEventListener('message', listener);

    const poll = setInterval(() => {
      if (popup.closed) {
        done(() => reject(new Error('Popup closed before completing delegation.')));
      }
    }, 500);
  });
}
