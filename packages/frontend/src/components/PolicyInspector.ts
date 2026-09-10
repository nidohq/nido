// Renders the full list of a smart account's context rules — the general
// "what can happen on this account and who authorizes it" view — plus, for
// accounts with an applied perch policy document, the LOSSLESS document view
// (the doc's own rule names, signer ids, and function lists, verified
// against the stored on-chain doc_hash). Pure DOM from the pure display
// models in lib/policy/{policyView,docView}; the page fetches the data.

import type { ChainRule } from '@nidohq/passkey-sdk';
import { esc } from '../lib/html.js';
import { summarizeRule, type RuleView, type SignerView, type PolicyView } from '../lib/policy/policyView.js';
import type { DocRuleView, DocSignerView, DocViewModel } from '../lib/policy/docView.js';
import type { DocJsonSource } from '../lib/policy/docPolicyFetch.js';

export interface InspectorContext {
  /** policy contract address → registry label. */
  known?: ReadonlyMap<string, string>;
  /** current ledger sequence, for expiry classification. */
  currentLedger?: number | null;
}

function signerRow(s: SignerView): string {
  const icon = s.kind === 'passkey' ? '🔑' : '👤';
  return `<li class="pol-signer">
    <span class="pol-signer-ico" aria-hidden="true">${icon}</span>
    <span class="pol-signer-label">${esc(s.label)}</span>
    <code class="pol-mono" title="${esc(s.full)}">${esc(s.detail)}</code>
  </li>`;
}

function policyChip(p: PolicyView): string {
  const cls = p.known ? 'pol-chip known' : 'pol-chip custom';
  return `<span class="${cls}" title="${esc(p.address)}">${esc(p.label)} · ${esc(p.short)}</span>`;
}

function expiryBadge(view: RuleView): string {
  const { state, label } = view.expiry;
  if (state === 'none') return '';
  const cls = state === 'expired' ? 'pol-badge danger' : 'pol-badge';
  return `<span class="${cls}">${esc(label)}</span>`;
}

function ruleCard(view: RuleView): string {
  const badges = [
    view.isDefault ? '<span class="pol-badge primary">Primary authority</span>' : '',
    view.gated ? '<span class="pol-badge gated">Conditions apply</span>' : '',
    expiryBadge(view),
  ]
    .filter(Boolean)
    .join('');

  const scopeDetail = view.scope.detail
    ? `<code class="pol-mono" title="${esc(view.scope.detail)}">${esc(view.scope.detail)}</code>`
    : '';

  const signers = view.signers.length
    ? `<ul class="pol-signers">${view.signers.map(signerRow).join('')}</ul>`
    : `<p class="mut" style="font-size:12.5px;margin:0;">No signers — authorized entirely by attached conditions.</p>`;

  const policies = view.policies.length
    ? `<div class="pol-chips">${view.policies.map(policyChip).join('')}</div>`
    : '';

  return `<article class="card pol-card" data-rule-id="${view.ruleId}" style="padding:16px;">
    <header class="pol-head">
      <div>
        <span class="section-label">Rule ${view.ruleId}</span>
        <h3 class="pol-name disp">${esc(view.name || '(unnamed)')}</h3>
      </div>
      <div class="pol-badges">${badges}</div>
    </header>
    <p class="pol-perm">${esc(view.permission)}</p>
    <div class="pol-grid">
      <div class="pol-field">
        <span class="pol-field-label">Scope</span>
        <span class="pol-field-val">${esc(view.scope.label)} ${scopeDetail}</span>
      </div>
      <div class="pol-field">
        <span class="pol-field-label">Signers (${view.signers.length})</span>
        ${signers}
      </div>
      ${
        policies
          ? `<div class="pol-field"><span class="pol-field-label">Conditions</span>${policies}</div>`
          : ''
      }
    </div>
  </article>`;
}

// --- Document view (tiers a/b) ---------------------------------------------

function docSignerRow(s: DocSignerView): string {
  const icon = s.kind === 'passkey' ? '🔑' : '👤';
  return `<li class="pol-signer">
    <span class="pol-signer-ico" aria-hidden="true">${icon}</span>
    <span class="pol-signer-label">"${esc(s.id)}"</span>
    <span class="pol-badge">${esc(s.kindLabel)}</span>
    <code class="pol-mono" title="${esc(s.full)}">${esc(s.detail)}</code>
  </li>`;
}

function docExpiryBadge(rule: DocRuleView, currentLedger: number | null): string {
  if (rule.notAfterLedger === null) return '<span class="pol-badge">No expiry</span>';
  const expired = currentLedger !== null && currentLedger >= rule.notAfterLedger;
  const cls = expired ? 'pol-badge danger' : 'pol-badge';
  const label = expired
    ? `Expired at ledger ${rule.notAfterLedger}`
    : `Stops at ledger ${rule.notAfterLedger}`;
  return `<span class="${cls}">${esc(label)}</span>`;
}

function docRuleCard(rule: DocRuleView, currentLedger: number | null): string {
  const functions = rule.functions
    ? `<div class="pol-chips">${rule.functions.map((f) => `<span class="pol-chip known">${esc(f)}</span>`).join('')}</div>`
    : `<span class="mut" style="font-size:12.5px;">Any function</span>`;
  const capRow = rule.cap
    ? `<div class="pol-field">
        <span class="pol-field-label">Spending cap</span>
        <span class="pol-field-val">${esc(formatStroops(rule.cap.limit))} XLM per ${rule.cap.periodLedgers.toLocaleString()} ledgers (rolling)</span>
      </div>`
    : '';
  const argsBadge = rule.hasArgConstraints
    ? '<span class="pol-badge gated">Argument conditions</span>'
    : '';

  return `<article class="card pol-card" data-doc-rule="${esc(rule.name)}" style="padding:16px;">
    <header class="pol-head">
      <div>
        <span class="section-label">${esc(rule.scopeLabel)}</span>
        <h3 class="pol-name disp">${esc(rule.name)}</h3>
      </div>
      <div class="pol-badges">${argsBadge}${docExpiryBadge(rule, currentLedger)}</div>
    </header>
    <p class="pol-perm">${esc(rule.permission)}</p>
    <div class="pol-grid">
      ${
        rule.contract
          ? `<div class="pol-field">
              <span class="pol-field-label">Contract</span>
              <span class="pol-field-val"><code class="pol-mono">${esc(rule.contract)}</code></span>
            </div>`
          : ''
      }
      <div class="pol-field">
        <span class="pol-field-label">Signers</span>
        <span class="pol-field-val">${rule.signerIds.map((id) => `<span class="pol-chip">"${esc(id)}"</span>`).join('')} <span class="mut" style="font-size:12px;">${esc(rule.quorumLabel)}</span></span>
      </div>
      <div class="pol-field">
        <span class="pol-field-label">Functions</span>
        <span class="pol-field-val">${functions}</span>
      </div>
      ${capRow}
    </div>
  </article>`;
}

/** Render `limit` stroops as a short XLM amount (display only). */
function formatStroops(stroops: string): string {
  try {
    const v = BigInt(stroops);
    const whole = v / 10_000_000n;
    const frac = v % 10_000_000n;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(7, '0').replace(/0+$/, '')}`;
  } catch {
    return stroops;
  }
}

export interface DocRenderContext {
  /** Current ledger sequence, for expiry classification. */
  currentLedger?: number | null;
  /** Where the doc JSON was recovered from (storage = the lossless on-chain
   *  copy; events = event history). */
  source?: DocJsonSource | null;
}

/** Render the verified policy document (tiers a/b) into `container`. */
export function renderDocPolicy(
  container: HTMLElement,
  model: DocViewModel,
  ctx: DocRenderContext = {},
): void {
  const currentLedger = ctx.currentLedger ?? null;
  const verified = model.status === 'verified';
  const tierBadge = verified
    ? '<span class="pol-badge primary">Verified · lossless</span>'
    : '<span class="pol-badge gated">Document drift</span>';
  const sourceBadge =
    ctx.source === 'storage'
      ? '<span class="pol-badge">Stored on chain</span>'
      : ctx.source === 'events'
        ? '<span class="pol-badge">From event history</span>'
        : '';

  const driftBox =
    model.drift.length > 0
      ? `<div class="alert" role="note" style="margin-top:2px;">
          <strong style="font-size:12.5px;">The live rules have drifted from this document:</strong>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;line-height:1.5;">
            ${model.drift.map((d) => `<li>${esc(d)}</li>`).join('')}
          </ul>
        </div>`
      : '';

  container.innerHTML = `
    <article class="card pol-card pol-doc-head" style="padding:16px;">
      <header class="pol-head">
        <div>
          <span class="section-label">Policy document</span>
          <h3 class="pol-name disp">What this account's owner approved</h3>
        </div>
        <div class="pol-badges">${tierBadge}${sourceBadge}</div>
      </header>
      <p class="pol-perm mut" style="font-size:12.5px;">
        This is the document itself — names and all — checked byte-for-byte
        against the hash the account stores on chain.
      </p>
      <div class="pol-field">
        <span class="pol-field-label">Document hash</span>
        <span class="pol-field-val"><code class="pol-mono" title="${esc(model.docHash)}">${esc(model.docHashShort)}</code></span>
      </div>
      <div class="pol-field">
        <span class="pol-field-label">Signers (${model.signers.length})</span>
        <ul class="pol-signers">${model.signers.map(docSignerRow).join('')}</ul>
      </div>
      ${driftBox}
    </article>
    ${model.rules.map((r) => docRuleCard(r, currentLedger)).join('')}`;
}

/** Render (or re-render) the rule list into `container`. */
export function renderPolicyList(
  container: HTMLElement,
  rules: ChainRule[],
  ctx: InspectorContext = {},
): void {
  if (rules.length === 0) {
    container.innerHTML = `<p class="mut" style="font-size:13.5px;">No policy rules found on this account.</p>`;
    return;
  }
  const views = rules
    .slice()
    .sort((a, b) => a.ruleId - b.ruleId)
    .map((r) => summarizeRule(r, { known: ctx.known, currentLedger: ctx.currentLedger }));
  container.innerHTML = views.map(ruleCard).join('');
}
