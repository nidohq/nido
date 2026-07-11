import type { Friend, MultisigRecoveryBlock } from '@nidohq/passkey-sdk';
import {
  multisigRecoveryModule,
  resolveFriendInput,
  resolveName,
  fetchRegistryAddress,
} from '@nidohq/passkey-sdk';
import { installRecovery } from './recoveryActions.js';

import { RPC_URL } from './network';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

function emptyFriend(): Friend {
  return { address: '', inputAs: '' };
}

export function mountRecoveryForm(container: HTMLElement, account: string): void {
  container.hidden = false;
  const draft: MultisigRecoveryBlock = multisigRecoveryModule.defaultDraft();
  draft.friends = [emptyFriend(), emptyFriend(), emptyFriend()];

  container.innerHTML = `
    <h3>Set up recovery</h3>
    <p class="muted">Picked friends, acting together, can rotate your passkey and adjust your account's rules. They <strong>cannot</strong> move your funds.</p>
    <div id="rc-friends"></div>
    <button id="rc-add-friend" type="button">+ Add another friend</button>
    <div class="threshold" style="margin-top:1rem">
      <span>Require</span>
      <button id="rc-m-down" type="button">−</button>
      <strong id="rc-m-value">${draft.threshold}</strong>
      <button id="rc-m-up" type="button">+</button>
      <span>of <strong id="rc-n-value">${draft.friends.length}</strong> friends</span>
    </div>
    <label style="display:block;margin-top:1rem">
      Rule name (optional)
      <input id="rc-rule-name" value="Recovery" style="display:block;margin-top:0.25rem"/>
    </label>
    <p id="rc-summary" class="muted" style="margin-top:1rem"></p>
    <div class="actions" style="margin-top:1rem">
      <button id="rc-cancel" type="button">Cancel</button>
      <button id="rc-save" type="button">Sign &amp; save</button>
    </div>
  `;

  const $ = (s: string) => container.querySelector(s)!;
  const friendsEl = $('#rc-friends') as HTMLElement;

  renderFriends();
  refreshSummary();

  $('#rc-add-friend').addEventListener('click', () => {
    draft.friends.push(emptyFriend());
    renderFriends();
    updateThresholdDisplay();
    refreshSummary();
  });
  $('#rc-m-up').addEventListener('click', () => {
    if (draft.threshold < draft.friends.length) {
      draft.threshold++;
      updateThresholdDisplay();
      refreshSummary();
    }
  });
  $('#rc-m-down').addEventListener('click', () => {
    if (draft.threshold > 1) {
      draft.threshold--;
      updateThresholdDisplay();
      refreshSummary();
    }
  });
  $('#rc-rule-name').addEventListener('input', (e) => {
    draft.label = (e.target as HTMLInputElement).value;
    refreshSummary();
  });
  $('#rc-cancel').addEventListener('click', () => {
    container.hidden = true;
    container.innerHTML = '';
  });
  $('#rc-save').addEventListener('click', async () => {
    const existingError = container.querySelector('.form-error');
    if (existingError) existingError.textContent = '';
    if (!validate()) return;
    const saveBtn = $('#rc-save') as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Submitting...';
    try {
      await installRecovery(account, draft);
      container.innerHTML = '<p>Recovery rule installed. Refreshing…</p>';
      setTimeout(() => location.reload(), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to install recovery:', e);
      showFormError('Failed to save: ' + msg);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Sign & save';
    }
  });

  function renderFriends() {
    friendsEl.innerHTML = '';
    draft.friends.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'friend-row';
      row.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.4rem';
      row.innerHTML = `
        <input value="${f.inputAs}" placeholder="name, C…, or G…" style="flex:1"/>
        <span class="resolve-status muted" style="font-size:0.85em"></span>
        <button class="remove" type="button">\xd7</button>
      `;
      const input = row.querySelector('input') as HTMLInputElement;
      const status = row.querySelector('.resolve-status') as HTMLElement;
      input.addEventListener('input', async () => {
        f.inputAs = input.value;
        status.textContent = '…';
        try {
          const r = await resolveFriendInput(input.value, {
            resolveName: async (name) =>
              resolveName(
                RPC_URL,
                await fetchRegistryAddress('name-registry'),
                name,
                NETWORK_PASSPHRASE,
              ),
          });
          if (r) {
            f.address = r.address;
            status.textContent = '✓ ' + r.address.slice(0, 6) + '…';
          } else {
            f.address = '';
            status.textContent = 'invalid';
          }
        } catch {
          f.address = '';
          status.textContent = 'invalid';
        }
        refreshSummary();
      });
      row.querySelector('.remove')!.addEventListener('click', () => {
        draft.friends.splice(i, 1);
        if (draft.threshold > draft.friends.length) {
          draft.threshold = Math.max(1, draft.friends.length);
        }
        renderFriends();
        updateThresholdDisplay();
        refreshSummary();
      });
      friendsEl.appendChild(row);
    });
  }

  function updateThresholdDisplay() {
    ($('#rc-m-value') as HTMLElement).textContent = String(draft.threshold);
    ($('#rc-n-value') as HTMLElement).textContent = String(draft.friends.length);
  }

  function refreshSummary() {
    ($('#rc-summary') as HTMLElement).textContent = multisigRecoveryModule.summarize(draft);
  }

  function showFormError(msg: string) {
    let errEl = container.querySelector<HTMLElement>('.form-error');
    if (!errEl) {
      errEl = document.createElement('p');
      errEl.className = 'form-error muted';
      errEl.style.cssText = 'color:var(--warn,#b45309);margin-top:0.5rem;font-size:13px;';
      container.querySelector('.actions')!.before(errEl);
    }
    errEl.textContent = msg;
  }

  function validate(): boolean {
    if (draft.friends.length < 1) {
      showFormError('Add at least one friend.');
      return false;
    }
    if (draft.friends.some((f) => !f.address)) {
      showFormError('Some friends did not resolve — check the addresses.');
      return false;
    }
    return true;
  }
}
