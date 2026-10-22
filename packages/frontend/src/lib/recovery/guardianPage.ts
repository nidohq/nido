/**
 * `/security/guardian/`: a friend approves (or cancels) a recovery, or a
 * `Protected` change, for a Nido that named them as a guardian.
 *
 * A Nido guardian opens the link on its OWN subdomain: its passkey only
 * signs there, and the approval is the guardian account authorizing the
 * controller's `submit_guardian` / `approve_change` for one statement
 * digest, through a rule its own document scopes to that controller (the
 * page offers to add that rule first). The controller is the one the
 * requesting account adopted, read from that account: after a Perch
 * redeploy it can be an earlier one than the deployment's, and a guardian
 * holds one rule per controller (`guardianRuleAt`). A `G…` guardian opens it
 * on the apex and signs with a connected Stellar wallet, which is handed the
 * transaction only if it authorizes exactly that approval and nothing
 * beneath it (`perch.guardianApprovalProblem`).
 *
 * What is shown is checked, not trusted: the replacement passkey against the
 * attempt's `replacements_hash` (shown as a check code derived from the whole
 * key, for the guardian to compare with the friend), a proposed recovery
 * member against the change's config hash (shown setting by setting next to
 * the current one, since the hash binds all of it, with any move of trust
 * called out above the table). Approve sends the subject the page checked,
 * stated in full beside the button. The chain checks the rest (the guardian
 * must be enrolled, the statement fresh, the attempt live).
 */

import { contractIdFromHostname, isContractId, parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { connect as connectWallet, initWalletKit } from '../walletConnect.js';
import { applyDoc, currentOrFirstDoc, recoveryClient, submitAsGuardian, readRecoveryState } from './chain.js';
import { readAccountConfiguration } from '../policyChainFetch.js';
import { perchDeployment, requireDeployment } from './deployment.js';
import {
  attemptLinkProblem,
  changeSubject,
  decodeGuardianRequest,
  guardianRuleAt,
  hex,
  newGuardianRuleName,
  passkeyCheckCode,
  recoveryChangeRows,
  trustChanges,
  type GuardianRequest,
  type RecoveryChangeRow,
  type TrustChange,
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
  // Where the approval goes: the controller the account adopted.
  const controller = state.wiring.controller;
  const details = await describe(request, state.doc!, controller);
  root.append(card(`A request from ${short(request.account)}`, details.html));
  if (!details.ok) return;

  const c = card('Your approval', details.signs);
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

  let rule = nidoGuardian ? await guardianRuleOf(nidoGuardian, controller) : undefined;
  if (nidoGuardian && !rule) {
    body.append(
      el('p', { style: 'margin:0;font-size:13px;' },
        'To approve this Nido’s recoveries, your Nido needs permission to sign at its recovery service ' +
          `<code class="mono" style="word-break:break-all;">${esc(controller)}</code>` +
          (controller === requireDeployment().recoveryController ? '' : ', an earlier one than Nido sets up today') +
          '. This adds one rule to your Nido; it cannot move your money.'),
    );
    const allow = el('button', { class: 'btn soft', type: 'button' }, 'Allow my Nido to approve recoveries') as HTMLButtonElement;
    body.append(allow, status);
    await new Promise<void>((resolve) =>
      allow.addEventListener('click', () =>
        busy(allow, status, 'Updating your Nido…', async () => {
          const own = await currentOrFirstDoc(nidoGuardian);
          const added = withGuardianRule(own.doc, controller);
          await applyDoc(nidoGuardian, added.doc, { baseRevision: own.revision });
          rule = added.name;
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
          : await client.approveChange(request.account, details.subject!, request.validUntil, guardian!);
      // Everything a `G…` guardian's signature may authorize: the approval,
      // at this controller, of the attempt statement checked above or of
      // the change statement for the subject Approve sends.
      const statement =
        request.kind === 'attempt'
          ? details.statement!
          : await client.changeStatement(request.account, details.subject!, request.validUntil);
      const approval: perch.GuardianApproval = {
        controller,
        fn: request.kind === 'attempt' ? 'submit_guardian' : 'approve_change',
        digest: perch.statementDigest(statement),
      };
      await submitAsGuardian(guardian!, op.operations[0]!, approval, rule);
      status.textContent = 'Approved. You can close this page.';
      toast({ msg: 'Approval recorded', icon: 'check' });
    }),
  );
}

/** A request as the page checked it. */
interface Described {
  /** A human description, with the request's payload verified. */
  html: string;
  /** False when the guardian must not approve: the page then offers no
   *  Approve button. */
  ok: boolean;
  /** What an approval signs, in full, shown beside the Approve button. */
  signs: string;
  /** For a change: the subject Approve sends, the one checked here. */
  subject?: perch.ChangeSubject;
  /** For an attempt: the statement checked here, which Approve signs. */
  statement?: perch.RecoveryStatement;
}

/** `value` in full, selectable in one tap so it can be copied whole. */
function full(value: string): string {
  return `<code class="mono" style="word-break:break-all;user-select:all;">${esc(value)}</code>`;
}

/** Describe `request`, verifying what it carries. `controller` is the one
 *  the account adopted, where an approval is recorded. */
async function describe(request: GuardianRequest, doc: PolicyDoc, controller: string): Promise<Described> {
  const refuse = (why: string): Described => ({
    html: `<div class="alert danger" role="alert">${esc(why)} Do not approve.</div>`,
    ok: false,
    signs: '',
  });
  const client = recoveryClient();
  if (request.kind === 'attempt') {
    const statement = await client.statement(
      request.account,
      BigInt(request.attemptId),
      request.domain === 'cancel' ? perch.EvidenceDomain.Cancel : perch.EvidenceDomain.Initiate,
    );
    const signs =
      `<p style="margin:0;font-size:13px;">Approving signs ${request.domain === 'cancel' ? 'cancelling' : 'starting'} recovery attempt ` +
      `${esc(request.attemptId)} of the Nido ${full(request.account)}, at the recovery controller ${full(controller)}.</p>`;
    if (request.domain === 'cancel') {
      return {
        html: `<p style="margin:0;">Cancel recovery attempt ${esc(request.attemptId)}. Approve only if your friend says they did not start it.</p>`,
        ok: true,
        signs,
        statement,
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
    return { html: `<p style="margin:0;">Your friend wants to ${what}.</p>${who}`, ok: true, signs, statement };
  }
  const c = request.change;
  const signsChange = (subject: perch.ChangeSubject, what: string): string =>
    `<p data-approves="${esc(subject.kind === 'reconfigure-set' ? hex(subject.configHash) : subject.kind)}" style="margin:0;font-size:13px;">` +
    `Approving signs ${what} for the Nido ${full(request.account)}, valid until ledger ${request.validUntil}, ` +
    `recorded at the recovery controller ${full(controller)}.</p>`;
  if (c.kind === 'upgrade') {
    const subject = changeSubject(c);
    return {
      html: `<p style="margin:0;">Upgrade the Nido’s code to Wasm ${full(c.wasmHash)}. It runs only after a seven-day wait.</p>`,
      ok: true,
      signs: signsChange(subject, `upgrade request ${esc(c.requestId)} to Wasm ${full(c.wasmHash)}`),
      subject,
    };
  }
  if (c.kind === 'reconfigure-remove') {
    const subject = changeSubject(c);
    return {
      html: '<p style="margin:0;">Turn recovery off. Approve only if your friend asked you to.</p>',
      ok: true,
      signs: signsChange(subject, 'turning recovery off'),
      subject,
    };
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
  // The subject is the hash of the settings shown, never the link's string.
  const subject: perch.ChangeSubject = { kind: 'reconfigure-set', configHash: computed };
  return {
    html:
      `<p style="margin:0;">Your friend wants to change how their Nido recovers. ` +
      `${changed === 1 ? 'One setting changes' : `${changed} settings change`} (highlighted). ` +
      'Approve only if your friend told you about every change.</p>' +
      trustAlert(trustChanges(rows, requireDeployment())) +
      changeTable(rows),
    ok: true,
    signs: signsChange(subject, `the recovery settings above (configuration ${full(hex(computed))})`),
    subject,
  };
}

/** The moves of trust, above the table: who or what would decide a
 *  recovery from now on. Empty when nothing moves. */
function trustAlert(changes: TrustChange[]): string {
  if (!changes.length) return '';
  const lines = (vs: string[], mark: string) => vs.map((v) => `<div><strong>${mark} </strong>${full(v)}</div>`).join('');
  const items = changes
    .map(
      (t) =>
        `<li data-trust="${esc(t.path)}" style="margin:8px 0 0;"><strong>${esc(t.label)}</strong>` +
        lines(t.removed, '−') +
        lines(t.added, '+') +
        (t.expected === undefined ? '' : `<div><strong>Not the one Nido sets up today</strong> (${full(t.expected)}).</div>`) +
        '</li>',
    )
    .join('');
  // One block child: `.alert` lays its children out in a row.
  return (
    '<div class="alert danger" role="note" data-trust-changes><div style="min-width:0;">' +
    '<strong>This hands recovery to someone or something new.</strong> ' +
    'Whoever controls these decides a recovery. Approve only if your friend named each one to you.' +
    `<ul style="margin:0;padding-left:18px;font-weight:400;">${items}</ul></div></div>`
  );
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
          .map((v) => `<div>${mark && !other.includes(v) ? `<strong>${mark} </strong>` : ''}${full(v)}</div>`)
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

/** The name of `account`'s guardian rule scoped to `controller`, as its
 *  `configuration()` reports it (perch-js selection by name and scope). */
async function guardianRuleOf(account: string, controller: string): Promise<string | undefined> {
  return guardianRuleAt((await readAccountConfiguration(account)).rules, controller);
}

/** `doc` with a rule letting its admin signers act at `controller`, beside
 *  any guardian rules it holds for other controllers. */
function withGuardianRule(doc: PolicyDoc, controller: string): { doc: PolicyDoc; name: string } {
  const admin = doc.rules.find((r) => r.scope.type === 'self-admin' && r.principals.type === 'all');
  if (!admin || admin.principals.type !== 'all') throw new Error('No admin rule to copy signers from.');
  const name = newGuardianRuleName(doc.rules.map((r) => r.name), controller);
  return {
    name,
    doc: parsePolicyDocJson(
      JSON.stringify({
        ...doc,
        rules: [
          ...doc.rules,
          {
            name,
            scope: { type: 'contract', address: controller },
            principals: { type: 'all', signers: admin.principals.signers },
          },
        ],
      }),
    ),
  };
}
