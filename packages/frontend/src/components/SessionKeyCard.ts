import type { ScopedSessionKeyBlock } from '@g2c/passkey-sdk';
import { formatSpendingLimit } from '@g2c/passkey-sdk';
import { revokeSessionKey } from '../lib/sessionKeyActions';
import { toast } from '../lib/toast';
import { shortAddr } from '../lib/address';
import { EXPLORER_BASE } from '../lib/network';

export function renderSessionKeyCard(
  block: ScopedSessionKeyBlock,
  account: string,
  /** Called after the card removed itself on a successful revoke (e.g. to
   *  restore the list's empty-state copy). */
  onRevoked?: () => void,
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
      <button class="revoke">Revoke</button>
    </div>
  `;
  const btn = div.querySelector<HTMLButtonElement>('.revoke')!;
  btn.addEventListener('click', async () => {
    if (block.ruleId == null) return;
    if (!confirm('Revoke this session key? The dApp will need to re-delegate.')) return;
    btn.disabled = true;
    try {
      // Signs remove_context_rule with the primary passkey; revokeSessionKey
      // forgets the local session-key material only when this rule's pubkey
      // owns it (same-target re-delegation keeps the newer key's material).
      await revokeSessionKey(account, block.ruleId, block.targetContract, block.sessionPubkey);
      div.remove();
      toast({ msg: 'Session key revoked', icon: 'check' });
      onRevoked?.();
    } catch (err) {
      btn.disabled = false;
      toast(`Couldn't revoke: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return div;
}

function escape(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}
