/**
 * `/security/recover/`: getting back into a Nido after losing its passkey.
 *
 * Runs on the account's own subdomain, because the new passkey's WebAuthn
 * RP id is that hostname. The flow follows Perch's state machine:
 *
 * 1. Create a new passkey here; for a ZK mode also a new recovery kit
 *    (the completion spends the old credential's nullifier).
 * 2. Open a lost-key attempt (permissionless) declaring the replacement:
 *    the new passkey takes the lost one's signer slot.
 * 3. Evidence: friends approve from their own Nidos (links carry the
 *    replacement so they can check it with you), and/or prove with the old
 *    recovery kit here.
 * 4. Once authorized, wait out the delay (counted in ledgers), then complete:
 *    anyone may submit the account's compiler-derived target through the
 *    zero-signer recovery rule.
 *
 * `compromise` (my passkey was stolen) is the same with the enrolled
 * baseline as the source; it needs the baseline published, which the
 * settings page does at enrollment.
 */

import { buf2hex, parseRegistration, perch, saveCredential } from '@nidohq/passkey-sdk';
import { scValToNative } from '@stellar/stellar-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { fetchVerifierAddress } from '../policyChainFetch.js';
import { latestLedger, readRecoveryState, recoveryClient, submitOpen } from './chain.js';
import { perchDeployment } from './deployment.js';
import {
  condition,
  ledgersToText,
  MODE_TEXT,
  replacementsFromWire,
  replacementsToWire,
  SECONDS_PER_LEDGER,
  type RecoveryKit,
  type WireReplacements,
} from './model.js';
import { busy, card, el, errorText, guardianLinks, kitInput } from './ui.js';
import { kitFile, newRecoveryKit, proveWithKit } from './zk.js';

/** What survives a reload while friends approve: the new passkey and the
 *  attempt it belongs to. The new kit's secret is only ever in the file the
 *  user downloaded. */
interface Pending {
  action: 'lost-key' | 'compromise';
  attemptId?: string;
  credentialId: string;
  publicKey: string;
  replacements: WireReplacements;
}

const key = (account: string) => `nido:recover:${account}`;

function loadPending(account: string): Pending | undefined {
  try {
    const raw = localStorage.getItem(key(account));
    return raw ? (JSON.parse(raw) as Pending) : undefined;
  } catch {
    return undefined;
  }
}

function savePending(account: string, p: Pending | undefined): void {
  if (p) localStorage.setItem(key(account), JSON.stringify(p));
  else localStorage.removeItem(key(account));
}

const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  );

export async function mountRecover(root: HTMLElement, account: string | null): Promise<void> {
  if (!account) {
    root.append(el('p', { class: 'mut' }, 'Open this page at your Nido’s address (yourname.nido.fyi) to recover it.'));
    return;
  }
  if (!perchDeployment()) {
    root.append(
      el('div', { class: 'alert', role: 'note' }, 'Recovery is not deployed on this network yet. It ships with Perch’s release.'),
    );
    return;
  }
  const state = await readRecoveryState(account);
  const s = state.summary;
  if (!s) {
    root.append(card('Recovery', '<p style="margin:0;">This Nido has no recovery set up, so it cannot be recovered.</p>'));
    return;
  }
  root.append(
    card('How this Nido recovers', `<p style="margin:0;font-size:14px;">${esc(MODE_TEXT[s.mode])}. ` +
      `After approval it waits ${esc(ledgersToText(s.delayLedgers))}.</p>`),
  );

  const pending = loadPending(account);
  if (!pending) {
    root.append(startCard(account, s.replaceable, s.mode !== 'guardian-only', Boolean(s.baselineDocHash), () => location.reload()));
    return;
  }
  root.append(await progressCard(account, pending, s));
}

/** Step 1-2: new passkey (and kit), then open the attempt. */
function startCard(
  account: string,
  replaceable: string[],
  zkMode: boolean,
  hasBaseline: boolean,
  done: () => void,
): HTMLElement {
  const c = card(
    'Start recovery',
    `<label class="pol-input-label">Which passkey are you replacing?
       <select name="slot" class="input">${replaceable.map((id) => `<option>${esc(id)}</option>`).join('')}</select>
     </label>
     ${hasBaseline ? '<label class="pol-check"><input type="checkbox" name="stolen"> My passkey was stolen: restore my saved setup</label>' : ''}
     <p class="mut" style="margin:0;font-size:12.5px;">You will create a new passkey for this Nido on this device.${
       zkMode ? ' You will also get a new recovery kit to replace the one you use now.' : ''
     }</p>`,
  );
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  const go = el('button', { class: 'btn primary', type: 'button' }, 'Create my new passkey') as HTMLButtonElement;
  body.append(go, status);
  go.addEventListener('click', () =>
    busy(go, status, 'Creating your passkey…', async () => {
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const created = (await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: `Nido ${account}`, id: window.location.hostname },
          user: { id: userId, name: account, displayName: `Nido ${account.slice(0, 6)}` },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          attestation: 'none',
          timeout: 60_000,
        },
      })) as PublicKeyCredential | null;
      if (!created) throw new Error('Passkey creation was cancelled.');
      const reg = parseRegistration(created as never);
      const verifier = await fetchVerifierAddress(account);
      let zkEnrollment: perch.ReplacementSet['zkEnrollment'];
      if (zkMode) {
        status.textContent = 'Creating your new recovery kit…';
        const fresh = await newRecoveryKit(account);
        zkEnrollment = { id: fresh.enrollment.enrollmentId, commitment: fresh.enrollment.commitment };
        downloadKit(fresh.kit);
        if (!confirm('Your new recovery kit downloaded. Keep it safe: it replaces your old one once recovery finishes. Continue?')) {
          throw new Error('Recovery not started.');
        }
      }
      const slot = (body.querySelector('[name="slot"]') as HTMLSelectElement).value;
      const replacements: perch.ReplacementSet = {
        signers: [{ signerId: slot, credential: { kind: 'external', verifier, key: reg.publicKey } }],
        zkEnrollment,
      };
      const action = (body.querySelector('[name="stolen"]') as HTMLInputElement | null)?.checked ? 'compromise' : 'lost-key';
      status.textContent = 'Opening your recovery…';
      const client = recoveryClient();
      const op = action === 'lost-key'
        ? await client.beginLostKey(account, replacements)
        : await client.beginCompromise(account, replacements);
      const { retval } = await submitOpen(op.operations[0]!);
      const attemptId = retval ? String(scValToNative(retval)) : undefined;
      savePending(account, {
        action,
        attemptId,
        credentialId: b64u(reg.credentialId),
        publicKey: buf2hex(reg.publicKey),
        replacements: replacementsToWire(replacements),
      });
      done();
    }),
  );
  return c;
}

function downloadKit(kit: RecoveryKit): void {
  const a = el('a', { href: URL.createObjectURL(kitFile(kit)), download: `nido-recovery-kit-${kit.account.slice(0, 6)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

/** Steps 3-4: evidence, the wait, and the completion. */
async function progressCard(
  account: string,
  pending: Pending,
  s: NonNullable<Awaited<ReturnType<typeof readRecoveryState>>['summary']>,
): Promise<HTMLElement> {
  const client = recoveryClient();
  const attemptId = BigInt(pending.attemptId ?? (await client.nextAttemptId(account)) - 1n);
  const c = card('Your recovery', '');
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  const attempt = await client.attempt(account, attemptId);
  const live = await client.activityGate(account);
  if (!attempt) {
    body.append(el('p', { style: 'margin:0;' }, 'This recovery attempt no longer exists.'));
    body.append(resetButton(account));
    return c;
  }

  const state = attempt.state.tag;
  if (state === 'Completed') {
    body.append(el('p', { style: 'margin:0;' }, 'Recovery finished. Your new passkey runs this Nido.'));
    saveCredential(account, fromB64u(pending.credentialId), Uint8Array.from(pending.publicKey.match(/../g)!.map((x) => parseInt(x, 16))));
    savePending(account, undefined);
    body.append(el('a', { class: 'btn primary', href: '/account/' }, 'Open my Nido'));
    return c;
  }
  if (state === 'Cancelled' || !(await client.attemptLive(account, attemptId))) {
    body.append(el('p', { style: 'margin:0;' }, 'This recovery was cancelled or expired. You can start again.'));
    body.append(resetButton(account));
    return c;
  }

  if (state === 'Collecting') {
    const need = condition(s);
    body.append(
      el('p', { style: 'margin:0;font-size:13.5px;' }, 'Waiting for approval. ' +
        (need.guardians ? `${attempt.guardians.length} of ${need.guardians} friends approved. ` : '') +
        (need.zk ? (attempt.zk_nullifier ? 'Recovery kit proof recorded.' : 'Prove it with your current recovery kit.') : '')),
    );
    if (need.guardians) {
      body.append(el('div', { style: 'font-size:13px;' }, 'Send each friend their link. They will see your new passkey’s key to compare with you:'));
      body.append(
        guardianLinks(s.guardians, {
          kind: 'attempt',
          account,
          attemptId: attemptId.toString(),
          domain: 'initiate',
          replacements: pending.replacements,
        }),
      );
    }
    if (need.zk && !attempt.zk_nullifier) {
      body.append(
        kitInput((kit) =>
          void (async () => {
            try {
              const statement = await client.statement(account, attemptId, perch.EvidenceDomain.Initiate);
              const evidence = await proveWithKit(kit, statement, (step) => (status.textContent = step));
              const op = await client.submitZk(account, attemptId, perch.EvidenceDomain.Initiate, evidence);
              await submitOpen(op.operations[0]!);
              toast({ msg: 'Proof recorded', icon: 'check' });
              location.reload();
            } catch (e) {
              status.textContent = errorText(e);
            }
          })(),
        ),
      );
    }
    body.append(status);
    setTimeout(() => location.reload(), 15_000);
    return c;
  }

  // Authorized: wait out the delay, then complete.
  const ledger = await latestLedger();
  const remaining = attempt.executable_after - ledger;
  if (remaining > 0) {
    body.append(
      el('p', { style: 'margin:0;font-size:13.5px;' },
        `Approved. You can finish in about ${esc(ledgersToText(remaining))} ` +
        `(ledger ${attempt.executable_after}).` + (live.frozen ? ' The Nido is frozen until then.' : '')),
    );
    setTimeout(() => location.reload(), Math.min(remaining * SECONDS_PER_LEDGER * 1_000, 60_000));
    return c;
  }
  const finish = el('button', { class: 'btn primary', type: 'button' }, 'Finish recovery') as HTMLButtonElement;
  body.append(el('p', { style: 'margin:0;font-size:13.5px;' }, 'The waiting period is over.'), finish, status);
  finish.addEventListener('click', () =>
    busy(finish, status, 'Finishing…', async () => {
      const replacements = replacementsFromWire(pending.replacements);
      const target = await client.deriveTarget(account, pending.action, replacements);
      const ruleId = await client.recoveryRuleId(account);
      if (ruleId === undefined) throw new Error('This Nido has no recovery rule.');
      const op = await client.completion(account, target, ruleId, await latestLedger());
      await submitOpen(op.operations[0]!);
      location.reload();
    }),
  );
  return c;
}

function resetButton(account: string): HTMLButtonElement {
  const b = el('button', { class: 'btn ghost sm', type: 'button' }, 'Start over') as HTMLButtonElement;
  b.addEventListener('click', () => {
    savePending(account, undefined);
    location.reload();
  });
  return b;
}
