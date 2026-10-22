/**
 * `/security/recovery/`: the owner's recovery settings for all six
 * profile/mode combinations.
 *
 * Every change is one `apply_doc` of the account's document with a new
 * `recovery` member (enrollment, guardian rotation, threshold, mode, timing,
 * turning recovery off). A ZK credential's pool leaf is inserted by that same
 * `apply_doc`, so enrollment cannot half-happen. Under `protected`, the
 * currently enrolled condition records its approval of the exact new
 * configuration first (`collectCondition`).
 *
 * Recovery runs at the controller the account adopted. After a Perch
 * redeploy that is an earlier one than the deployment's, and it keeps
 * working there; `moveCard` offers the switch to the deployment's stack
 * with every setting kept. The switch is a reconfiguration the controller
 * being left evaluates, so under `protected` the helpers approve it there.
 */

import { docHash, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { markBackupSetUp } from '../recoveryBackupPrompt.js';
import {
  applyDoc,
  currentOrFirstDoc,
  latestLedger,
  readRecoveryState,
  recoveryClient,
  submitAsOwner,
  submitOpen,
  type RecoveryState,
} from './chain.js';
import { perchDeployment, requireDeployment } from './deployment.js';
import { baselineWithoutExpiringRules } from './baseline.js';
import {
  adminSignerIds,
  changeNeeds,
  condition,
  ledgersToText,
  MODE_TEXT,
  PROFILE_TEXT,
  quickRecoveryTimingAllowed,
  type RecoveryKit,
  type RecoveryMode,
  type RecoveryProfile,
} from './model.js';
import { NETWORK_PASSPHRASE } from '../network.js';
import { busy, card, collectCondition, el, errorText, guardianLinks, kitInput, short } from './ui.js';
import { kitFile, newRecoveryKit, proveWithKit } from './zk.js';

/** Timing presets. "Quick" exists for testnet walkthroughs. */
const TIMING = {
  standard: { delayLedgers: 120_960, expiryLedgers: 241_920, label: 'Standard: wait 7 days, then 14 days to finish' },
  quick: { delayLedgers: 24, expiryLedgers: 17_280, label: 'Quick (testing): wait about 2 minutes, then a day to finish' },
} as const;

export async function mountRecoverySettings(root: HTMLElement, account: string | null): Promise<void> {
  if (!account) {
    root.append(el('p', { class: 'mut' }, 'Open this page from your Nido to manage its recovery.'));
    return;
  }
  if (!perchDeployment()) {
    root.append(
      el(
        'div',
        { class: 'alert', role: 'note' },
        'Recovery runs on the Perch recovery stack, which is not deployed on this network yet.',
      ),
    );
    return;
  }
  root.innerHTML = '<div class="skeleton" style="height:120px;"></div>';
  let state: RecoveryState;
  try {
    state = await readRecoveryState(account);
  } catch (e) {
    root.innerHTML = `<p class="mut">Couldn't read this Nido's recovery: ${esc(errorText(e))}</p>`;
    return;
  }
  root.innerHTML = '';
  root.append(statusCard(state));
  if (state.gate?.authorized_attempt != null) root.append(attemptCard(account, state));
  // Nothing reconfigures while an attempt is authorized (Perch spec §10).
  else if (state.summary) {
    const move = moveCard(account, state);
    if (move) root.append(move);
  }
  root.append(configureCard(account, state));
}

/** The owner's switch of recovery from an earlier controller (and pool) to
 *  the deployment's, keeping every setting and the published baseline. */
function moveCard(account: string, state: RecoveryState): HTMLElement | undefined {
  const deployment = requireDeployment();
  const current = perch.recoveryFromWire(state.doc!.recovery!);
  const drift = perch.recoveryStackDrift(deployment, current);
  if (!drift.controller && !drift.zk) return undefined;
  const c = card(
    'Move recovery to the current service',
    `<p style="margin:0;font-size:13.5px;">Your recovery runs at an earlier recovery service ` +
      `(<code class="mono" style="word-break:break-all;">${esc(current.controller)}</code>), and keeps working there. ` +
      'Moving it to the one Nido sets up today keeps every setting.' +
      (drift.zk ? ' Your recovery kit cannot move, so you make a new one and the old one stops working.' : '') +
      (current.profile === 'protected' ? ' Your helpers approve the move first, at the service you are leaving.' : '') +
      '</p>',
  );
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  const kitBox = el('div', { style: 'display:grid;gap:6px;font-size:13px;' });
  let newKit: { kit: RecoveryKit; enrollment: perch.ZkEnrollmentSpec } | undefined;
  let kitSaved = false;
  if (drift.zk) {
    const make = el('button', { class: 'btn soft sm', type: 'button' }, 'Create my new recovery kit') as HTMLButtonElement;
    make.addEventListener('click', () =>
      busy(make, status, 'Creating your recovery kit…', async () => {
        newKit = await newRecoveryKit(account);
        kitSaved = false;
        const url = URL.createObjectURL(kitFile(newKit.kit));
        kitBox.innerHTML =
          `<a class="btn ghost sm" href="${url}" download="nido-recovery-kit-${esc(account.slice(0, 6))}.json">Download recovery kit</a>` +
          '<label class="pol-check"><input type="checkbox" data-kit-saved> I saved my new recovery kit</label>';
        (kitBox.querySelector('[data-kit-saved]') as HTMLInputElement).addEventListener('change', (e) => {
          kitSaved = (e.target as HTMLInputElement).checked;
        });
        status.textContent = '';
      }),
    );
    body.append(make, kitBox);
  }
  const go = el('button', { class: 'btn primary', type: 'button' }, 'Move my recovery') as HTMLButtonElement;
  body.append(go, status);
  go.addEventListener('click', () =>
    busy(go, status, 'Preparing…', async () => {
      if (drift.zk && !newKit) throw new Error('Create your new recovery kit first.');
      if (newKit && !kitSaved) throw new Error('Confirm you saved your new recovery kit first.');
      const moved = perch.movedRecovery(deployment, current, newKit?.enrollment);
      // The restore point stays: read it at the controller being left, and
      // publish the same bytes at the new one once the account adopts it.
      const baseline = moved.baseline ? await recoveryClient().baseline(account) : undefined;
      await apply(account, state, perch.withRecovery(state.doc!, moved), status);
      if (baseline) {
        status.textContent = 'Saving your restore point at the new service…';
        const op = await recoveryClient().publishBaseline(account, baseline);
        await submitOpen(op.operations[0]!);
      }
      status.textContent = 'Moved.';
      toast({ msg: 'Recovery moved', icon: 'check' });
      setTimeout(() => location.reload(), 1_500);
    }),
  );
  return c;
}

function statusCard(state: RecoveryState): HTMLElement {
  const s = state.summary;
  if (!s) {
    return card(
      'Recovery',
      '<p style="margin:0;font-size:14px;">Recovery is off. If you lose this passkey, nobody can help you back in.</p>',
    );
  }
  const rows = [
    `<div><strong>${esc(PROFILE_TEXT[s.profile].title)}</strong></div>`,
    `<div class="mut" style="font-size:13px;">${esc(PROFILE_TEXT[s.profile].body)}</div>`,
    `<div style="font-size:13.5px;">${esc(MODE_TEXT[s.mode])}</div>`,
  ];
  if (s.guardians.length) {
    rows.push(
      `<div style="font-size:13px;">${s.quorum} of ${s.guardians.length} friends: ${s.guardians
        .map((g) => `<code class="mono">${esc(short(g))}</code>`)
        .join(', ')}</div>`,
    );
  }
  if (s.zk) rows.push(`<div style="font-size:13px;">Recovery kit enrolled (${esc(s.zk.enrollmentId.slice(0, 8))}…)</div>`);
  rows.push(
    `<div class="mut" style="font-size:12.5px;">A recovery waits ${esc(ledgersToText(s.delayLedgers))} before it can finish` +
      `${s.baselineDocHash ? ', and can restore your saved setup if your passkey is stolen' : ''}.</div>`,
  );
  return card('Recovery', rows.join(''));
}

/** An authorized attempt: who may cancel it, and how. */
function attemptCard(account: string, state: RecoveryState): HTMLElement {
  const s = state.summary!;
  const attemptId = BigInt(state.gate!.authorized_attempt!);
  const c = card(
    'A recovery is under way',
    `<p style="margin:0;font-size:13.5px;">Attempt ${attemptId} was approved and can finish after its waiting period.` +
      (state.gate!.frozen ? ' This Nido is frozen until it finishes or is cancelled.' : '') +
      '</p>',
  );
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  if (s.profile === 'loss') {
    const btn = el('button', { class: 'btn soft sm', type: 'button' }, 'I didn’t ask for this: cancel it') as HTMLButtonElement;
    btn.addEventListener('click', () =>
      busy(btn, status, 'Cancelling…', async () => {
        const op = await recoveryClient().ownerCancel(account, attemptId);
        await submitAsOwner(account, op.operations[0]!);
        status.textContent = 'Cancelled.';
        toast({ msg: 'Recovery cancelled', icon: 'check' });
      }),
    );
    body.append(btn, status);
    return c;
  }
  const need = condition(s);
  body.append(
    el(
      'p',
      { style: 'margin:0;font-size:13px;' },
      'Only your helpers can cancel it. ' +
        (need.guardians ? `Ask ${need.guardians} friends to cancel with their link. ` : '') +
        (need.zk ? 'Prove it with your recovery kit.' : ''),
    ),
  );
  if (need.guardians) {
    body.append(
      guardianLinks(s.guardians, { kind: 'attempt', account, attemptId: attemptId.toString(), domain: 'cancel' }),
    );
  }
  if (need.zk) {
    body.append(
      kitInput((kit) =>
        void (async () => {
          try {
            const client = recoveryClient();
            const statement = await client.statement(account, attemptId, perch.EvidenceDomain.Cancel);
            const evidence = await proveWithKit(kit, statement, (step) => (status.textContent = step));
            const op = await client.submitZk(account, attemptId, perch.EvidenceDomain.Cancel, evidence);
            await submitOpen(op.operations[0]!);
            status.textContent = 'Cancellation proof recorded.';
          } catch (e) {
            status.textContent = errorText(e);
          }
        })(),
      ),
    );
  }
  body.append(status);
  return c;
}

function radio(name: string, value: string, label: string, checked: boolean): string {
  return `<label class="pol-radio"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${esc(label)}</label>`;
}

function configureCard(account: string, state: RecoveryState): HTMLElement {
  const s = state.summary;
  const c = card(
    s ? 'Change recovery' : 'Set up recovery',
    `<fieldset class="pol-fieldset"><legend>What should recovery protect against?</legend>
       ${radio('profile', 'loss', PROFILE_TEXT.loss.title, (s?.profile ?? 'loss') === 'loss')}
       ${radio('profile', 'protected', PROFILE_TEXT.protected.title, s?.profile === 'protected')}
     </fieldset>
     <fieldset class="pol-fieldset"><legend>Who can help you back in?</legend>
       ${radio('mode', 'guardian-only', MODE_TEXT['guardian-only'], (s?.mode ?? 'guardian-only') === 'guardian-only')}
       ${radio('mode', 'zk-only', MODE_TEXT['zk-only'], s?.mode === 'zk-only')}
       ${radio('mode', 'combined', MODE_TEXT.combined, s?.mode === 'combined')}
     </fieldset>
     <label class="pol-input-label" data-for="guardians">Friends' Nidos or Stellar addresses, one per line
       <textarea name="guardians" class="input mono" rows="3" style="font-size:12px;">${esc((s?.guardians ?? []).join('\n'))}</textarea>
     </label>
     <label class="pol-input-label" data-for="guardians">How many must approve?
       <input name="quorum" class="input" type="number" min="1" value="${s?.quorum || 2}">
     </label>
     <div data-for="zk" class="pol-fieldset" style="font-size:13px;"></div>
     <label class="pol-check"><input type="checkbox" name="baseline"${s?.baselineDocHash ? ' checked' : ''}> If my passkey is stolen, restore this exact setup</label>
     <label class="pol-input-label">Timing
       <select name="timing" class="input">
         <option value="standard">${esc(TIMING.standard.label)}</option>
         ${quickRecoveryTimingAllowed(NETWORK_PASSPHRASE)
           ? `<option value="quick"${s && s.delayLedgers < 1_000 ? ' selected' : ''}>${esc(TIMING.quick.label)}</option>`
           : ''}
       </select>
     </label>`,
  );
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  const save = el('button', { class: 'btn primary', type: 'button' }, s ? 'Save recovery settings' : 'Turn on recovery') as HTMLButtonElement;
  body.append(save);
  let off: HTMLButtonElement | undefined;
  if (s) {
    off = el('button', { class: 'btn ghost sm', type: 'button' }, 'Turn recovery off') as HTMLButtonElement;
    body.append(off);
  }
  body.append(status);

  const field = (name: string) => body.querySelector(`[name="${name}"]`) as HTMLInputElement;
  const checked = (name: string) => (body.querySelector(`[name="${name}"]:checked`) as HTMLInputElement).value;

  // The ZK credential: keep the enrolled one, or make a new kit.
  const zkBox = body.querySelector('[data-for="zk"]') as HTMLElement;
  let newKit: { kit: RecoveryKit; enrollment: perch.ZkEnrollmentSpec } | undefined;
  let kitSaved = false;
  const renderZk = () => {
    const mode = checked('mode') as RecoveryMode;
    body.querySelectorAll<HTMLElement>('[data-for="guardians"]').forEach((n) => (n.hidden = mode === 'zk-only'));
    zkBox.hidden = mode === 'guardian-only';
    zkBox.innerHTML = '';
    if (zkBox.hidden) return;
    if (s?.zk && !newKit) {
      zkBox.append(el('div', {}, 'Your enrolled recovery kit stays.'));
    }
    const make = el('button', { class: 'btn soft sm', type: 'button' }, s?.zk ? 'Replace my recovery kit' : 'Create my recovery kit') as HTMLButtonElement;
    make.addEventListener('click', () =>
      busy(make, status, 'Creating your recovery kit…', async () => {
        newKit = await newRecoveryKit(account);
        kitSaved = false;
        renderZk();
        status.textContent = '';
      }),
    );
    zkBox.append(make);
    if (newKit) {
      const url = URL.createObjectURL(kitFile(newKit.kit));
      zkBox.append(
        el(
          'div',
          { style: 'display:grid;gap:6px;' },
          `<a class="btn ghost sm" href="${url}" download="nido-recovery-kit-${esc(account.slice(0, 6))}.json">Download recovery kit</a>
           <div class="mut" style="font-size:12px;">Anyone with this file can start a recovery of this Nido. Keep it somewhere safe and offline. Nido never stores it.</div>
           <label class="pol-check"><input type="checkbox" data-kit-saved> I saved my recovery kit</label>`,
        ),
      );
      (zkBox.querySelector('[data-kit-saved]') as HTMLInputElement).addEventListener('change', (e) => {
        kitSaved = (e.target as HTMLInputElement).checked;
      });
    }
  };
  body.querySelectorAll('[name="mode"]').forEach((n) => n.addEventListener('change', renderZk));
  renderZk();

  save.addEventListener('click', () =>
    busy(save, status, 'Preparing…', async () => {
      const deployment = requireDeployment();
      const mode = checked('mode') as RecoveryMode;
      const profile = checked('profile') as RecoveryProfile;
      const guardians = field('guardians').value.split(/\s+/).map((g) => g.trim()).filter(Boolean);
      const quorum = Number(field('quorum').value);
      if (mode !== 'guardian-only' && !newKit && !s?.zk) {
        throw new Error('Create your recovery kit first.');
      }
      if (newKit && !kitSaved) throw new Error('Confirm you saved your recovery kit first.');
      // A kit enrolled in an earlier pool cannot be renamed into the
      // deployment's: the account refuses a changed factor that keeps its
      // enrollment id.
      if (mode !== 'guardian-only' && !newKit && state.doc?.recovery &&
          perch.recoveryStackDrift(deployment, perch.recoveryFromWire(state.doc.recovery)).zk) {
        throw new Error('Your recovery kit is enrolled at an earlier recovery service. Create a new recovery kit to save these settings.');
      }
      const base = state.doc ?? (await currentOrFirstDoc(account)).doc;
      const zk =
        mode === 'guardian-only'
          ? undefined
          : newKit?.enrollment ?? currentZk(state.doc!);
      // The Quick preset is a testnet walkthrough aid; never honour it on
      // mainnet even if the <option> was re-added by hand (it removes the
      // owner's recovery veto window).
      const timingKey = field('timing').value as keyof typeof TIMING;
      const timing =
        timingKey === 'quick' && !quickRecoveryTimingAllowed(NETWORK_PASSPHRASE)
          ? TIMING.standard
          : TIMING[timingKey];
      // A baseline restore point must hold only durable rules. Strip expiring
      // (session) rules so a captured/renewed session can't later brick
      // compromise recovery with PastValidUntil. Both the on-chain
      // baseline hash and the published baseline doc use this stripped doc.
      const withoutRecovery = baselineWithoutExpiringRules(perch.withRecovery(base, undefined));
      const spec = perch.recoverySpec(deployment, {
        profile,
        mode,
        guardians: mode === 'zk-only' ? undefined : guardians,
        quorum: mode === 'zk-only' ? undefined : quorum,
        zk,
        replaceable: adminSignerIds(base),
        baselineDocHash: field('baseline').checked ? docHash(withoutRecovery) : undefined,
        delayLedgers: timing.delayLedgers,
        expiryLedgers: timing.expiryLedgers,
      });
      const next = perch.withRecovery(base, spec);
      await apply(account, state, next, status);
      if (spec.baseline) {
        status.textContent = 'Saving your restore point on chain…';
        const op = await recoveryClient().publishBaseline(account, JSON.stringify(withoutRecovery));
        await submitOpen(op.operations[0]!);
      }
      status.textContent = 'Saved.';
      markBackupSetUp(account);
      toast({ msg: 'Recovery saved', icon: 'check' });
      setTimeout(() => location.reload(), 1_500);
    }),
  );

  off?.addEventListener('click', () =>
    busy(off!, status, 'Turning recovery off…', async () => {
      if (!confirm('Turn off recovery? If you lose this passkey, nobody will be able to help you back in.')) return;
      await apply(account, state, perch.withRecovery(state.doc!, undefined), status);
      toast({ msg: 'Recovery is off', icon: 'check' });
      setTimeout(() => location.reload(), 1_500);
    }),
  );
  return c;
}

/** Apply `next`, first collecting a `protected` account's condition. */
async function apply(account: string, state: RecoveryState, next: PolicyDoc, status: HTMLElement): Promise<void> {
  const needs = changeNeeds(state.doc, next);
  let validUntil = 0;
  if (needs) {
    status.textContent = 'Waiting for your helpers…';
    validUntil = await collectCondition(
      status.parentElement as HTMLElement,
      account,
      needs.change,
      needs.condition,
      state.summary!.guardians,
      state.summary!.expiryLedgers,
      needs.change.kind === 'reconfigure-set' ? { recovery: next.recovery } : {},
    );
    if ((await latestLedger()) > validUntil) throw new Error('The approvals expired; try again.');
  }
  status.textContent = 'Confirm with your passkey…';
  // Lands only at the revision `state` was read at: the approvals were
  // collected for this change to that document, and a change that has
  // landed since means starting over.
  await applyDoc(account, next, { baseRevision: state.revision, approvalValidUntil: validUntil });
}

function currentZk(doc: PolicyDoc): perch.ZkEnrollmentSpec {
  const mode = (doc.recovery as { mode: Record<string, string> }).mode;
  const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
  return { enrollmentId: bytes(mode['enrollment-id']!), commitment: bytes(mode.commitment!) };
}

