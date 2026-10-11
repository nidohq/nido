/**
 * `/security/guardian/`: a friend approves (or cancels) a recovery, or a
 * `Protected` change, for a Nido that named them as a guardian.
 *
 * A Nido guardian opens the link on its OWN subdomain: its passkey only
 * signs there, and the approval is the guardian account authorizing the
 * controller's `submit_guardian` / `approve_change` for one statement
 * digest, through a rule its own document scopes to the controller (the
 * page offers to add that rule first). A `G…` guardian opens it on the apex
 * and signs with a connected Stellar wallet.
 *
 * What is shown is checked, not trusted: the replacement passkey against the
 * attempt's `replacements_hash` (shown as a check code derived from the whole
 * key, for the guardian to compare with the friend), a proposed recovery
 * member against the change's config hash (shown setting by setting next to
 * the current one, since the hash binds all of it). The chain checks the
 * rest (the guardian must be enrolled, the statement fresh, the attempt
 * live).
 */

import { contractIdFromHostname, isContractId, parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { connect as connectWallet, initWalletKit } from '../walletConnect.js';
import { applyDoc, currentOrFirstDoc, GUARDIAN_RULE, recoveryClient, submitAsGuardian, readRecoveryState } from './chain.js';
import { readAccountConfiguration } from '../policyChainFetch.js';
import { perchDeployment, requireDeployment } from './deployment.js';
import {
  attemptLinkProblem,
  changeSubject,
  decodeGuardianRequest,
  hex,
  passkeyCheckCode,
  recoveryChangeRows,
  type GuardianRequest,
  type RecoveryChangeRow,
} from './model.js';
import { busy, card, el, errorText, short } from './ui.js';

export async function mountGuardian(root: HTMLElement): Promise<void> {
  if (!perchDeployment()) {
    root.append(el('div', { class: 'alert', role: 'note' }, 'Recovery is not deployed on this network yet.'));
    return;
  }
  let request: GuardianRequest;
  try {
    request = decodeGuardianRequest(window.location.hash);
  } catch (e) {
    root.append(el('div', { class: 'alert danger', role: 'alert' }, `This link is not a valid request: ${esc(errorText(e))}`));
    return;
  }
  const host = contractIdFromHostname(window.location.hostname);
  const nidoGuardian = host && isContractId(host) ? host : null;

  const state = await readRecoveryState(request.account);
  const summary = state.summary;
  if (!summary) {
    root.append(card('Request', '<p style="margin:0;">That Nido has no recovery set up.</p>'));
    return;
  }
  const details = await describe(request, state.doc!);
  root.append(card(`A request from ${short(request.account)}`, details.html));
  if (!details.ok) return;

  const c = card('Your approval', '');
  const body = c.querySelector('.card') as HTMLElement;
  const status = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  root.append(c);

  let guardian = nidoGuardian;
  if (!guardian) {
    const connect = el('button', { class: 'btn soft', type: 'button' }, 'Connect your Stellar wallet') as HTMLButtonElement;
    body.append(connect, status);
    await new Promise<void>((resolve) =>
      connect.addEventListener('click', () =>
        busy(connect, status, 'Connecting…', async () => {
          await initWalletKit();
          guardian = (await connectWallet()).walletAddress;
          connect.remove();
          resolve();
        }),
      ),
    );
  }
  if (!summary.guardians.includes(guardian!)) {
    body.append(el('p', { style: 'margin:0;' }, `${esc(short(guardian!))} is not one of this Nido’s guardians.`));
    return;
  }

  if (nidoGuardian && !(await hasGuardianRule(nidoGuardian))) {
    body.append(
      el('p', { style: 'margin:0;font-size:13px;' },
        'To approve recoveries, your Nido needs permission to sign at the recovery service. This adds one rule to your Nido; it cannot move your money.'),
    );
    const allow = el('button', { class: 'btn soft', type: 'button' }, 'Allow my Nido to approve recoveries') as HTMLButtonElement;
    body.append(allow, status);
    await new Promise<void>((resolve) =>
      allow.addEventListener('click', () =>
        busy(allow, status, 'Updating your Nido…', async () => {
          const own = await currentOrFirstDoc(nidoGuardian);
          await applyDoc(nidoGuardian, withGuardianRule(own.doc), { baseRevision: own.revision });
          allow.remove();
          status.textContent = '';
          resolve();
        }),
      ),
    );
  }

  const approve = el('button', { class: 'btn primary', type: 'button' },
    request.kind === 'attempt' && request.domain === 'cancel' ? 'Approve cancelling it' : 'Approve') as HTMLButtonElement;
  body.append(approve, status);
  approve.addEventListener('click', () =>
    busy(approve, status, 'Confirm with your passkey or wallet…', async () => {
      const client = recoveryClient();
      const op =
        request.kind === 'attempt'
          ? await client.submitGuardian(
              request.account,
              BigInt(request.attemptId),
              request.domain === 'cancel' ? perch.EvidenceDomain.Cancel : perch.EvidenceDomain.Initiate,
              guardian!,
            )
          : await client.approveChange(request.account, changeSubject(request.change), request.validUntil, guardian!);
      await submitAsGuardian(guardian!, op.operations[0]!);
      status.textContent = 'Approved. You can close this page.';
      toast({ msg: 'Approval recorded', icon: 'check' });
    }),
  );
}

/** A human description of the request, with its payload verified. `ok` is
 *  false when the guardian must not approve: the page then offers no
 *  Approve button. */
async function describe(request: GuardianRequest, doc: PolicyDoc): Promise<{ html: string; ok: boolean }> {
  const refuse = (why: string) => ({
    html: `<div class="alert danger" role="alert">${esc(why)} Do not approve.</div>`,
    ok: false,
  });
  const client = recoveryClient();
  if (request.kind === 'attempt') {
    const statement = await client.statement(
      request.account,
      BigInt(request.attemptId),
      request.domain === 'cancel' ? perch.EvidenceDomain.Cancel : perch.EvidenceDomain.Initiate,
    );
    if (request.domain === 'cancel') {
      return {
        html: `<p style="margin:0;">Cancel recovery attempt ${esc(request.attemptId)}. Approve only if your friend says they did not start it.</p>`,
        ok: true,
      };
    }
    const sub = statement.subject;
    if (sub.action !== 'lost-key' && sub.action !== 'compromise') {
      return refuse('This link does not name a recovery attempt.');
    }
    const problem = attemptLinkProblem(request.replacements, sub.replacementsHash, requireDeployment().webauthnVerifier);
    if (problem) return refuse(problem);
    const who = request.replacements!.signers
      .map((r) => `<p style="margin:0;">New passkey for <strong>${esc(r.signerId)}</strong> has check code <code class="mono">${esc(passkeyCheckCode(r.key))}</code>. Ask your friend to read you the check code their recovery page shows; approve only if every character matches.</p>`)
      .join('');
    const what = sub.action === 'compromise' ? 'restore their saved setup (they say their passkey was stolen)' : 'replace a lost passkey';
    return { html: `<p style="margin:0;">Your friend wants to ${what}.</p>${who}`, ok: true };
  }
  const c = request.change;
  if (c.kind === 'upgrade') {
    return {
      html: `<p style="margin:0;">Upgrade the Nido’s code to Wasm <code class="mono">${esc(c.wasmHash.slice(0, 16))}…</code>. It runs only after a seven-day wait.</p>`,
      ok: true,
    };
  }
  if (c.kind === 'reconfigure-remove') {
    return { html: '<p style="margin:0;">Turn recovery off. Approve only if your friend asked you to.</p>', ok: true };
  }
  const proposed = request.recovery;
  if (proposed === undefined) {
    return refuse('The link does not say what the new recovery settings are. Ask your friend for a fresh link.');
  }
  const next = perch.withRecovery(doc, undefined);
  const withProposed = parsePolicyDocJson(JSON.stringify({ ...next, recovery: proposed }));
  const computed = perch.configHash(withProposed);
  if (!computed || hex(computed) !== c.configHash) {
    return refuse('The proposed settings in this link do not match the request.');
  }
  const rows = recoveryChangeRows(doc.recovery, withProposed.recovery);
  const changed = rows.filter((r) => r.changed).length;
  return {
    html:
      `<p style="margin:0;">Your friend wants to change how their Nido recovers. ` +
      `${changed === 1 ? 'One setting changes' : `${changed} settings change`} (highlighted). ` +
      'Approve only if your friend told you about every change.</p>' +
      changeTable(rows),
    ok: true,
  };
}

/** Every setting the reconfiguration binds, the changed ones highlighted
 *  with their current and proposed values. Addresses and hashes are shown in
 *  full: a shortened one could be imitated. */
function changeTable(rows: RecoveryChangeRow[]): string {
  // `mark` flags the values the other side lacks: removed ones under Now,
  // added ones under Proposed.
  const values = (vs: string[], other: string[], mark = '') =>
    vs.length
      ? vs
          .map((v) => `<div class="mono" style="word-break:break-all;">${mark && !other.includes(v) ? `<strong>${mark} </strong>` : ''}${esc(v)}</div>`)
          .join('')
      : '<span class="mut">none</span>';
  const body = rows
    .map((r) => {
      const style = r.changed ? 'background:var(--warn-soft);' : '';
      const value = r.changed
        ? `<div class="mut" style="font-size:12px;">Now</div>${values(r.current, r.proposed, '−')}` +
          `<div class="mut" style="font-size:12px;margin-top:6px;">Proposed</div>${values(r.proposed, r.current, '+')}`
        : values(r.proposed, r.current);
      return `<tr data-setting="${esc(r.path)}"${r.changed ? ' data-changed' : ''} style="${style}">` +
        `<th scope="row" style="text-align:left;vertical-align:top;padding:6px 8px;font-weight:${r.changed ? 600 : 400};">${esc(r.label)}${r.changed ? ' (changes)' : ''}</th>` +
        `<td style="vertical-align:top;padding:6px 8px;font-size:12.5px;">${value}</td></tr>`;
    })
    .join('');
  return `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">${body}</table></div>`;
}

/** Whether `account` has the guardian rule installed: a rule named
 *  `guardian` scoped to the controller, as its `configuration()` reports
 *  (perch-js selection by name and scope). */
async function hasGuardianRule(account: string): Promise<boolean> {
  const controller = requireDeployment().recoveryController;
  return (await readAccountConfiguration(account)).rules.some(
    (r) => !r.recovery && r.name === GUARDIAN_RULE && r.contract === controller,
  );
}

/** `doc` with a rule letting its admin signers act at the controller. */
function withGuardianRule(doc: PolicyDoc): PolicyDoc {
  const admin = doc.rules.find((r) => r.scope.type === 'self-admin' && r.principals.type === 'all');
  if (!admin || admin.principals.type !== 'all') throw new Error('No admin rule to copy signers from.');
  return parsePolicyDocJson(
    JSON.stringify({
      ...doc,
      rules: [
        ...doc.rules.filter((r) => r.name !== GUARDIAN_RULE),
        {
          name: GUARDIAN_RULE,
          scope: { type: 'contract', address: requireDeployment().recoveryController },
          principals: { type: 'all', signers: admin.principals.signers },
        },
      ],
    }),
  );
}
