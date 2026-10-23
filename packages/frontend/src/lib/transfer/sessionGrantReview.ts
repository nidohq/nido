import { esc, fnCallHtml } from "../html.js";
import { shortAddr } from "../address.js";
import { stroopsToXlm } from "../money.js";
import { PERIOD_LABEL, type LimitPeriod } from "../spendingLimitParams.js";
import { NO_CAP_NO_TOKEN_FUNCTIONS, canMoveTokens } from "../policy/tokenFunctions.js";
import { canTransfer } from "../policy/reviewText.js";
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
  /** Who signs under the granted rule: an address (C… or G…) for a
   *  delegated signer, a key for a passkey. */
  signers: string[];
  /** Named functions, or null for "any function". */
  functions: string[] | null;
  expiryLabel: string;
  capStroops: string | null;
  capPeriod: LimitPeriod;
  /** Lowercase-hex canonical doc_hash. */
  docHash: string;
  /** This rule's place when one request grants several. */
  position?: { index: number; count: number };
  /** The only address its `transfer` may pay (null = any), and, when that
   *  is a contract another rule of the request calls, that rule's name. */
  recipient?: { address: string | null; ruleName?: string };
}

/** Whom the rule's `transfer` may pay, for a rule that may call it. */
function payRow(v: DocSessionGrantView): string {
  if (!canTransfer(v.functions)) return "";
  const to = v.recipient?.address ?? null;
  if (to === null) return row("Can pay", "Any address");
  const note = v.recipient?.ruleName
    ? ` <span class="mut" style="font-weight:500;">(the contract “${esc(v.recipient.ruleName)}” calls)</span>`
    : "";
  return row("Can pay", `Only <span class="mono" title="${esc(to)}">${esc(shortAddr(to))}</span>${note}`);
}

export function renderDocSessionGrant(v: DocSessionGrantView): string {
  // Uncapped: "any amount" only where the rule allows a token function; a
  // rule that allows none says so, as the approval page does.
  const cap =
    v.capStroops == null
      ? canMoveTokens(v.functions)
        ? `Any amount <span class="mut" style="font-weight:500;">(no cap)</span>`
        : esc(NO_CAP_NO_TOKEN_FUNCTIONS)
      : `Up to ${esc(stroopsToXlm(BigInt(v.capStroops)))} XLM <span class="mut" style="font-weight:500;">${esc(PERIOD_LABEL[v.capPeriod])}</span>`;
  const fns =
    v.functions == null
      ? `Any function`
      : v.functions.map(fnCallHtml).join(", ");
  const action =
    v.position && v.position.count > 1
      ? `Grant an app a scoped session key <span class="mut" style="font-weight:500;">(rule ${v.position.index + 1} of ${v.position.count})</span>`
      : "Grant an app a scoped session key";
  return `<div class="card" data-grant-rule="${esc(v.ruleName)}" style="padding:2px 16px;">
    ${row("Action", action, true)}
    ${row("App", `<span class="mono">${esc(v.origin)}</span>`)}
    ${row("Rule name", `<span class="mono">${esc(v.ruleName)}</span>`)}
    ${row("App's key", v.signers.map((k) => `<span class="mono" title="${esc(k)}">${esc(shortAddr(k, 6, 6))}</span>`).join(", ") || "(none)")}
    ${row("On contract", `<span class="mono">${esc(shortAddr(v.target))}</span>`)}
    ${row("Functions", fns)}
    ${row("Can spend", cap)}
    ${payRow(v)}
    ${row("Expires", esc(v.expiryLabel))}
    ${row("Document hash", `<span class="mono" title="${esc(v.docHash)}">${esc(v.docHash.slice(0, 8))}…${esc(v.docHash.slice(-8))}</span>`)}
  </div>`;
}
