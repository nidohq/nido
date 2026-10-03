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
 * attempt's `replacements_hash`, a proposed recovery member against the
 * change's config hash. The chain checks the rest (the guardian must be
 * enrolled, the statement fresh, the attempt live).
 */

import { contractIdFromHostname, isContractId, parsePolicyDocJson, perch, type PolicyDoc } from '@nidohq/passkey-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { connect as connectWallet, initWalletKit } from '../walletConnect.js';
import { applyDoc, currentOrFirstDoc, GUARDIAN_RULE, recoveryClient, submitAsGuardian, readRecoveryState } from './chain.js';
import { perchDeployment, requireDeployment } from './deployment.js';
import {
  changeSubject,
  decodeGuardianRequest,
  foreignVerifiers,
  hex,
  replacementsFromWire,
  summarizeRecovery,
  type GuardianRequest,
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
  root.append(card(`A request from ${short(request.account)}`, details));

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
          await applyDoc(nidoGuardian, withGuardianRule(await currentOrFirstDoc(nidoGuardian)));
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

/** A human description of the request, with its payload verified. */
async function describe(request: GuardianRequest, doc: PolicyDoc): Promise<string> {
  const client = recoveryClient();
  if (request.kind === 'attempt') {
    const statement = await client.statement(
      request.account,
      BigInt(request.attemptId),
      request.domain === 'cancel' ? perch.EvidenceDomain.Cancel : perch.EvidenceDomain.Initiate,
    );
    if (request.domain === 'cancel') {
      return `<p style="margin:0;">Cancel recovery attempt ${esc(request.attemptId)}. Approve only if your friend says they did not start it.</p>`;
    }
    const sub = statement.subject;
    let who = '<p class="mut" style="margin:0;">The link does not say which new passkey would take over. Ask your friend for a fresh link.</p>';
    if (request.replacements && (sub.action === 'lost-key' || sub.action === 'compromise')) {
      const declared = perch.replacementSetHash(perch.sortReplacements(replacementsFromWire(request.replacements)));
      if (hex(declared) !== hex(sub.replacementsHash)) {
        return '<div class="alert danger" role="alert">This link’s replacement does not match the attempt on chain. Do not approve.</div>';
      }
      if (foreignVerifiers(request.replacements, requireDeployment().webauthnVerifier).length) {
        return '<div class="alert danger" role="alert">This link’s new passkey is checked by an unknown contract, not Nido’s passkey verifier. Do not approve.</div>';
      }
      who = request.replacements.signers
        .map((r) => `<p style="margin:0;">New passkey for <strong>${esc(r.signerId)}</strong> ends in <code class="mono">${esc(r.key.slice(-12))}</code>. Ask your friend to read you the same ending from their new device.</p>`)
        .join('');
    }
    const what = sub.action === 'compromise' ? 'restore their saved setup (they say their passkey was stolen)' : 'replace a lost passkey';
    return `<p style="margin:0;">Your friend wants to ${what}.</p>${who}`;
  }
  const c = request.change;
  if (c.kind === 'upgrade') {
    return `<p style="margin:0;">Upgrade the Nido’s code to Wasm <code class="mono">${esc(c.wasmHash.slice(0, 16))}…</code>. It runs only after a seven-day wait.</p>`;
  }
  if (c.kind === 'reconfigure-remove') {
    return '<p style="margin:0;">Turn recovery off. Approve only if your friend asked you to.</p>';
  }
  const proposed = request.recovery;
  if (proposed !== undefined) {
    const next = perch.withRecovery(doc, undefined);
    const withProposed = parsePolicyDocJson(JSON.stringify({ ...next, recovery: proposed }));
    const computed = perch.configHash(withProposed);
    if (!computed || hex(computed) !== c.configHash) {
      return '<div class="alert danger" role="alert">The proposed settings in this link do not match the request. Do not approve.</div>';
    }
    const s = summarizeRecovery(withProposed)!;
    return `<p style="margin:0;">Change recovery to: ${esc(s.profile)}, ${esc(s.mode)}${
      s.guardians.length ? `, ${s.quorum} of ${s.guardians.length} friends` : ''
    }.</p>`;
  }
  return '<p style="margin:0;">Change the Nido’s recovery settings.</p>';
}

async function hasGuardianRule(account: string): Promise<boolean> {
  const json = await recoveryClient().appliedDoc(account);
  if (!json) return false;
  const doc = parsePolicyDocJson(json);
  const controller = requireDeployment().recoveryController;
  return doc.rules.some((r) => r.name === GUARDIAN_RULE && r.scope.type === 'contract' && r.scope.address === controller);
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
