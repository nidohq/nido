import { canonicalJson, docHash, RECOVERY_CONTROLLER_TESTNET_ID, type PolicyDoc } from "@nidohq/passkey-sdk";
import { upsertRecovery, validateRecoveryDraft, type RecoveryDraft } from "../lib/policy/docDraft";
import { renderDocDiffHtml, renderDocPreviewHtml } from "./PolicyInspector.js";
import { summarizeDoc } from "../lib/policy/docView.js";
import { esc } from "../lib/html.js";
import { diffPolicyDocs } from "../lib/policy/docDiff.js";

    export interface RecoveryPanelContext {
  account: string;
  networkPassphrase: string;
  getBaseline: () => {
    doc: PolicyDoc | null;
    blocked: string | null;
    loaded: boolean;
    isFirstApply: boolean;
  };
  applyUpdate: (args: {
    wrap: HTMLElement;
    submitSel: string;
    statusSel: string;
    showErrors: (errors: string[]) => void;
    buildDoc: () => PolicyDoc;
    successToast: string;
    rerender: () => void;
  }) => Promise<void>;
  showErrorsIn: (wrap: HTMLElement, sel: string, errors: string[]) => void;
}

export function mountRecoveryPanel(wrap: HTMLElement, ctx: RecoveryPanelContext): {
  render: () => void;
  updatePreview: () => void;
} {
  function render(): void {
    const { doc } = ctx.getBaseline();
    const signerIds = doc?.signers.map((s) => s.id) ?? [];
    wrap.innerHTML = `
      <form class="nido-form pol-builder" novalidate>
        <p class="mut" style="font-size:12.5px;margin:0 0 4px;line-height:1.55;">
          Guardians who can vouch for a lost-key recovery. A quorum of them
          approving is what lets a new document replace a lost signer — no
          compromise recovery (with a baseline config) is enrolled here.
        </p>

        <label class="pol-input-label">Guardians (comma-separated G/C addresses)
          <input name="rec-guardians" class="input pol-mono" placeholder="G…, G…" />
        </label>
        <label class="pol-input-label">Guardian threshold
          <input name="rec-threshold" class="input" type="number" value="1" min="1" />
        </label>

        <div class="pol-field-label" style="margin-top:6px;">Signers recovery may replace</div>
        <div class="pol-fieldset">
          ${
            signerIds.length === 0
              ? `<span class="mut" style="font-size:12.5px;">Reading the applied document…</span>`
              : signerIds
                  .map(
                    (id) =>
                      `<label class="pol-check"><input type="checkbox" name="rec-replaceable" value="${esc(id)}" /> ${esc(id)}</label>`,
                  )
                  .join('')
          }
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <label class="pol-input-label" style="flex:1 1 100px;">Delay (ledgers)
            <input name="rec-delay" class="input" type="number" value="100" />
          </label>
          <label class="pol-input-label" style="flex:1 1 100px;">Expiry (ledgers)
            <input name="rec-expiry" class="input" type="number" value="100" />
          </label>
          <label class="pol-input-label" style="flex:1 1 100px;">Max cancels
            <input name="rec-maxcancels" class="input" type="number" value="3" />
          </label>
        </div>
        <label class="pol-input-label">While a recovery is pending
          <select name="rec-pending" class="input">
            <option value="freeze">Freeze — block other account changes</option>
            <option value="continue">Continue — allow normal use</option>
          </select>
        </label>

        <div class="pol-fieldset">
          <span class="pol-field-label">What changes</span>
          <div id="pol-rec-prev-diff" class="mut" style="font-size:12.5px;">—</div>
        </div>
        <div class="pol-fieldset">
          <span class="pol-field-label">Document preview (after this update)</span>
          <div class="pol-field-val" style="gap:6px;">
            <span class="pol-field-label" style="text-transform:none;letter-spacing:0;">doc_hash</span>
            <code id="pol-rec-prev-hash" class="pol-mono">—</code>
          </div>
          <div id="pol-rec-prev-doc" class="mut" style="font-size:12.5px;">—</div>
        </div>

        <div id="pol-rec-errors" class="alert danger" role="alert" hidden style="margin-top:10px;"></div>
        <div class="actions" style="display:flex;gap:8px;margin-top:14px;">
          <button type="submit" id="pol-rec-submit" class="btn soft sm">Enroll recovery</button>
        </div>
        <p id="pol-rec-status" class="mut" style="font-size:12px;margin-top:8px;"></p>
      </form>`;
    wireRecoveryPanel();
  }

  function collectRecoveryDraft(): RecoveryDraft {
    const q = <T extends HTMLElement>(sel: string) => wrap.querySelector<T>(sel);
    const guardians = (q<HTMLInputElement>('input[name="rec-guardians"]')?.value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const replaceable = Array.from(
      wrap.querySelectorAll<HTMLInputElement>('input[name="rec-replaceable"]:checked'),
    ).map((el) => el.value);
    return {
      controller: RECOVERY_CONTROLLER_TESTNET_ID,
      guardians,
      guardianThreshold: Number(q<HTMLInputElement>('input[name="rec-threshold"]')?.value ?? '1'),
      replaceable,
      delayLedgers: Number(q<HTMLInputElement>('input[name="rec-delay"]')?.value ?? '0'),
      expiryLedgers: Number(q<HTMLInputElement>('input[name="rec-expiry"]')?.value ?? '0'),
      maxCancels: Number(q<HTMLInputElement>('input[name="rec-maxcancels"]')?.value ?? '0'),
      pendingActivity:
        (q<HTMLSelectElement>('select[name="rec-pending"]')?.value as 'freeze' | 'continue') ?? 'freeze',
    };
  }

  function showRecoveryErrors(errors: string[]): void {
    ctx.showErrorsIn(wrap, '#pol-rec-errors', errors);
  }

  function updatePreview(): void {
    const hashEl = wrap.querySelector<HTMLElement>('#pol-rec-prev-hash')!;
    const docEl = wrap.querySelector<HTMLElement>('#pol-rec-prev-doc')!;
    const diffEl = wrap.querySelector<HTMLElement>('#pol-rec-prev-diff')!;
    const showNone = (msg: string) => {
      hashEl.textContent = '—';
      docEl.textContent = '—';
      diffEl.textContent = msg;
    };
    const { doc, blocked, loaded, isFirstApply } = ctx.getBaseline();
    if (!loaded) return showNone('Reading the applied document…');
    if (blocked !== null || doc === null) return showNone(blocked ?? 'Unavailable.');

    const draft = collectRecoveryDraft();
    const validation = validateRecoveryDraft(draft, doc);
    if (!validation.ok) return showNone('Fill in the form to see what would change.');

    let merged: PolicyDoc;
    try {
      merged = upsertRecovery(doc, draft, ctx.networkPassphrase);
    } catch (e) {
      return showNone(e instanceof Error ? e.message : String(e));
    }
    const hash = docHash(merged);
    hashEl.textContent = hash;
    docEl.innerHTML = renderDocPreviewHtml(summarizeDoc(merged, hash), canonicalJson(merged));
    diffEl.innerHTML = renderDocDiffHtml(diffPolicyDocs(isFirstApply ? null : doc, merged));
  }

  async function submitRecovery(): Promise<void> {
    const { doc, blocked } = ctx.getBaseline();
    if (doc === null || blocked !== null) {
      showRecoveryErrors([blocked ?? 'The policy baseline is unavailable.']);
      return;
    }
    const draft = collectRecoveryDraft();
    const validation = validateRecoveryDraft(draft, doc);
    if (!validation.ok) {
      showRecoveryErrors(validation.errors);
      return;
    }
    showRecoveryErrors([]);
    await ctx.applyUpdate({
      wrap,
      submitSel: '#pol-rec-submit',
      statusSel: '#pol-rec-status',
      showErrors: showRecoveryErrors,
      buildDoc: () => upsertRecovery(doc, draft, ctx.networkPassphrase),
      successToast: 'Recovery enrolled.',
      rerender: () => {
        render();
        updatePreview();
      },
    });
  }

  function wireRecoveryPanel(): void {
    wrap.querySelectorAll<HTMLElement>('input, select').forEach((el) => {
      el.addEventListener('input', updatePreview);
    });
    wrap.querySelector<HTMLFormElement>('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      void submitRecovery();
    });
    updatePreview();
  }

  return { render, updatePreview };
}
