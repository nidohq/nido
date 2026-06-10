import { esc } from "../html.js";
import { shortAddr } from "../address.js";
import type { AssetHolding } from "./types.js";

/**
 * Render one AssetHolding as a Nido `.row` anchor (an HTML string for
 * `innerHTML`). Every interpolated field is `esc()`-escaped — asset codes and
 * domains come from third-party lists and on-chain events, so they are
 * attacker-influenced strings.
 *
 * Unverified tokens (not native / not on the curated list) never show their
 * self-reported domain or issuer — anyone can emit events naming any code,
 * so a spoofed "USDC" must stay visually distinguishable from the curated
 * one: it gets its contract id and an explicit "unverified" tag instead.
 */
export function assetRowHtml(a: AssetHolding): string {
  const initial = (a.code[0] ?? "?").toUpperCase();
  const sub = a.verified
    ? a.domain ?? (a.issuer ? shortAddr(a.issuer, 4, 4) : shortAddr(a.contractId, 4, 4))
    : `${shortAddr(a.contractId, 4, 4)} · unverified`;
  // Logo over the letter chip; if the image 404s the card's error handler
  // removes it, revealing the letter. verified-only is enforced upstream
  // (toHolding) — re-checked here because this is the rendering boundary.
  const icon = a.verified && a.icon
    ? `<img class="asset-icon" src="${esc(a.icon)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : "";
  return `<a class="row" data-contract="${esc(a.contractId)}" href="${esc(a.explorerUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(a.contractId)}">
      <span class="ricon asset-initial">${esc(initial)}${icon}</span>
      <span class="rmain"><span class="rtitle">${esc(a.code)}</span><span class="rsub">${esc(sub)}</span></span>
      <span class="ramt">${esc(a.formatted)}</span></a>`;
}
