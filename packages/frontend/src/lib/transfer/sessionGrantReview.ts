import { esc } from "../html.js";
import { shortAddr } from "../address.js";
import { stroopsToXlm } from "../money.js";
import { PERIOD_LABEL, type LimitPeriod } from "../spendingLimitParams.js";
import type { OpSummary } from "./txSummary.js";

export interface SessionGrantScope {
  origin: string;
  limitStroops: string | null;
  period: LimitPeriod;
  expiryLabel: string;
}

function row(label: string, valueHtml: string, first = false): string {
  const border = first ? "" : "border-top:1px solid var(--line-soft);";
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;${border}">
      <span class="mut" style="font-size:13px;font-weight:600;white-space:nowrap;">${label}</span>
      <span style="font-size:13.5px;font-weight:600;text-align:right;min-width:0;word-break:break-word;">${valueHtml}</span>
    </div>`;
}

export function renderSessionGrant(
  op: Extract<OpSummary, { kind: "session-grant" }>,
  scope: SessionGrantScope,
): string {
  const cap =
    scope.limitStroops == null
      ? `Any amount <span class="mut" style="font-weight:500;">(no cap)</span>`
      : `Up to ${esc(stroopsToXlm(BigInt(scope.limitStroops)))} XLM <span class="mut" style="font-weight:500;">${esc(PERIOD_LABEL[scope.period])}</span>`;
  return `<div class="card" style="padding:2px 16px;">
    ${row("Action", "Grant an app a session key", true)}
    ${row("App", `<span class="mono">${esc(scope.origin)}</span>`)}
    ${row("Can spend", cap)}
    ${row("Expires", esc(scope.expiryLabel))}
    ${row("On contract", `<span class="mono">${esc(shortAddr(op.target))}</span>`)}
  </div>`;
}

/** The doc-based session grant (an apply-policy-doc SignRequest): same
 *  review-card conventions as renderSessionGrant, plus the doc-only rows —
 *  the rule's own name, the named functions, and the doc_hash the account
 *  will store on chain. */
export interface DocSessionGrantView {
  origin: string;
  ruleName: string;
  target: string;
  /** The delegated session signer (C… or G…). */
  signer: string;
  /** Named functions, or null for "any function". */
  functions: string[] | null;
  expiryLabel: string;
  capStroops: string | null;
  capPeriod: LimitPeriod;
  /** Lowercase-hex canonical doc_hash. */
  docHash: string;
}

export function renderDocSessionGrant(v: DocSessionGrantView): string {
  const cap =
    v.capStroops == null
      ? `Any amount <span class="mut" style="font-weight:500;">(no cap)</span>`
      : `Up to ${esc(stroopsToXlm(BigInt(v.capStroops)))} XLM <span class="mut" style="font-weight:500;">${esc(PERIOD_LABEL[v.capPeriod])}</span>`;
  const fns =
    v.functions == null
      ? `Any function`
      : v.functions.map((f) => `<span class="mono">${esc(f)}</span>`).join(", ");
  return `<div class="card" style="padding:2px 16px;">
    ${row("Action", "Grant an app a scoped session key", true)}
    ${row("App", `<span class="mono">${esc(v.origin)}</span>`)}
    ${row("Rule name", `<span class="mono">${esc(v.ruleName)}</span>`)}
    ${row("App's key", `<span class="mono">${esc(shortAddr(v.signer))}</span>`)}
    ${row("On contract", `<span class="mono">${esc(shortAddr(v.target))}</span>`)}
    ${row("Functions", fns)}
    ${row("Can spend", cap)}
    ${row("Expires", esc(v.expiryLabel))}
    ${row("Document hash", `<span class="mono" title="${esc(v.docHash)}">${esc(v.docHash.slice(0, 8))}…${esc(v.docHash.slice(-8))}</span>`)}
  </div>`;
}
