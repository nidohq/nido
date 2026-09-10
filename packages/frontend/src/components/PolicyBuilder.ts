// The policy builder: compose a policy-document update and apply it.
//
// DOC-ONLY by ruling: every policy write goes through the account's
// one-transaction `apply_doc` surface (`buildApplyDocTx`) — there is no
// per-rule `add_context_rule` path here any more. The form is the canned v1
// template — one scoped session key (a delegated signer restricted to one
// contract's named functions, with an expiry) plus an optional cumulative
// spending cap — and submitting UPSERTS that rule into the account's
// currently applied document (apply_doc replaces the whole document, so an
// update carries the current rules forward with the new one merged in).
//
// The preview always shows the full merged document (canonical JSON +
// doc_hash) AND the diff against the currently applied one — exactly what
// changes, rule by rule — before the user confirms. Validation and the
// merge/diff logic live in the pure libs (lib/policy/docDraft,
// lib/policy/docDiff); submission goes through the account's existing
// passkey signing path (signAndSubmit). This module never signs silently.

import {
  buildApplyDocTx,
  canonicalJson,
  docHash,
  parsePolicyDocJson,
  type PolicyDoc,
} from '@nidohq/passkey-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { esc } from '../lib/html.js';
import { toast } from '../lib/toast.js';
import { RPC_URL } from '../lib/network.js';
import { fetchDefaultRuleAuthInfo } from '../lib/policyChainFetch.js';
import { fetchAppliedDocJson, fetchDocSurface, toHex } from '../lib/policy/docPolicyFetch.js';
import { stroopsFromXlm, PERIOD_LEDGERS } from '../lib/spendingLimitParams.js';
import { signAndSubmit } from '../lib/primaryPasskeySigner.js';
import {
  ownerAdminBaseline,
  upsertSessionRule,
  validateSessionDocDraft,
  type SessionDocDraft,
} from '../lib/policy/docDraft.js';
import { diffPolicyDocs } from '../lib/policy/docDiff.js';
import { bytesToHex } from '../lib/policy/policyView.js';
import { renderDocDiffHtml } from './PolicyInspector.js';

const NETWORK_PASSPHRASE = Networks.TESTNET;

interface BuilderOptions {
  account: string;
  /** Called after a document is successfully applied, so the page can refresh. */
  onSubmitted?: () => void;
}

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

  function render(): void {
    container.innerHTML = `
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
          <div id="pol-doc-prev-diff" class="mut" style="font-size:12.5px;">Loading the applied document…</div>
        </div>

        <div class="pol-fieldset">
          <span class="pol-field-label">Document preview (after this update)</span>
          <div class="pol-field-val" style="gap:6px;">
            <span class="pol-field-label" style="text-transform:none;letter-spacing:0;">doc_hash</span>
            <code id="pol-doc-prev-hash" class="pol-mono">—</code>
          </div>
          <pre id="pol-doc-prev-json" class="pol-mono" style="font-size:11px;line-height:1.5;margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;">—</pre>
        </div>

        <div id="pol-doc-errors" class="alert danger" role="alert" hidden style="margin-top:10px;"></div>

        <div class="actions" style="display:flex;gap:8px;margin-top:14px;">
          <button type="submit" id="pol-doc-submit" class="btn soft sm">Apply document update</button>
        </div>
        <p id="pol-doc-status" class="mut" style="font-size:12px;margin-top:8px;"></p>
      </form>`;
    wire();
  }

  function collectDraft(): SessionDocDraft {
    const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel);
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
      sessionAddress: q<HTMLInputElement>('input[name="doc-signer"]')?.value.trim() ?? '',
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

  function updatePreview(): void {
    const hashEl = container.querySelector<HTMLElement>('#pol-doc-prev-hash')!;
    const jsonEl = container.querySelector<HTMLElement>('#pol-doc-prev-json')!;
    const diffEl = container.querySelector<HTMLElement>('#pol-doc-prev-diff')!;
    if (!baselineLoaded) {
      diffEl.textContent = 'Reading the applied document…';
    } else if (baselineBlocked !== null) {
      diffEl.textContent = baselineBlocked;
    }
    const merged = mergedFromForm();
    if (merged === null) {
      hashEl.textContent = '—';
      jsonEl.textContent = '—';
      if (baselineLoaded && baselineBlocked === null) {
        diffEl.textContent = 'Fill in the template to see what would change.';
      }
      return;
    }
    hashEl.textContent = docHash(merged);
    jsonEl.textContent = canonicalJson(merged);
    // The diff's "before" side is the APPLIED doc — on a first apply that
    // is nothing, so everything (admin rule included) renders as new.
    diffEl.innerHTML = renderDocDiffHtml(diffPolicyDocs(isFirstApply ? null : baselineDoc, merged));
  }

  function showErrors(errors: string[]): void {
    const box = container.querySelector<HTMLElement>('#pol-doc-errors');
    if (!box) return;
    if (errors.length === 0) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = `<ul style="margin:0;padding-left:18px;">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  }

  async function submit(): Promise<void> {
    const draft = collectDraft();
    const check = validateSessionDocDraft(draft);
    if (!check.ok) {
      showErrors(check.errors);
      return;
    }
    showErrors([]);

    const submitBtn = container.querySelector<HTMLButtonElement>('#pol-doc-submit');
    const status = container.querySelector<HTMLElement>('#pol-doc-status');
    if (submitBtn) submitBtn.disabled = true;
    const setStatus = (t: string) => {
      if (status) status.textContent = t;
    };

    try {
      // Merge against the LOADED baseline — never submit a standalone
      // template over an unknown state (and never without the anti-brick
      // admin rule).
      setStatus('Reading the applied document…');
      await baselineReady;
      if (baselineBlocked !== null || baselineDoc === null) {
        showErrors([baselineBlocked ?? 'The policy baseline is unavailable.']);
        setStatus('');
        return;
      }
      const { doc } = upsertSessionRule(baselineDoc, draft, NETWORK_PASSPHRASE);

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

      toast('Policy document applied.');
      setStatus('');
      baselineDoc = doc;
      isFirstApply = false;
      render();
      updatePreview();
      opts.onSubmitted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrors([msg]);
      setStatus('');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function wire(): void {
    const q = <T extends HTMLElement>(sel: string) => container.querySelector<T>(sel);
    q<HTMLInputElement>('input[name="doc-expiry-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = q<HTMLElement>('#pol-doc-expiry-fields');
      if (box) box.hidden = !on;
      updatePreview();
    });
    q<HTMLInputElement>('input[name="doc-cap-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = q<HTMLElement>('#pol-doc-cap-fields');
      if (box) box.hidden = !on;
      updatePreview();
    });
    container.querySelectorAll<HTMLElement>('input, select').forEach((el) => {
      el.addEventListener('input', updatePreview);
    });
    container.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    updatePreview();
  }

  render();
  void baselineReady.then(updatePreview);
}
