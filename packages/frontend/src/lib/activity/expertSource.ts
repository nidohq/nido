import { EXPERT_API_BASE } from "../network.js";
import { decodeExpertRecord } from "./decodeTx.js";
import { groupTxRows } from "./classify.js";
import type { ActivityItem, ActivityPage } from "./types.js";

const PAGE_LIMIT = 25;

/** Thrown when Stellar Expert refuses (402 / 429 / network) — signals the RPC fallback. */
export class ExpertUnavailableError extends Error {
  constructor(public status: number | "network") {
    super(`Stellar Expert unavailable (${status})`);
    this.name = "ExpertUnavailableError";
  }
}

/** Extract the `cursor` query param out of a Stellar Expert `_links.next.href`. */
function cursorFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const m = /[?&]cursor=([^&]+)/.exec(href);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Fetch one page of full history from Stellar Expert and classify it. */
export async function fetchExpertPage(address: string, cursor: string | null): Promise<ActivityPage> {
  const url = new URL(`${EXPERT_API_BASE}/tx`);
  url.searchParams.append("account[]", address);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(PAGE_LIMIT));
  if (cursor) url.searchParams.set("cursor", cursor);

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    throw new ExpertUnavailableError("network");
  }
  if (res.status === 402 || res.status === 429) throw new ExpertUnavailableError(res.status);
  if (!res.ok) throw new ExpertUnavailableError(res.status);

  const json = (await res.json()) as {
    _links?: { next?: { href?: string } };
    _embedded?: { records?: Array<{ hash: string; ts: number; body: string; meta: string }> };
  };
  const records = json._embedded?.records ?? [];
  const items: ActivityItem[] = records.flatMap((rec) => groupTxRows(decodeExpertRecord(rec), address));

  return {
    items,
    // End of history is an empty record set, NOT "fewer than the limit" (the
    // server always returns a `next` href while records remain).
    nextCursor: records.length === 0 ? null : cursorFromHref(json._links?.next?.href),
    source: "expert",
    partial: false,
  };
}
