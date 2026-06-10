import { esc } from "../html.js";
import type { ActivityItem } from "./types.js";

/**
 * Render one ActivityItem as a Nido `.row` anchor (an HTML string for
 * `innerHTML`). Shared by the home "Recent activity" card and the full
 * `/account/activity` page so the row markup lives in exactly one place.
 *
 * Every interpolated field is `esc()`-escaped. On-chain data is expected to be
 * HTML-inert (hex tx hash, base32 strkey, formatted number, alphanumeric asset
 * code) but we don't rely on that invariant — escaping defends against an asset
 * code or future field that isn't.
 */
export function activityRowHtml(it: ActivityItem): string {
  const icon = it.kind === "payment" ? (it.direction === "in" ? "↓" : "↑") : "•";
  const iconCls = it.kind === "payment" && it.direction === "in" ? "in" : "acc";
  const when = new Date(it.timestamp * 1000).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  const sign = it.kind === "payment" ? (it.direction === "in" ? "+" : "−") : "";
  // An unverified asset (genuine SAC, but not the curated/native one for its
  // code) must not render identically to the canonical asset — see classify.
  const assetTag = `${esc(it.asset)}${it.assetUnverified ? " · unverified" : ""}`;
  const amt = it.amount ? `<span class="ramt">${sign}${esc(it.amount)} <small>${assetTag}</small></span>` : "";
  return `<a class="row" href="${esc(it.explorerUrl)}" target="_blank" rel="noopener noreferrer">
      <span class="ricon ${iconCls}">${icon}</span>
      <span class="rmain"><span class="rtitle">${esc(it.title)}</span><span class="rsub">${esc(it.subtitle ?? when)}</span></span>${amt}</a>`;
}
