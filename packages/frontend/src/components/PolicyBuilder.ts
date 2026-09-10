// The policy builder: compose a new policy and add it to the account.
//
// Two modes:
//
// - **Session key (document)** — the canned perch-doc template: one scoped
//   session key (a delegated signer restricted to one contract's named
//   functions, with an expiry) plus an optional cumulative spending cap.
//   Emits a perch PolicyDoc; applies through the account's one-transaction
//   `apply_doc` surface when it has one (and the doc is uncapped — the
//   hybrid contract refuses capped docs), else installs per-rule via the
//   SDK's client-side lowering. The policy page then shows the LOSSLESS
//   document view — names and all — verified against the stored doc_hash.
// - **Raw rule** — the original form: one OZ context rule straight through
//   `add_context_rule` (scope, signers, optional spending limit, expiry).
//
// Both modes validate with the pure libs (lib/policy/docDraft,
// lib/policy/policyDraft) and submit through the account's existing passkey
// signing path (signAndSubmit). This module never signs silently.

import { Client as SmartAccountClient } from '@nidohq/smart-account';
import {
  buildApplyDocTx,
  buildDocInstallTxs,
  canonicalJson,
  docHash,
  extractXdrOperations,
  hex2buf,
  lowerDoc,
  perchTestnetAddresses,
} from '@nidohq/passkey-sdk';
import { Networks } from '@stellar/stellar-sdk';
import { esc } from '../lib/html.js';
import { toast } from '../lib/toast.js';
import { RPC_URL } from '../lib/network.js';
import { fetchRegistryAddress } from '../lib/policyChainFetch.js';
import { fetchDocSurface } from '../lib/policy/docPolicyFetch.js';
import { spendingLimitParamsScVal, stroopsFromXlm, PERIOD_LEDGERS } from '../lib/spendingLimitParams.js';
import { signAndSubmit } from '../lib/primaryPasskeySigner.js';
import {
  validateDraft,
  buildAddContextRuleArgs,
  spendingLimitPlan,
  type RuleDraft,
  type DraftSigner,
} from '../lib/policy/policyDraft.js';
import {
  chooseApplyRoute,
  docHasCap,
  draftToDoc,
  validateSessionDocDraft,
  type SessionDocDraft,
} from '../lib/policy/docDraft.js';

const NETWORK_PASSPHRASE = Networks.TESTNET;

interface BuilderOptions {
  account: string;
  /** Called after a rule is successfully added, so the page can refresh. */
  onSubmitted?: () => void;
}

type BuilderMode = 'doc' | 'raw';

export function mountPolicyBuilder(container: HTMLElement, opts: BuilderOptions): void {
  let mode: BuilderMode = 'doc';
  // Whether this account exposes `apply_doc` — probed once, lazily, for the
  // route hint and the submit-time route choice.
  let docSurfacePromise: Promise<boolean> | null = null;
  const hasDocSurface = (): Promise<boolean> =>
    (docSurfacePromise ??= fetchDocSurface(opts.account)
      .then((s) => s.supported)
      .catch(() => false));

  // Local signer draft state for the RAW form; the row inputs are the source
  // of truth on submit.
  let signers: DraftSigner[] = [{ kind: 'passkey' }];

  let docWrap: HTMLElement;
  let rawWrap: HTMLElement;

  function render(): void {
    container.innerHTML = `
      <div class="pol-mode-tabs" role="tablist" style="display:flex;gap:8px;margin-bottom:14px;">
        <button type="button" id="pol-mode-doc" role="tab" class="btn sm" aria-selected="false">Session key (document)</button>
        <button type="button" id="pol-mode-raw" role="tab" class="btn sm" aria-selected="false">Raw rule</button>
      </div>
      <div id="pol-doc-wrap"></div>
      <div id="pol-raw-wrap"></div>`;
    docWrap = container.querySelector<HTMLElement>('#pol-doc-wrap')!;
    rawWrap = container.querySelector<HTMLElement>('#pol-raw-wrap')!;
    renderDocForm();
    renderRawForm();
    renderSignerRows();
    wireRawForm();
    const docTab = container.querySelector<HTMLButtonElement>('#pol-mode-doc')!;
    const rawTab = container.querySelector<HTMLButtonElement>('#pol-mode-raw')!;
    const applyMode = () => {
      docWrap.hidden = mode !== 'doc';
      rawWrap.hidden = mode !== 'raw';
      docTab.className = `btn sm ${mode === 'doc' ? 'soft' : 'ghost'}`;
      rawTab.className = `btn sm ${mode === 'raw' ? 'soft' : 'ghost'}`;
      docTab.setAttribute('aria-selected', String(mode === 'doc'));
      rawTab.setAttribute('aria-selected', String(mode === 'raw'));
    };
    docTab.addEventListener('click', () => { mode = 'doc'; applyMode(); });
    rawTab.addEventListener('click', () => { mode = 'raw'; applyMode(); });
    applyMode();
  }

  // --- Doc mode: the scoped-session-key template ---------------------------

  function renderDocForm(): void {
    docWrap.innerHTML = `
      <form class="nido-form pol-builder" novalidate>
        <p class="mut" style="font-size:12.5px;margin:0 0 4px;line-height:1.55;">
          The template: one <strong>scoped session key</strong> — a delegated key
          limited to one contract's named functions, with an optional expiry and
          spending cap. Saved as a policy <em>document</em>, so this page can show
          exactly what you approved (names included), verified against the hash
          the account stores on chain.
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
          <span class="pol-field-label">Document preview</span>
          <div class="pol-field-val" style="gap:6px;">
            <span class="pol-field-label" style="text-transform:none;letter-spacing:0;">doc_hash</span>
            <code id="pol-doc-prev-hash" class="pol-mono">—</code>
          </div>
          <pre id="pol-doc-prev-json" class="pol-mono" style="font-size:11px;line-height:1.5;margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;">—</pre>
          <p id="pol-doc-prev-route" class="mut" style="font-size:12px;margin:0;"></p>
        </div>

        <div id="pol-doc-errors" class="alert danger" role="alert" hidden style="margin-top:10px;"></div>

        <div class="actions" style="display:flex;gap:8px;margin-top:14px;">
          <button type="submit" id="pol-doc-submit" class="btn soft sm">Apply document</button>
        </div>
        <p id="pol-doc-status" class="mut" style="font-size:12px;margin-top:8px;"></p>
      </form>`;
    wireDocForm();
  }

  function collectDocDraft(): SessionDocDraft {
    const q = <T extends HTMLElement>(sel: string) => docWrap.querySelector<T>(sel);
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

  function updateDocPreview(): void {
    const hashEl = docWrap.querySelector<HTMLElement>('#pol-doc-prev-hash')!;
    const jsonEl = docWrap.querySelector<HTMLElement>('#pol-doc-prev-json')!;
    const routeEl = docWrap.querySelector<HTMLElement>('#pol-doc-prev-route')!;
    const draft = collectDocDraft();
    const check = validateSessionDocDraft(draft);
    if (!check.ok) {
      hashEl.textContent = '—';
      jsonEl.textContent = '—';
      routeEl.textContent = '';
      return;
    }
    try {
      const doc = draftToDoc(draft, NETWORK_PASSPHRASE);
      hashEl.textContent = docHash(doc);
      jsonEl.textContent = canonicalJson(doc);
      const capped = docHasCap(doc);
      routeEl.textContent = capped
        ? 'Installs per-rule: the cap rides the stock spending-limit policy next to the interpreter (the one-transaction apply_doc path refuses capped docs).'
        : 'Applies in one transaction via apply_doc when this account supports it; falls back to a per-rule install otherwise.';
      void hasDocSurface().then((supported) => {
        if (capped || supported) return;
        routeEl.textContent =
          'This account has no apply_doc surface — the document installs per-rule (one transaction per rule).';
      });
    } catch (e) {
      hashEl.textContent = '—';
      jsonEl.textContent = `Cannot build document: ${e instanceof Error ? e.message : String(e)}`;
      routeEl.textContent = '';
    }
  }

  function showDocErrors(errors: string[]): void {
    const box = docWrap.querySelector<HTMLElement>('#pol-doc-errors');
    if (!box) return;
    if (errors.length === 0) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = `<ul style="margin:0;padding-left:18px;">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  }

  async function submitDoc(): Promise<void> {
    const draft = collectDocDraft();
    const check = validateSessionDocDraft(draft);
    if (!check.ok) {
      showDocErrors(check.errors);
      return;
    }
    showDocErrors([]);

    const submitBtn = docWrap.querySelector<HTMLButtonElement>('#pol-doc-submit');
    const status = docWrap.querySelector<HTMLElement>('#pol-doc-status');
    if (submitBtn) submitBtn.disabled = true;
    const setStatus = (t: string) => {
      if (status) status.textContent = t;
    };

    try {
      const doc = draftToDoc(draft, NETWORK_PASSPHRASE);
      setStatus('Checking the account’s apply_doc surface…');
      const route = chooseApplyRoute({
        hasDocSurface: await hasDocSurface(),
        docHasCap: docHasCap(doc),
      });

      if (route === 'apply-doc') {
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
      } else {
        setStatus('Lowering the document…');
        const lowered = lowerDoc(doc, { account: opts.account });
        const spendingLimitAddress = lowered.usesSpendingLimit
          ? await fetchRegistryAddress('spending-limit-policy')
          : undefined;
        const steps = await buildDocInstallTxs(lowered, {
          account: opts.account,
          rpcUrl: RPC_URL,
          networkPassphrase: NETWORK_PASSPHRASE,
          interpreterAddress: perchTestnetAddresses().interpreter,
          ...(spendingLimitAddress !== undefined ? { spendingLimitAddress } : {}),
        });
        for (const [i, step] of steps.entries()) {
          setStatus(`Installing rule ${i + 1} of ${steps.length} ("${step.ruleName}")…`);
          await signAndSubmit({
            account: opts.account,
            operation: step.operations[0]!,
            onProgress: (p) => setStatus(`${p.phase}${p.detail ? `: ${p.detail}` : ''}…`),
          });
        }
        toast(`Installed ${steps.length} policy rule${steps.length === 1 ? '' : 's'} from the document.`);
      }

      setStatus('');
      renderDocForm();
      opts.onSubmitted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showDocErrors([msg]);
      setStatus('');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function wireDocForm(): void {
    const q = <T extends HTMLElement>(sel: string) => docWrap.querySelector<T>(sel);
    q<HTMLInputElement>('input[name="doc-expiry-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = q<HTMLElement>('#pol-doc-expiry-fields');
      if (box) box.hidden = !on;
      updateDocPreview();
    });
    q<HTMLInputElement>('input[name="doc-cap-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = q<HTMLElement>('#pol-doc-cap-fields');
      if (box) box.hidden = !on;
      updateDocPreview();
    });
    docWrap.querySelectorAll<HTMLElement>('input, select').forEach((el) => {
      el.addEventListener('input', updateDocPreview);
    });
    docWrap.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submitDoc();
    });
    updateDocPreview();
  }

  // --- Raw mode: one OZ context rule straight through add_context_rule ------

  function renderRawForm(): void {
    rawWrap.innerHTML = `
      <form class="nido-form pol-builder" novalidate>
        <label class="pol-input-label">Rule name
          <input name="name" class="input" maxlength="32" placeholder="e.g. ci-publish" />
        </label>

        <fieldset class="pol-fieldset">
          <legend class="pol-field-label">Scope</legend>
          <label class="pol-radio"><input type="radio" name="scope" value="default" /> Any contract (default authority)</label>
          <label class="pol-radio"><input type="radio" name="scope" value="call-contract" checked /> One contract</label>
          <input name="contract" class="input pol-mono" placeholder="C… contract address" />
        </fieldset>

        <div class="pol-field-label" style="margin-top:6px;">Signers</div>
        <div id="pol-signer-rows"></div>
        <button type="button" id="pol-add-signer" class="btn ghost sm">+ Add signer</button>

        <label class="pol-check">
          <input type="checkbox" name="limit-on" /> Attach a spending limit
        </label>
        <div id="pol-limit-fields" class="pol-limit" hidden>
          <input name="limit-xlm" class="input" inputmode="decimal" placeholder="Amount (XLM)" />
          <select name="limit-period" class="input">
            <option value="day">per day</option>
            <option value="week">per week</option>
            <option value="30d">per 30 days</option>
          </select>
        </div>

        <label class="pol-check">
          <input type="checkbox" name="expiry-on" /> Set an expiry
        </label>
        <div id="pol-expiry-fields" class="pol-limit" hidden>
          <input name="expiry-ledger" class="input" inputmode="numeric" placeholder="Expiry ledger sequence" />
        </div>

        <div id="pol-errors" class="alert danger" role="alert" hidden style="margin-top:10px;"></div>

        <div class="actions" style="display:flex;gap:8px;margin-top:14px;">
          <button type="submit" id="pol-submit" class="btn soft sm">Add rule</button>
        </div>
        <p id="pol-status" class="mut" style="font-size:12px;margin-top:8px;"></p>
      </form>`;
  }

  function renderSignerRows(): void {
    const rows = rawWrap.querySelector<HTMLElement>('#pol-signer-rows');
    if (!rows) return;
    rows.innerHTML = signers
      .map((s, i) => {
        const passkey = s.kind === 'passkey';
        return `<div class="pol-signer-row" data-i="${i}">
          <select class="input pol-signer-kind" data-i="${i}">
            <option value="passkey" ${passkey ? 'selected' : ''}>Passkey</option>
            <option value="delegated" ${passkey ? '' : 'selected'}>Delegated key</option>
          </select>
          ${
            passkey
              ? `<input class="input pol-mono pol-sig-verifier" data-i="${i}" placeholder="Verifier (C…)" value="${esc(s.verifier ?? '')}" />
                 <input class="input pol-mono pol-sig-pubkey" data-i="${i}" placeholder="Public key (hex)" value="${esc(s.publicKeyHex ?? '')}" />`
              : `<input class="input pol-mono pol-sig-addr" data-i="${i}" placeholder="Address (C… or G…)" value="${esc(s.address ?? '')}" />`
          }
          ${signers.length > 1 ? `<button type="button" class="btn ghost sm pol-sig-remove" data-i="${i}" aria-label="Remove signer">✕</button>` : ''}
        </div>`;
      })
      .join('');

    rows.querySelectorAll<HTMLSelectElement>('.pol-signer-kind').forEach((sel) => {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.i);
        readSignersFromDom();
        signers[i] = { kind: sel.value as DraftSigner['kind'] };
        renderSignerRows();
      });
    });
    rows.querySelectorAll<HTMLButtonElement>('.pol-sig-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        readSignersFromDom();
        signers.splice(Number(btn.dataset.i), 1);
        renderSignerRows();
      });
    });
  }

  /** Read current input values back into the signers state (preserve on re-render). */
  function readSignersFromDom(): void {
    const rows = rawWrap.querySelectorAll<HTMLElement>('.pol-signer-row');
    rows.forEach((row) => {
      const i = Number(row.dataset.i);
      const kind = row.querySelector<HTMLSelectElement>('.pol-signer-kind')?.value as DraftSigner['kind'];
      if (kind === 'delegated') {
        signers[i] = { kind, address: row.querySelector<HTMLInputElement>('.pol-sig-addr')?.value.trim() };
      } else {
        signers[i] = {
          kind: 'passkey',
          verifier: row.querySelector<HTMLInputElement>('.pol-sig-verifier')?.value.trim(),
          publicKeyHex: row.querySelector<HTMLInputElement>('.pol-sig-pubkey')?.value.trim(),
        };
      }
    });
  }

  function collectDraft(): RuleDraft {
    readSignersFromDom();
    const q = <T extends HTMLElement>(sel: string) => rawWrap.querySelector<T>(sel);
    const scopeKind =
      q<HTMLInputElement>('input[name="scope"]:checked')?.value === 'default' ? 'default' : 'call-contract';
    const limitOn = q<HTMLInputElement>('input[name="limit-on"]')?.checked ?? false;
    const expiryOn = q<HTMLInputElement>('input[name="expiry-on"]')?.checked ?? false;

    const draft: RuleDraft = {
      name: q<HTMLInputElement>('input[name="name"]')?.value ?? '',
      scope:
        scopeKind === 'call-contract'
          ? { kind: 'call-contract', contract: q<HTMLInputElement>('input[name="contract"]')?.value ?? '' }
          : { kind: 'default' },
      signers: signers.map((s) => ({ ...s })),
    };

    if (limitOn) {
      const xlm = q<HTMLInputElement>('input[name="limit-xlm"]')?.value ?? '';
      const period = (q<HTMLSelectElement>('select[name="limit-period"]')?.value ?? 'day') as keyof typeof PERIOD_LEDGERS;
      let stroops = '0';
      try {
        stroops = stroopsFromXlm(xlm).toString();
      } catch {
        stroops = '0';
      }
      draft.spendingLimit = { stroops, periodLedgers: PERIOD_LEDGERS[period] };
    }
    if (expiryOn) {
      const n = Number(q<HTMLInputElement>('input[name="expiry-ledger"]')?.value);
      draft.validUntilLedger = Number.isFinite(n) ? n : NaN;
    }
    return draft;
  }

  function showErrors(errors: string[]): void {
    const box = rawWrap.querySelector<HTMLElement>('#pol-errors');
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
    const check = validateDraft(draft);
    if (!check.ok) {
      showErrors(check.errors);
      return;
    }
    showErrors([]);

    const submitBtn = rawWrap.querySelector<HTMLButtonElement>('#pol-submit');
    const status = rawWrap.querySelector<HTMLElement>('#pol-status');
    if (submitBtn) submitBtn.disabled = true;
    const setStatus = (t: string) => {
      if (status) status.textContent = t;
    };

    try {
      const args = buildAddContextRuleArgs(draft);

      // Attach the optional spending-limit policy (address resolved from the
      // registry, params ScVal-encoded — same path the delegate flow uses).
      const policies = new Map<string, ReturnType<typeof spendingLimitParamsScVal>>();
      const plan = spendingLimitPlan(draft);
      if (plan) {
        setStatus('Resolving spending-limit policy…');
        const policyAddr = await fetchRegistryAddress('spending-limit-policy');
        policies.set(policyAddr, spendingLimitParamsScVal(plan.stroops, plan.periodLedgers));
      }

      const client = new SmartAccountClient({
        contractId: opts.account,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl: RPC_URL,
      });

      setStatus('Building transaction…');
      const assembled = await client.add_context_rule({
        context_type:
          args.context_type.tag === 'CallContract'
            ? { tag: 'CallContract', values: args.context_type.values as readonly [string] }
            : { tag: 'Default', values: void 0 as unknown as undefined },
        name: args.name,
        valid_until: args.valid_until,
        signers: args.signers.map((s) =>
          s.tag === 'External'
            ? {
                tag: 'External' as const,
                values: [s.values[0], hex2buf(s.values[1]) as Buffer] as readonly [string, Buffer],
              }
            : { tag: 'Delegated' as const, values: [s.values[0]] as readonly [string] },
        ),
        policies,
      });

      const operation = extractXdrOperations(assembled, 'add-context-rule')[0]!;

      await signAndSubmit({
        account: opts.account,
        operation,
        onProgress: (p) => setStatus(`${p.phase}${p.detail ? `: ${p.detail}` : ''}…`),
      });

      toast('Policy rule added.');
      setStatus('');
      // Reset the form and refresh the inspector.
      signers = [{ kind: 'passkey' }];
      renderRawForm();
      renderSignerRows();
      wireRawForm();
      opts.onSubmitted?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrors([msg]);
      setStatus('');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function wireRawForm(): void {
    rawWrap.querySelector<HTMLButtonElement>('#pol-add-signer')?.addEventListener('click', () => {
      readSignersFromDom();
      signers.push({ kind: 'passkey' });
      renderSignerRows();
    });
    rawWrap.querySelector<HTMLInputElement>('input[name="limit-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = rawWrap.querySelector<HTMLElement>('#pol-limit-fields');
      if (box) box.hidden = !on;
    });
    rawWrap.querySelector<HTMLInputElement>('input[name="expiry-on"]')?.addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      const box = rawWrap.querySelector<HTMLElement>('#pol-expiry-fields');
      if (box) box.hidden = !on;
    });
    rawWrap.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
  }

  render();
}
