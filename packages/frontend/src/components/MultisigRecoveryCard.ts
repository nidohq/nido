import type { MultisigRecoveryBlock } from '@g2c/passkey-sdk';
import { multisigRecoveryModule } from '@g2c/passkey-sdk';

export function renderRecoveryCard(block: MultisigRecoveryBlock): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rule-card';
  div.innerHTML = `
    <strong>${escape(block.label ?? 'Recovery')}</strong>
    <span class="muted"> · ${block.threshold} of ${block.friends.length} must approve</span>
    <div class="chips">
      ${block.friends.map((f) =>
        `<span class="chip">${escape(f.nickname ?? f.address.slice(0, 6) + '…' + f.address.slice(-4))}</span>`,
      ).join(' ')}
    </div>
    <p class="muted small">${escape(multisigRecoveryModule.summarize(block))}</p>
    <div class="actions">
      <button class="edit">Edit (replace)</button>
      <button class="remove">Remove</button>
    </div>
  `;
  div.querySelector<HTMLButtonElement>('.remove')!.addEventListener('click', async () => {
    if (!block.ruleId) return;
    if (!confirm('Remove this recovery rule? Friends will no longer be able to recover this account.')) return;
    // Phase 7 placeholder: real revoke wiring lands with Task 21.
    alert('Recovery revoke wiring lands in Task 21.');
  });
  div.querySelector<HTMLButtonElement>('.edit')!.addEventListener('click', async () => {
    // Phase 7 placeholder.
    alert('Recovery edit (= revoke + re-add via the form) lands in Task 21.');
  });
  return div;
}

function escape(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}
