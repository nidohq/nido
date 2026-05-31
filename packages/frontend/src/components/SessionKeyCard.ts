import type { ScopedSessionKeyBlock } from '@g2c/passkey-sdk';
import { scopedSessionKeyModule } from '@g2c/passkey-sdk';

export function renderSessionKeyCard(block: ScopedSessionKeyBlock): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rule-card';
  const expiryText =
    block.validUntil != null ? `expires at ledger ${block.validUntil}` : 'no expiry';
  div.innerHTML = `
    <strong>${escape(block.label ?? block.targetContract.slice(0, 8) + '…')}</strong>
    <span class="muted"> · ${escape(expiryText)}</span>
    <p class="muted small">${escape(scopedSessionKeyModule.summarize(block))}</p>
    <div class="actions">
      <button class="revoke">Revoke</button>
    </div>
  `;
  div.querySelector<HTMLButtonElement>('.revoke')!.addEventListener('click', async () => {
    if (!block.ruleId) return;
    if (!confirm('Revoke this session key? The dApp will need to re-delegate.')) return;
    // Phase 7 placeholder: real revoke wiring lands with Task 22.
    alert('Session-key revoke wiring lands in Task 22.');
  });
  return div;
}

function escape(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}
