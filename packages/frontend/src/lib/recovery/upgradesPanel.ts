/**
 * The account-upgrade panel on the policy page: Perch's seven-day upgrade
 * path (`schedule_upgrade` → wait 120,960 ledgers → `execute_upgrade`).
 *
 * Owner authorization schedules, executes, and cancels. A `protected`
 * account additionally records its recovery condition's approval of
 * `Upgrade { requestId, wasmHash }` before scheduling. Any reconfiguration
 * or completed recovery in between makes the request stale: executing it
 * then clears it instead of running it.
 */

import { perch } from '@nidohq/passkey-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { accountArgs, latestLedger, readRecoveryState, submitAsOwner } from './chain.js';
import { perchDeployment } from './deployment.js';
import { condition, hex, ledgersToText } from './model.js';
import { busy, card, collectCondition, el } from './ui.js';

const HEX32 = /^[0-9a-f]{64}$/;

export async function mountUpgrades(root: HTMLElement, account: string): Promise<void> {
  if (!perchDeployment()) return;
  const args = accountArgs(account);
  const pending = await perch.readPendingUpgrade(args);
  const c = card('Account upgrades', '');
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  root.append(c);

  if (pending) {
    const ledger = await latestLedger();
    const wait = pending.executable_at - ledger;
    body.append(
      el('p', { style: 'margin:0;font-size:13.5px;' },
        `Upgrade ${pending.request_id} to Wasm <code class="mono">${esc(hex(new Uint8Array(pending.wasm_hash)).slice(0, 16))}…</code> ` +
        (wait > 0 ? `can run in about ${esc(ledgersToText(wait))} (ledger ${pending.executable_at}).` : 'is ready to run.')),
    );
    if (wait <= 0) {
      const run = el('button', { class: 'btn primary', type: 'button' }, 'Run the upgrade') as HTMLButtonElement;
      run.addEventListener('click', () =>
        busy(run, status, 'Confirm with your passkey…', async () => {
          const op = await perch.buildExecuteUpgrade({ ...args, requestId: BigInt(pending.request_id) });
          await submitAsOwner(account, op.operations[0]!);
          toast({ msg: 'Upgrade ran (or was cleared as stale)', icon: 'check' });
          setTimeout(() => location.reload(), 1_500);
        }),
      );
      body.append(run);
    }
    const cancel = el('button', { class: 'btn ghost sm', type: 'button' }, 'Cancel the upgrade') as HTMLButtonElement;
    cancel.addEventListener('click', () =>
      busy(cancel, status, 'Confirm with your passkey…', async () => {
        const op = await perch.buildCancelUpgrade(args);
        await submitAsOwner(account, op.operations[0]!);
        setTimeout(() => location.reload(), 1_500);
      }),
    );
    body.append(cancel, status);
    return;
  }

  body.append(
    el('p', { class: 'mut', style: 'margin:0;font-size:13px;' },
      'Replace this account’s code. It runs only after a seven-day wait, and a recovery in between cancels it.'),
  );
  const input = el('input', { class: 'input mono', placeholder: 'Wasm hash (64 hex characters)', style: 'font-size:12px;' }) as HTMLInputElement;
  const schedule = el('button', { class: 'btn soft', type: 'button' }, 'Schedule upgrade') as HTMLButtonElement;
  body.append(input, schedule, status);
  schedule.addEventListener('click', () =>
    busy(schedule, status, 'Preparing…', async () => {
      const wasm = input.value.trim().toLowerCase();
      if (!HEX32.test(wasm)) throw new Error('Enter the 64-character Wasm hash.');
      const wasmHash = Uint8Array.from(wasm.match(/../g)!.map((x) => parseInt(x, 16)));
      const state = await readRecoveryState(account);
      let approvalValidUntil = 0;
      if (state.summary?.profile === 'protected') {
        const requestId = await perch.readNextUpgradeRequestId(args);
        approvalValidUntil = await collectCondition(
          body,
          account,
          { kind: 'upgrade', requestId, wasmHash },
          condition(state.summary),
          state.summary.guardians,
          state.summary.expiryLedgers,
        );
      }
      status.textContent = 'Confirm with your passkey…';
      const op = await perch.buildScheduleUpgrade({ ...args, wasmHash, approvalValidUntil });
      await submitAsOwner(account, op.operations[0]!);
      toast({ msg: 'Upgrade scheduled', icon: 'check' });
      setTimeout(() => location.reload(), 1_500);
    }),
  );
}
