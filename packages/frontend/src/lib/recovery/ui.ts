/**
 * Shared pieces of the recovery pages: small DOM builders, the guardian
 * request links, the recovery-kit input, and the panel that collects a
 * `Protected` account's condition for a change (guardian approvals and/or a
 * ZK proof, recorded on chain before the owner applies the change).
 */

import { accountUrl, perch, stripSubdomain } from '@nidohq/passkey-sdk';
import { esc } from '../html.js';
import { toast } from '../toast.js';
import { latestLedger, recoveryClient, submitOpen } from './chain.js';
import {
  changeToRequest,
  encodeGuardianRequest,
  parseRecoveryKit,
  type Condition,
  type GuardianRequest,
  type RecoveryKit,
} from './model.js';
import { proveWithKit } from './zk.js';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  html = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.innerHTML = html;
  return node;
}

export function card(title: string, body = ''): HTMLElement {
  const section = el('section');
  section.append(
    el('span', { class: 'section-label', style: 'display:block;margin:22px 0 10px;' }, esc(title)),
  );
  const c = el('div', { class: 'card', style: 'padding:18px;display:grid;gap:12px;' }, body);
  section.append(c);
  return section;
}

export function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run `fn` with `button` disabled and a status line, toasting failures. */
export async function busy(
  button: HTMLButtonElement,
  status: HTMLElement,
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  button.disabled = true;
  status.textContent = label;
  try {
    await fn();
  } catch (e) {
    status.textContent = errorText(e);
    toast({ msg: errorText(e), icon: 'alert' });
  } finally {
    button.disabled = false;
  }
}

/** The link that opens `request` on `guardian`'s own Nido (its passkey can
 *  only sign on its own subdomain), or on the apex for a `G…` wallet. */
export function guardianLink(guardian: string, request: GuardianRequest): string {
  const host = stripSubdomain(window.location.host);
  const path = `/security/guardian/#${encodeGuardianRequest(request)}`;
  return guardian.startsWith('G')
    ? `${window.location.protocol}//${host}${path}`
    : `${window.location.protocol}${accountUrl(host, guardian, path)}`;
}

/** A list of copyable links, one per guardian. */
export function guardianLinks(guardians: string[], request: GuardianRequest): HTMLElement {
  const list = el('div', { style: 'display:grid;gap:8px;' });
  for (const g of guardians) {
    const url = guardianLink(g, request);
    const row = el(
      'div',
      { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' },
      `<code class="mono" style="font-size:12px;">${esc(short(g))}</code>`,
    );
    const copy = el('button', { class: 'btn ghost sm', type: 'button', 'data-link': url }, 'Copy link');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(url).then(() => toast({ msg: 'Link copied', icon: 'check' }));
    });
    row.append(copy);
    list.append(row);
  }
  return list;
}

/** A paste-or-upload input for a recovery kit. */
export function kitInput(onKit: (kit: RecoveryKit) => void): HTMLElement {
  const wrap = el('div', { style: 'display:grid;gap:8px;' });
  const text = el('textarea', {
    class: 'input mono',
    rows: '3',
    placeholder: 'Paste your recovery kit, or choose the file below',
    style: 'width:100%;font-size:12px;',
  });
  const file = el('input', { type: 'file', accept: 'application/json' });
  const use = (raw: string) => {
    try {
      onKit(parseRecoveryKit(raw));
    } catch (e) {
      toast({ msg: errorText(e), icon: 'alert' });
    }
  };
  text.addEventListener('change', () => use(text.value));
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) void f.text().then(use);
  });
  wrap.append(text, file);
  return wrap;
}

/**
 * Collect the enrolled condition for `change`, then resolve with the
 * `approval_valid_until` the evidence was recorded for. Guardians record
 * approvals from their own Nidos (the links); the ZK half is proved here
 * from the owner's recovery kit. Resolves once the chain shows enough.
 */
export async function collectCondition(
  root: HTMLElement,
  account: string,
  change: perch.ChangeSubject,
  condition: Condition,
  guardians: string[],
  expiryLedgers: number,
  extra: { recovery?: unknown } = {},
): Promise<number> {
  const client = recoveryClient();
  // Fresh for a day (or the enrolled window, if shorter).
  const validUntil = (await latestLedger()) + Math.min(expiryLedgers, 17_280);
  const statement = await client.changeStatement(account, change, validUntil);
  const digest = perch.statementDigest(statement);

  const panel = el('div', { class: 'alert', role: 'status', style: 'display:grid;gap:10px;' });
  panel.append(
    el(
      'div',
      {},
      '<strong>Your helpers need to approve this change.</strong> ' +
        'This Nido is protected against key theft, so your passkey alone cannot change recovery.',
    ),
  );
  const progress = el('div', { class: 'mut', style: 'font-size:12.5px;' });
  panel.append(progress);
  if (condition.guardians > 0) {
    panel.append(
      el('div', { style: 'font-size:13px;' }, `Send ${condition.guardians} of your friends their link:`),
      guardianLinks(guardians, {
        kind: 'change',
        account,
        change: changeToRequest(change),
        validUntil,
        ...extra,
      }),
    );
  }
  if (condition.zk) {
    panel.append(el('div', { style: 'font-size:13px;' }, 'Prove it with your recovery kit:'));
    panel.append(
      kitInput((kit) => {
        void (async () => {
          try {
            const evidence = await proveWithKit(kit, statement, (s) => (progress.textContent = s));
            const op = await client.submitZkChange(account, change, validUntil, evidence);
            await submitOpen(op.operations[0]!);
            toast({ msg: 'Proof recorded', icon: 'check' });
          } catch (e) {
            progress.textContent = errorText(e);
          }
        })();
      }),
    );
  }
  root.append(panel);

  for (;;) {
    const recorded = await client.changeEvidence(account, digest);
    const have = recorded.guardians.length;
    progress.textContent =
      (condition.guardians > 0 ? `${have} of ${condition.guardians} approvals. ` : '') +
      (condition.zk ? (recorded.zk ? 'Proof recorded.' : 'Proof not yet recorded.') : '');
    if (have >= condition.guardians && (!condition.zk || recorded.zk)) {
      panel.remove();
      return validUntil;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
