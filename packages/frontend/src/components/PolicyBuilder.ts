// The policy builder: compose a policy-document update and apply it.
//
// DOC-ONLY by ruling: every policy write goes through the account's
// one-transaction `apply_doc` surface (`buildApplyDocTx`). Two tabs:
//
// - **Session key** — the canned v1 template: one scoped session key (a
//   delegated signer restricted to one contract's named functions, with an
//   expiry) plus an optional cumulative spending cap, UPSERTED into the
//   account's applied document.
// - **Admin keys** — enroll another ADMIN key (a brand-new passkey created
//   via the WebAuthn ceremony, or a pasted external/delegated key) as a
//   policy-free self-admin rule — the same shape the contract's anti-brick
//   check requires — or remove one (never the last: the account must keep
//   an admin authority, and the contract would refuse such a document).
//
// `apply_doc` replaces the whole document, so every submit is an update
// against a loaded BASELINE (the applied doc, or the owner-admin baseline
// on a first apply), and every preview shows the full merged document
// (canonical JSON + doc_hash) AND the diff against the applied one —
// exactly what changes — before the user confirms. Validation and the
// merge/diff logic live in the pure libs (lib/policy/docDraft,
// lib/policy/docDiff); submission goes through the account's existing
// passkey signing path (signAndSubmit). This module never signs silently.

import {
  buildApplyDocTx,
  canonicalJson,
  createSessionPasskey,
  docHash,
  parsePolicyDocJson,
  type PolicyDoc,
} from '@nidohq/passkey-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { esc } from '../lib/html.js';
import { toast } from '../lib/toast.js';
import { RPC_URL } from '../lib/network.js';
import { fetchDefaultRuleAuthInfo, fetchVerifierAddress } from '../lib/policyChainFetch.js';
import { fetchAppliedDocJson, fetchDocSurface, toHex } from '../lib/policy/docPolicyFetch.js';
import { stroopsFromXlm, PERIOD_LEDGERS } from '../lib/spendingLimitParams.js';
import { signAndSubmit } from '../lib/primaryPasskeySigner.js';
import {
  addAdminKey,
  adminRules,
  nextAdminRuleName,
  ownerAdminBaseline,
  removeAdminRule,
  upsertSessionRule,
  validateAdminKeyDraft,
  validateSessionDocDraft,
  type AdminKeyDraft,
  type SessionDocDraft,
} from '../lib/policy/docDraft.js';
import { diffPolicyDocs } from '../lib/policy/docDiff.js';
import { bytesToHex, truncate } from '../lib/policy/policyView.js';
import { summarizeDoc } from '../lib/policy/docView.js';
import { renderDocDiffHtml, renderDocPreviewHtml } from './PolicyInspector.js';

const NETWORK_PASSPHRASE = Networks.TESTNET;

interface BuilderOptions {
  account: string;
  /** Called after a document is successfully applied, so the page can refresh. */
  onSubmitted?: () => void;
}

type BuilderTab = 'session' | 'admin';

export function mountPolicyBuilder(container: HTMLElement, opts: BuilderOptions): void {
  // The merge baseline for every submit and the diff's "before" side:
  // the applied document, or — on a first apply — the synthesized
  // owner-admin baseline (apply_doc replaces EVERY rule and refuses docs
  // without a policy-free self-admin rule, so the account's own passkey
  // must ride along from the start).
  let baselineDoc: PolicyDoc | null = null;
  /** True when nothing is applied yet (diff renders all-new). */
  let isFirstApply = false;
  /** Human-readable reason the baseline could not be established — the
   *  builder fails closed rather than applying over an unknown state. */
  let baselineBlocked: string | null = null;
  let baselineLoaded = false;

  let tab: BuilderTab = 'session';
  /** Admin tab: the rule name staged for removal, or null (add mode). */
  let pendingRemoval: string | null = null;

  let sessionWrap: HTMLElement;
  let adminWrap: HTMLElement;

  const baselineReady: Promise<void> = (async () => {
    try {
      const surface = await fetchDocSurface(opts.account);
      if (!surface.supported) {
        baselineBlocked =
          "This account's contract has no policy-document surface — it cannot take document updates.";
      } else if (surface.appliedDocHash !== null) {
        const recovered = await fetchAppliedDocJson(opts.account, toHex(surface.appliedDocHash));
        if (recovered !== null) baselineDoc = parsePolicyDocJson(recovered.json);
        else {
          baselineBlocked =
            'The applied policy document could not be read — cannot build a safe update.';
        }
      } else {
        // First apply: anchor the anti-brick admin rule on the account's
        // live primary passkey (the constructor default rule).
        const info = await fetchDefaultRuleAuthInfo(opts.account);
        const passkey = info.externalSigners[0];
        if (passkey === undefined) {
          baselineBlocked =
            "Could not read the account's primary passkey — a first document must carry it (anti-brick).";
        } else {
          baselineDoc = ownerAdminBaseline(
            { verifier: passkey.verifier, publicKeyHex: bytesToHex(passkey.publicKey) },
            NETWORK_PASSPHRASE,
          );
          isFirstApply = true;
        }
      }
    } catch (e) {
      baselineBlocked = `Could not read the account's policy state: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      baselineLoaded = true;
    }
  })();

  // After a successful apply the new document IS the applied one.
  function adoptApplied(doc: PolicyDoc): void {
    baselineDoc = doc;
    isFirstApply = false;
    pendingRemoval = null;
  }

  function render(): void {
    container.innerHTML = `
      <div class="pol-mode-tabs" role="tablist" style="display:flex;gap:8px;margin-bottom:14px;">
        <button type="button" id="pol-tab-session" role="tab" class="btn sm" aria-selected="false">Session key</button>
        <button type="button" id="pol-tab-admin" role="tab" class="btn sm" aria-selected="false">Admin keys</button>
      </div>
      <div id="pol-session-wrap"></div>
      <div id="pol-admin-wrap"></div>`;
    sessionWrap = container.querySelector<HTMLElement>('#pol-session-wrap')!;
    adminWrap = container.querySelector<HTMLElement>('#pol-admin-wrap')!;
    renderSessionForm();
    renderAdminPanel();
    const sessionTab = container.querySelector<HTMLButtonElement>('#pol-tab-session')!;
    const adminTab = container.querySelector<HTMLButtonElement>('#pol-tab-admin')!;
    const applyTab = () => {
      sessionWrap.hidden = tab !== 'session';
      adminWrap.hidden = tab !== 'admin';
      sessionTab.className = `btn sm ${tab === 'session' ? 'soft' : 'ghost'}`;
      adminTab.className = `btn sm ${tab === 'admin' ? 'soft' : 'ghost'}`;
      sessionTab.setAttribute('aria-selected', String(tab === 'session'));
      adminTab.setAttribute('aria-selected', String(tab === 'admin'));
    };
    sessionTab.addEventListener('click', () => { tab = 'session'; applyTab(); });
    adminTab.addEventListener('click', () => { tab = 'admin'; applyTab(); });
    applyTab();
  }

  // ==== Session-key tab ======================================================

  function renderSessionForm(): void {
    sessionWrap.innerHTML = `
      <form class="nido-form pol-builder" novalidate>
        <p class="mut" style="font-size:12.5px;margin:0 0 4px;line-height:1.55;">
          The template: one <strong>scoped session key</strong> — a delegated key
          limited to one contract's named functions, with an optional expiry and
          spending cap. Saved into the account's policy <em>document</em>
          (one <code>apply_doc</code> transaction), so this page can show exactly
          what you approved, verified against the hash stored on chain.
        </p>

        <label class="pol-input-label">Rule name
          <input name="doc-name" class="input" maxlength="32" value="session" />
        </label>
        <label class="pol-input-label">Session key (C… or G…)
          <input name="doc-signer" class="input pol-mono" placeholder="G… or C… address of the delegated key" />
        </label>
        <label class="pol-input-label">Target contract
          <input name="doc-contract" class="input pol-mono" placeholder="C… contract the key may call" />
        </label>
        <label class="pol-input-label">Allowed functions
          <input name="doc-functions" class="input pol-mono" placeholder="e.g. update_message, transfer — empty allows any" />
        </label>

        <label class="pol-check">
          <input type="checkbox" name="doc-expiry-on" /> Set an expiry
        </label>
        <div id="pol-doc-expiry-fields" class="pol-limit" hidden>
          <input name="doc-expiry-ledger" class="input" inputmode="numeric" placeholder="Not-after ledger sequence" />
        </div>

        <label class="pol-check">
          <input type="checkbox" name="doc-cap-on" /> Attach a spending cap
        </label>
        <div id="pol-doc-cap-fields" class="pol-limit" hidden>
          <input name="doc-cap-xlm" class="input" inputmode="decimal" placeholder="Amount (XLM)" />
          <select name="doc-cap-period" class="input">
            <option value="day">per day</option>
            <option value="week">per week</option>
            <option value="30d">per 30 days</option>
          </select>
        </div>

        <div class="pol-fieldset">
          <span class="pol-field-label">What changes</span>
          <div id="pol-doc-prev-diff" class="mut" style="font-size:12.5px;">Reading the applied document…</div>
        </div>

        <div class="pol-fieldset">
          <span class="pol-field-label">Document preview (after this update)</span>
          <div class="pol-field-val" style="gap:6px;">
            <span class="pol-field-label" style="text-transform:none;letter-spacing:0;">doc_hash</span>
            <code id="pol-doc-prev-hash" class="pol-mono">—</code>
          </div>
          <div id="pol-doc-prev-doc" class="mut" style="font-size:12.5px;">—</div>
        </div>

        <div id="pol-doc-errors" class="alert danger" role="alert" hidden style="margin-top:10px;"></div>

        <div class="actions" style="display:flex;gap:8px;margin-top:14px;">
          <button type="submit" id="pol-doc-submit" class="btn soft sm">Apply document update</button>
        </div>
        <p id="pol-doc-status" class="mut" style="font-size:12px;margin-top:8px;"></p>
      </form>`;
    wireSessionForm();
  }

  function collectDraft(): SessionDocDraft {
    const q = <T extends HTMLElement>(sel: string) => sessionWrap.querySelector<T>(sel);
    const expiryOn = q<HTMLInputElement>('input[name="doc-expiry-on"]')?.checked ?? false;
    const capOn = q<HTMLInputElement>('input[name="doc-cap-on"]')?.checked ?? false;

    let notAfterLedger: number | null = null;
    if (expiryOn) {
      const n = Number(q<HTMLInputElement>('input[name="doc-expiry-ledger"]')?.value);
      notAfterLedger = Number.isFinite(n) ? n : NaN;
    }
    let cap: SessionDocDraft['cap'] = null;
    if (capOn) {
      const xlm = q<HTMLInputElement>('input[name="doc-cap-xlm"]')?.value ?? '';
      const period = (q<HTMLSelectElement>('select[name="doc-cap-period"]')?.value ??
        'day') as keyof typeof PERIOD_LEDGERS;
      let stroops = '0';
      try {
        stroops = stroopsFromXlm(xlm).toString();
      } catch {
        stroops = '0';
      }
      cap = { stroops, periodLedgers: PERIOD_LEDGERS[period] };
    }
    return {
      name: q<HTMLInputElement>('input[name="doc-name"]')?.value ?? '',
      signer: {
        kind: 'delegated',
        address: q<HTMLInputElement>('input[name="doc-signer"]')?.value.trim() ?? '',
      },
      targetContract: q<HTMLInputElement>('input[name="doc-contract"]')?.value.trim() ?? '',
      functionsInput: q<HTMLInputElement>('input[name="doc-functions"]')?.value ?? '',
      notAfterLedger,
      cap,
    };
  }

  /** The merged document for the current form state, or null while the
   *  form is invalid or the baseline is unavailable. */
  function mergedFromForm(): PolicyDoc | null {
    if (baselineDoc === null) return null;
    const draft = collectDraft();
    if (!validateSessionDocDraft(draft).ok) return null;
    try {
      return upsertSessionRule(baselineDoc, draft, NETWORK_PASSPHRASE).doc;
    } catch {
      return null;
    }
  }

  function updateSessionPreview(): void {
    const hashEl = sessionWrap.querySelector<HTMLElement>('#pol-doc-prev-hash')!;
    const docEl = sessionWrap.querySelector<HTMLElement>('#pol-doc-prev-doc')!;
    const diffEl = sessionWrap.querySelector<HTMLElement>('#pol-doc-prev-diff')!;
    if (!baselineLoaded) {
      diffEl.textContent = 'Reading the applied document…';
    } else if (baselineBlocked !== null) {
      diffEl.textContent = baselineBlocked;
    }
    const merged = mergedFromForm();
    if (merged === null) {
      hashEl.textContent = '—';
      docEl.textContent = '—';
      if (baselineLoaded && baselineBlocked === null) {
        diffEl.textContent = 'Fill in the template to see what would change.';
      }
      return;
    }
    const hash = docHash(merged);
    hashEl.textContent = hash;
    docEl.innerHTML = renderDocPreviewHtml(summarizeDoc(merged, hash), canonicalJson(merged));
    // The diff's "before" side is the APPLIED doc — on a first apply that
    // is nothing, so everything (admin rule included) renders as new.
    diffEl.innerHTML = renderDocDiffHtml(diffPolicyDocs(isFirstApply ? null : baselineDoc, merged));
  }

  function showSessionErrors(errors: string[]): void {
    showErrorsIn(sessionWrap, '#pol-doc-errors', errors);
  }

  async function submitSession(): Promise<void> {
    const draft = collectDraft();
    const check = validateSessionDocDraft(draft);
    if (!check.ok) {
      showSessionErrors(check.errors);
      return;
    }
    showSessionErrors([]);
    await applyUpdate({
      wrap: sessionWrap,
      submitSel: '#pol-doc-submit',
      statusSel: '#pol-doc-status',
      showErrors: showSessionErrors,
      buildDoc: () => upsertSessionRule(baselineDoc!, draft, NETWORK_PASSPHRASE).doc,
      successToast: 'Policy document applied.',
      rerender: () => {
        renderSessionForm();
        updateSessionPreview();
      },
    });
  }

  function wireSessionForm(): void {
    const q = <T extends HTMLElement>(sel: string) => sessionWrap.querySelector<T>(sel);
    q<HTMLInputElement>('input[name="doc-expiry-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = q<HTMLElement>('#pol-doc-expiry-fields');
      if (box) box.hidden = !on;
      updateSessionPreview();
    });
    q<HTMLInputElement>('input[name="doc-cap-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = q<HTMLElement>('#pol-doc-cap-fields');
      if (box) box.hidden = !on;
      updateSessionPreview();
    });
    sessionWrap.querySelectorAll<HTMLElement>('input, select').forEach((el) => {
      el.addEventListener('input', updateSessionPreview);
    });
    sessionWrap.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submitSession();
    });
    updateSessionPreview();
  }

  // ==== Admin-keys tab =======================================================

  function adminKeyRows(): string {
    if (baselineDoc === null) return '';
    const admins = adminRules(baselineDoc);
    const signerById = new Map(baselineDoc.signers.map((s) => [s.id, s]));
    return admins
      .map((r) => {
        const id = r.principals.type === 'self-authenticating' ? '' : r.principals.signers[0];
        const decl = id !== undefined ? signerById.get(id) : undefined;
        const detail =
          decl === undefined
            ? ''
            : 'address' in decl
              ? truncate(decl.address)
              : truncate(decl.key, 8, 8);
        const last = admins.length <= 1;
        const removeBtn = last
          ? `<span class="mut" style="font-size:11.5px;">Last admin — cannot remove (the account would lose its admin authority).</span>`
          : `<button type="button" class="btn ghost sm pol-adm-remove" data-rule="${esc(r.name)}">Remove…</button>`;
        return `<div class="pol-signer-row" style="align-items:center;">
          <span class="pol-chip known">${esc(r.name)}</span>
          <span class="pol-signer-label">"${esc(id ?? '')}"</span>
          <code class="pol-mono">${esc(detail)}</code>
          <span style="flex:1;"></span>
          ${removeBtn}
        </div>`;
      })
      .join('');
  }

  function renderAdminPanel(): void {
    const defaultName = baselineDoc !== null ? nextAdminRuleName(baselineDoc) : 'admin-2';
    adminWrap.innerHTML = `
      <form class="nido-form pol-builder" novalidate>
        <p class="mut" style="font-size:12.5px;margin:0 0 4px;line-height:1.55;">
          Admin keys hold <strong>full authority</strong> over this account —
          each one is a policy-free self-admin rule in the document. Add a
          backup passkey or another device's key here; remove one when it
          should no longer control the account.
        </p>

        <div class="pol-field-label" style="margin-top:6px;">Current admin keys</div>
        <div id="pol-adm-list">${baselineLoaded && baselineDoc !== null ? adminKeyRows() : `<span class="mut" style="font-size:12.5px;">${esc(baselineBlocked ?? 'Reading the applied document…')}</span>`}</div>

        <div id="pol-adm-add" ${pendingRemoval !== null ? 'hidden' : ''}>
          <div class="pol-field-label" style="margin-top:10px;">Add an admin key</div>
          <fieldset class="pol-fieldset">
            <label class="pol-radio"><input type="radio" name="adm-source" value="new-passkey" checked /> New passkey (created on this device when you submit)</label>
            <label class="pol-radio"><input type="radio" name="adm-source" value="paste" /> A key I already have</label>
          </fieldset>
          <div id="pol-adm-paste" hidden>
            <div class="pol-signer-row">
              <select name="adm-kind" class="input" style="flex:0 0 auto;width:auto;">
                <option value="passkey">Passkey</option>
                <option value="delegated">Delegated key</option>
              </select>
              <input name="adm-verifier" class="input pol-mono" placeholder="Verifier (C…)" style="flex:1 1 140px;" />
              <input name="adm-pubkey" class="input pol-mono" placeholder="Public key (hex)" style="flex:1 1 140px;" />
              <input name="adm-address" class="input pol-mono" placeholder="Address (C… or G…)" style="flex:1 1 140px;" hidden />
            </div>
          </div>
          <label class="pol-input-label">Rule name
            <input name="adm-name" class="input" maxlength="32" value="${esc(defaultName)}" />
          </label>
        </div>

        <div id="pol-adm-removal-note" class="alert" role="note" ${pendingRemoval === null ? 'hidden' : ''} style="margin-top:10px;">
          Removing admin key rule "<strong id="pol-adm-removal-name">${esc(pendingRemoval ?? '')}</strong>" —
          review the change below, then apply.
          <button type="button" id="pol-adm-cancel-removal" class="btn ghost sm" style="margin-left:8px;">Keep it</button>
        </div>

        <div class="pol-fieldset">
          <span class="pol-field-label">What changes</span>
          <div id="pol-adm-prev-diff" class="mut" style="font-size:12.5px;">—</div>
        </div>

        <div class="pol-fieldset">
          <span class="pol-field-label">Document preview (after this update)</span>
          <div class="pol-field-val" style="gap:6px;">
            <span class="pol-field-label" style="text-transform:none;letter-spacing:0;">doc_hash</span>
            <code id="pol-adm-prev-hash" class="pol-mono">—</code>
          </div>
          <div id="pol-adm-prev-doc" class="mut" style="font-size:12.5px;">—</div>
        </div>

        <div id="pol-adm-errors" class="alert danger" role="alert" hidden style="margin-top:10px;"></div>

        <div class="actions" style="display:flex;gap:8px;margin-top:14px;">
          <button type="submit" id="pol-adm-submit" class="btn soft sm">${pendingRemoval !== null ? 'Apply removal' : 'Add admin key'}</button>
        </div>
        <p id="pol-adm-status" class="mut" style="font-size:12px;margin-top:8px;"></p>
      </form>`;
    wireAdminPanel();
  }

  /** The pasted-or-pending admin draft. In new-passkey mode the key does
   *  not exist until submit runs the WebAuthn ceremony, so this returns
   *  null there (the preview explains instead). */
  function collectAdminDraft(): AdminKeyDraft | null {
    const q = <T extends HTMLElement>(sel: string) => adminWrap.querySelector<T>(sel);
    const source = q<HTMLInputElement>('input[name="adm-source"]:checked')?.value ?? 'new-passkey';
    if (source !== 'paste') return null;
    const kind = q<HTMLSelectElement>('select[name="adm-kind"]')?.value ?? 'passkey';
    const name = q<HTMLInputElement>('input[name="adm-name"]')?.value ?? '';
    if (kind === 'delegated') {
      return {
        name,
        signer: { kind: 'delegated', address: q<HTMLInputElement>('input[name="adm-address"]')?.value.trim() ?? '' },
      };
    }
    return {
      name,
      signer: {
        kind: 'passkey',
        verifier: q<HTMLInputElement>('input[name="adm-verifier"]')?.value.trim() ?? '',
        publicKeyHex: q<HTMLInputElement>('input[name="adm-pubkey"]')?.value.trim() ?? '',
      },
    };
  }

  function updateAdminPreview(): void {
    const hashEl = adminWrap.querySelector<HTMLElement>('#pol-adm-prev-hash')!;
    const docEl = adminWrap.querySelector<HTMLElement>('#pol-adm-prev-doc')!;
    const diffEl = adminWrap.querySelector<HTMLElement>('#pol-adm-prev-diff')!;
    const showNone = (msg: string) => {
      hashEl.textContent = '—';
      docEl.textContent = '—';
      diffEl.textContent = msg;
    };
    if (!baselineLoaded) return showNone('Reading the applied document…');
    if (baselineBlocked !== null || baselineDoc === null) {
      return showNone(baselineBlocked ?? 'Unavailable.');
    }

    let merged: PolicyDoc;
    if (pendingRemoval !== null) {
      try {
        merged = removeAdminRule(baselineDoc, pendingRemoval, NETWORK_PASSPHRASE);
      } catch (e) {
        return showNone(e instanceof Error ? e.message : String(e));
      }
    } else {
      const draft = collectAdminDraft();
      if (draft === null) {
        // New-passkey mode: the key material appears at submit time.
        const name = adminWrap.querySelector<HTMLInputElement>('input[name="adm-name"]')?.value ?? 'admin';
        return showNone(
          `A new passkey will be created in this device's authenticator when you submit, then enrolled as admin rule "${name}". The exact document (and its hash) appears at the confirm step.`,
        );
      }
      if (!validateAdminKeyDraft(draft, baselineDoc).ok) {
        return showNone('Fill in the key to see what would change.');
      }
      try {
        merged = addAdminKey(baselineDoc, draft, NETWORK_PASSPHRASE).doc;
      } catch (e) {
        return showNone(e instanceof Error ? e.message : String(e));
      }
    }
    const hash = docHash(merged);
    hashEl.textContent = hash;
    docEl.innerHTML = renderDocPreviewHtml(summarizeDoc(merged, hash), canonicalJson(merged));
    diffEl.innerHTML = renderDocDiffHtml(diffPolicyDocs(isFirstApply ? null : baselineDoc, merged));
  }

  function showAdminErrors(errors: string[]): void {
    showErrorsIn(adminWrap, '#pol-adm-errors', errors);
  }

  async function submitAdmin(): Promise<void> {
    await baselineReady;
    if (baselineDoc === null || baselineBlocked !== null) {
      showAdminErrors([baselineBlocked ?? 'The policy baseline is unavailable.']);
      return;
    }

    if (pendingRemoval !== null) {
      const rule = pendingRemoval;
      let doc: PolicyDoc;
      try {
        doc = removeAdminRule(baselineDoc, rule, NETWORK_PASSPHRASE);
      } catch (e) {
        showAdminErrors([e instanceof Error ? e.message : String(e)]);
        return;
      }
      showAdminErrors([]);
      await applyUpdate({
        wrap: adminWrap,
        submitSel: '#pol-adm-submit',
        statusSel: '#pol-adm-status',
        showErrors: showAdminErrors,
        buildDoc: () => doc,
        successToast: `Admin key rule "${rule}" removed.`,
        rerender: () => {
          renderAdminPanel();
          updateAdminPreview();
        },
      });
      return;
    }

    // Add path: in new-passkey mode, run the WebAuthn ceremony NOW (the
    // submit click is the user activation), then enroll the fresh key.
    const q = <T extends HTMLElement>(sel: string) => adminWrap.querySelector<T>(sel);
    const source = q<HTMLInputElement>('input[name="adm-source"]:checked')?.value ?? 'new-passkey';
    let draft = collectAdminDraft();
    if (source === 'new-passkey') {
      const status = q<HTMLElement>('#pol-adm-status');
      try {
        if (status) status.textContent = 'Creating the new passkey…';
        const created = await createSessionPasskey({
          rpId: window.location.hostname,
          rpName: window.location.host,
          userName: `admin-key:${opts.account}`,
        });
        if (status) status.textContent = 'Resolving the verifier…';
        const verifier = await fetchVerifierAddress(opts.account);
        draft = {
          name: q<HTMLInputElement>('input[name="adm-name"]')?.value ?? '',
          signer: { kind: 'passkey', verifier, publicKeyHex: bytesToHex(created.publicKey) },
        };
      } catch (e) {
        showAdminErrors([
          `Passkey creation failed: ${e instanceof Error ? e.message : String(e)}`,
        ]);
        if (status) status.textContent = '';
        return;
      }
    }
    if (draft === null) return;

    const check = validateAdminKeyDraft(draft, baselineDoc);
    if (!check.ok) {
      showAdminErrors(check.errors);
      return;
    }
    showAdminErrors([]);
    const built = addAdminKey(baselineDoc, draft, NETWORK_PASSPHRASE).doc;
    await applyUpdate({
      wrap: adminWrap,
      submitSel: '#pol-adm-submit',
      statusSel: '#pol-adm-status',
      showErrors: showAdminErrors,
      buildDoc: () => built,
      successToast: 'Admin key enrolled.',
      rerender: () => {
        renderAdminPanel();
        updateAdminPreview();
      },
    });
  }

  function wireAdminPanel(): void {
    const q = <T extends HTMLElement>(sel: string) => adminWrap.querySelector<T>(sel);
    adminWrap.querySelectorAll<HTMLInputElement>('input[name="adm-source"]').forEach((el) => {
      el.addEventListener('change', () => {
        const paste = q<HTMLInputElement>('input[name="adm-source"]:checked')?.value === 'paste';
        const box = q<HTMLElement>('#pol-adm-paste');
        if (box) box.hidden = !paste;
        updateAdminPreview();
      });
    });
    q<HTMLSelectElement>('select[name="adm-kind"]')?.addEventListener('change', () => {
      const delegated = q<HTMLSelectElement>('select[name="adm-kind"]')?.value === 'delegated';
      const verifier = q<HTMLInputElement>('input[name="adm-verifier"]');
      const pubkey = q<HTMLInputElement>('input[name="adm-pubkey"]');
      const address = q<HTMLInputElement>('input[name="adm-address"]');
      if (verifier) verifier.hidden = delegated;
      if (pubkey) pubkey.hidden = delegated;
      if (address) address.hidden = !delegated;
      updateAdminPreview();
    });
    adminWrap.querySelectorAll<HTMLButtonElement>('.pol-adm-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingRemoval = btn.dataset.rule ?? null;
        renderAdminPanel();
        updateAdminPreview();
      });
    });
    q<HTMLButtonElement>('#pol-adm-cancel-removal')?.addEventListener('click', () => {
      pendingRemoval = null;
      renderAdminPanel();
      updateAdminPreview();
    });
    adminWrap.querySelectorAll<HTMLElement>('input, select').forEach((el) => {
      el.addEventListener('input', updateAdminPreview);
    });
    adminWrap.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submitAdmin();
    });
    updateAdminPreview();
  }

  // ==== Shared apply plumbing ================================================

  function showErrorsIn(wrap: HTMLElement, sel: string, errors: string[]): void {
    const box = wrap.querySelector<HTMLElement>(sel);
    if (!box) return;
    if (errors.length === 0) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = `<ul style="margin:0;padding-left:18px;">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  }

  /** Build the doc (against the LOADED baseline), submit one apply_doc
   *  through the passkey signing path, and refresh on success. */
  async function applyUpdate(args: {
    wrap: HTMLElement;
    submitSel: string;
    statusSel: string;
    showErrors: (errors: string[]) => void;
    buildDoc: () => PolicyDoc;
    successToast: string;
    rerender: () => void;
  }): Promise<void> {
    const submitBtn = args.wrap.querySelector<HTMLButtonElement>(args.submitSel);
    const status = args.wrap.querySelector<HTMLElement>(args.statusSel);
    if (submitBtn) submitBtn.disabled = true;
    const setStatus = (t: string) => {
      if (status) status.textContent = t;
    };

    try {
      setStatus('Reading the applied document…');
      await baselineReady;
      if (baselineBlocked !== null || baselineDoc === null) {
        args.showErrors([baselineBlocked ?? 'The policy baseline is unavailable.']);
        setStatus('');
        return;
      }
      const doc = args.buildDoc();

      setStatus('Building the apply_doc transaction…');
      const tx = await buildApplyDocTx(doc, {
        account: opts.account,
        rpcUrl: RPC_URL,
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      await signAndSubmit({
        account: opts.account,
        operation: tx.operations[0]!,
        onProgress: (p) => setStatus(`${p.phase}${p.detail ? `: ${p.detail}` : ''}…`),
      });

      toast(args.successToast);
      setStatus('');
      adoptApplied(doc);
      args.rerender();
      opts.onSubmitted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      args.showErrors([msg]);
      setStatus('');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  render();
  void baselineReady.then(() => {
    updateSessionPreview();
    renderAdminPanel();
    updateAdminPreview();
  });
}
