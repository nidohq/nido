import { esc } from "../html.js";
import { shortAddr } from "../address.js";
import { rawToDecimal, formatDecimal } from "../money.js";
import type { OpSummary } from "./txSummary.js";

/**
 * Everything needed to render a human-readable transfer review. The transfer
 * view fills this in full from the holding the user picked; the signing page
 * decodes most of it from the tx XDR and enriches `code`/`decimals` async.
 */
export interface TransferView {
  token: string; // token contract id
  from: string; // source address (C…)
  to: string; // destination address (C… / G…)
  amountRaw: bigint; // smallest-unit amount
  decimals?: number; // token decimals — formats the amount when known
  code?: string; // token code/symbol ("XLM", "USDC")
  verified?: boolean; // native / curated — code is trustworthy
  icon?: string; // https logo URL (verified only)
  fromLabel?: string; // human name for `from`, when known
  toLabel?: string; // human name for `to`, when known
  feeStroops?: bigint; // network-fee estimate (XLM stroops)
}

/** Display amount string: formatted when decimals are known, else the raw integer. */
function amountText(v: TransferView): string {
  return v.decimals != null
    ? formatDecimal(rawToDecimal(v.amountRaw, v.decimals), { maxFractionDigits: v.decimals })
    : v.amountRaw.toString();
}

function addrWithLabel(addr: string, label?: string): string {
  return label
    ? `${esc(label)} <span class="mut">(${esc(shortAddr(addr))})</span>`
    : `<span class="mono">${esc(shortAddr(addr))}</span>`;
}

function assetChip(v: TransferView): string {
  const code = v.code || shortAddr(v.token, 4, 4);
  const letter = esc((code[0] ?? "?").toUpperCase());
  const img =
    v.verified && v.icon
      ? `<img src="${esc(v.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;background:var(--paper-2);">`
      : "";
  return `<span style="position:relative;overflow:hidden;width:30px;height:30px;border-radius:9px;flex:0 0 auto;display:grid;place-items:center;background:var(--chip);color:var(--ink-soft);font-weight:800;font-size:12.5px;">${letter}${img}</span>`;
}

function row(label: string, valueHtml: string, first = false): string {
  const border = first ? "" : "border-top:1px solid var(--line-soft);";
  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;${border}">
      <span class="mut" style="font-size:13px;font-weight:600;white-space:nowrap;">${label}</span>
      <span style="font-size:13.5px;font-weight:600;text-align:right;min-width:0;word-break:break-word;">${valueHtml}</span>
    </div>`;
}

/**
 * Render a transfer as a Nido review card: a hero amount + recipient, then a
 * details card (From, Asset, optional network fee). HTML string for innerHTML
 * injection; every interpolated field is `esc()`-escaped because asset codes,
 * names and the icon URL can originate from third-party lists / on-chain data.
 */
export function renderTransferReview(v: TransferView): string {
  const code = esc(v.code || shortAddr(v.token, 4, 4));

  const feeRow =
    v.feeStroops != null
      ? row(
          "Network fee",
          `≈ ${esc(formatDecimal(rawToDecimal(v.feeStroops, 7)))} XLM <span class="mut" style="font-weight:500;">· paid for you</span>`,
        )
      : "";

  const verifiedTag = v.verified
    ? ""
    : ` <span class="chip" style="padding:2px 8px;font-size:10.5px;">unverified</span>`;

  const unverifiedNote =
    v.verified === false
      ? `<p class="mut" style="font-size:12px;line-height:1.5;margin:12px 0 0;">This token isn't on the verified list. Confirm the contract id is one you trust: <code class="mono" style="word-break:break-all;">${esc(v.token)}</code></p>`
      : "";

  return `<div class="txr">
    <div style="text-align:center;padding:6px 0 4px;">
      <div class="disp" style="font-weight:800;font-size:34px;letter-spacing:-.01em;line-height:1.1;">${esc(amountText(v))} <span class="acc">${code}</span></div>
      <div class="mut" style="font-size:13.5px;margin-top:4px;">to ${addrWithLabel(v.to, v.toLabel)}</div>
    </div>
    <div class="card" style="padding:2px 16px;margin-top:14px;">
      ${row("From", addrWithLabel(v.from, v.fromLabel), true)}
      ${row("Asset", `<span style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;">${assetChip(v)}<span>${code}${verifiedTag}</span></span>`)}
      ${feeRow}
    </div>
    ${unverifiedNote}
  </div>`;
}

/**
 * Render a name-registry `register(account, name)` as a Nido review card: the
 * action, the name being claimed, the account it binds to, the registry
 * contract, and an optional network-fee line. HTML string for innerHTML
 * injection; every interpolated field is `esc()`-escaped because the name and
 * account are decoded from transaction XDR (untrusted on the dApp signing path).
 */
export function renderNameRegister(
  op: Extract<OpSummary, { kind: "name-register" }>,
  feeStroops?: bigint,
): string {
  const feeRow =
    feeStroops != null
      ? row(
          "Network fee",
          `≈ ${esc(formatDecimal(rawToDecimal(feeStroops, 7)))} XLM <span class="mut" style="font-weight:500;">· paid for you</span>`,
        )
      : "";
  return `<div class="card" style="padding:2px 16px;">
    ${row("Action", "Register a name", true)}
    ${row("Name", `<code class="mono">${esc(op.name)}</code>`)}
    ${row("For account", `<span class="mono">${esc(shortAddr(op.account))}</span>`)}
    ${row("Registry", `<span class="mono">${esc(shortAddr(op.contract))}</span>`)}
    ${feeRow}
  </div>`;
}

/**
 * One-line summary for a non-transfer operation (a contract call we don't
 * special-case, or a classic operation) — used by the signing page so even an
 * unrecognized transaction reads as something better than a raw XDR blob.
 */
export function renderGenericOp(op: OpSummary): string {
  const line =
    op.kind === "name-register"
      ? `Registers the name <code class="mono">${esc(op.name)}</code>`
      : op.kind === "invoke"
        ? `Calls <code class="mono">${esc(op.fn)}</code> on <code class="mono">${esc(shortAddr(op.contract))}</code> (${op.argsCount} arg${op.argsCount === 1 ? "" : "s"})`
        : op.kind === "session-grant"
          ? `Grants a session key to <code class="mono">${esc(op.target)}</code>`
          : op.kind === "session-revoke"
            ? `Revokes session-key rule #${op.ruleId}`
            : op.kind === "other"
              ? `<code class="mono">${esc(op.type)}</code> operation`
              : "";
  return `<div class="card" style="padding:13px 16px;"><span style="font-size:13.5px;font-weight:600;">${line}</span></div>`;
}

export { renderSessionGrant, type SessionGrantScope } from "./sessionGrantReview.js";
