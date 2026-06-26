import type { ScopedSessionKeyBlock } from '@nidohq/passkey-sdk';
import { formatSpendingLimit } from '@nidohq/passkey-sdk';
import { stashSignRequest, type SignRequest } from '../lib/signing/signRequest';
import { shortAddr } from '../lib/address';
import { EXPLORER_BASE } from '../lib/network';

export function renderSessionKeyCard(
  block: ScopedSessionKeyBlock,
  account: string,
  /** Called after the card removed itself on a successful revoke. Now unused:
   *  revoke navigates to /sign/ and the security page re-mounts on return.
   *  Kept for API compatibility — callers that pass this will see it never fire. */
  _onRevoked?: () => void,
): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rule-card';
  const target = block.targetContract;
  const expiryText =
    block.validUntil != null ? `expires at ledger ${block.validUntil}` : 'no expiry';
  const limitText =
    block.limitStroops != null && block.limitPeriodLedgers != null
      ? ` · limit ${formatSpendingLimit(block.limitStroops, block.limitPeriodLedgers)}`
      : block.limitUnreadable
        ? ' · limit unavailable (couldn’t read the policy — revoke still works)'
        : '';
  // Two live rules on the same target render near-identical cards; a key
  // suffix is the only way to tell the stale one from the live one.
  const pubkeyHex = Array.from(block.sessionPubkey, (b) => b.toString(16).padStart(2, '0')).join('');
  const keySuffix = pubkeyHex ? ` · key …${pubkeyHex.slice(-8)}` : '';
  div.innerHTML = `
    <strong>${escape(block.label ?? shortAddr(target, 8, 4))}</strong>
    <span class="muted"> · ${escape(expiryText)}${escape(keySuffix)}</span>
    <p class="muted small scope-line">Can act on
      <a class="contract-link mono" target="_blank" rel="noopener noreferrer"
         href="${EXPLORER_BASE}/contract/${encodeURIComponent(target)}">${escape(shortAddr(target, 8, 4))}</a>${escape(limitText)}
    </p>
    <div class="actions">
      <button class="btn revoke">Revoke</button>
    </div>
  `;
  const btn = div.querySelector<HTMLButtonElement>('.revoke')!;
  btn.addEventListener('click', () => {
    if (block.ruleId == null) return;
    if (!confirm('Revoke this session key? The dApp will need to re-delegate.')) return;
    // Route through /sign/ so the user sees a standard "Revoke session-key"
    // confirmation screen. Local material cleanup runs on the /security/ return
    // page when it sees ?revoked=<ruleId>.
    const pubkeyHexParam = pubkeyHex ? `&pubkey=${encodeURIComponent(pubkeyHex)}` : '';
    const targetParam = `&target=${encodeURIComponent(block.targetContract)}`;
    const returnUrl = `/security/?revoked=${encodeURIComponent(block.ruleId)}${pubkeyHexParam}${targetParam}`;
    const req: SignRequest = {
      v: 1,
      kind: 'session-revoke',
      account,
      operation: { type: 'remove-context-rule', ruleId: block.ruleId, target: block.targetContract },
      title: `Revoke session key #${block.ruleId}`,
      subtitle: block.label ? `Revoke access for "${escape(block.label ?? '')}"` : `Revoke access for ${escape(shortAddr(block.targetContract, 8, 4))}`,
      submitMode: 'relayer',
      returnTarget: { type: 'route', url: returnUrl },
    };
    const id = stashSignRequest(req);
    window.location.href = `/sign/?req=${id}`;
  });
  return div;
}

function escape(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}
