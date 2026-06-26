import { esc } from "../html.js";
import { formatDecimal, rawToDecimal } from "../money.js";
import type { TxSummary } from "./txSummary.js";
import { renderGenericOp } from "./review.js";

export interface TechDetailsInput {
  txXdr?: string;
  summary?: TxSummary;
  authHashHex?: string;
}

function row(label: string, valueHtml: string, first = false): string {
  const border = first ? "" : "border-top:1px solid var(--line-soft);";
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;${border}">
      <span class="mut" style="font-size:13px;font-weight:600;white-space:nowrap;">${label}</span>
      <span style="font-size:13.5px;font-weight:600;text-align:right;min-width:0;word-break:break-word;">${valueHtml}</span>
    </div>`;
}

export function renderTechDetails(input: TechDetailsInput): string {
  const { txXdr, summary, authHashHex } = input;
  const rows: string[] = [];

  // Fee row (when summary provided)
  if (summary?.fee) {
    const feeXlm = formatDecimal(rawToDecimal(BigInt(summary.fee), 7));
    rows.push(
      row("Network fee", `≈ ${esc(feeXlm)} XLM <span class="mut" style="font-weight:500;">· network fee</span>`, rows.length === 0)
    );
  }

  // Decoded operations (when summary provided)
  if (summary?.ops) {
    for (const op of summary.ops) {
      const opHtml = renderGenericOp(op);
      // Strip the card wrapper from renderGenericOp and just use the content
      rows.push(
        row("Operation", opHtml, rows.length === 0)
      );
    }
  }

  // Auth hash row (when authHashHex provided)
  if (authHashHex) {
    rows.push(
      row("Auth hash", `<code class="mono" style="word-break:break-all;">${esc(authHashHex)}</code>`, rows.length === 0)
    );
  }

  // Raw transaction row (when txXdr provided)
  if (txXdr) {
    rows.push(
      row("Raw transaction", `<code class="mono" style="word-break:break-all;">${esc(txXdr)}</code>`, rows.length === 0)
    );
  }

  // Return a non-empty string even with no inputs
  if (rows.length === 0) {
    return `<div class="card" style="padding:2px 16px;"><span style="font-size:13px;color:var(--ink-soft);">No technical details available</span></div>`;
  }

  return `<div class="card" style="padding:2px 16px;">${rows.join("")}</div>`;
}
