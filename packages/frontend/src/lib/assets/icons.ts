import type { AssetHolding } from "./types.js";

/**
 * Accept only well-formed https URLs for asset icons. Icon strings come from
 * third-party lists and anchor-published tomls, so anything else (http,
 * data:, javascript:, ipfs:, garbage) is treated as absent — the row keeps
 * its letter chip.
 */
export function sanitizeIconUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export interface TomlCurrency {
  code?: string;
  issuer?: string;
  image?: string;
}

// SEP-1 caps stellar.toml at 100KB; anything bigger is malformed or hostile.
const MAX_TOML_BYTES = 100 * 1024;

/**
 * Minimal line-based parser for the [[CURRENCIES]] tables of a SEP-1
 * stellar.toml — just the three string keys icon resolution needs. A real
 * TOML parser would drag in a dependency for files that are, per spec, flat
 * `key = "value"` tables; unparseable lines are simply skipped.
 * Pure — exported for tests.
 */
export function parseTomlCurrencies(toml: string): TomlCurrency[] {
  const out: TomlCurrency[] = [];
  let current: TomlCurrency | null = null;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "[[CURRENCIES]]") {
      current = {};
      out.push(current);
      continue;
    }
    if (line.startsWith("[")) {
      current = null; // any other table ends the currency entry
      continue;
    }
    if (!current) continue;
    const m = /^(code|issuer|image)\s*=\s*"([^"]*)"/.exec(line);
    if (m) current[m[1] as keyof TomlCurrency] = m[2];
  }
  return out;
}

const cacheKey = (contractId: string) => `g2c:assets:icon:${contractId}`;

/**
 * Resolve a verified holding's icon from its anchor's SEP-1 stellar.toml
 * (`https://{domain}/.well-known/stellar.toml` — the spec requires it be
 * served with `Access-Control-Allow-Origin: *`, so a static frontend can
 * fetch it). Runs as a lazy second pass after the rows render: only for
 * verified holdings that have a domain but no list-provided icon. Both hits
 * and misses are cached per contract, so each asset costs at most one toml
 * fetch per browser. Returns undefined when no matching currency entry
 * publishes a usable image.
 */
export async function resolveTomlIcon(
  holding: AssetHolding,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  const { contractId, code, issuer, domain, verified } = holding;
  if (!verified || !domain || !code) return undefined;
  // The domain comes from a curated list, but constrain it to hostname shape
  // anyway before splicing it into a URL.
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(domain)) return undefined;

  try {
    const cached = localStorage.getItem(cacheKey(contractId));
    if (cached !== null) return sanitizeIconUrl(cached);
  } catch {
    /* storage blocked — fall through to a fresh fetch */
  }

  let icon: string | undefined;
  try {
    const res = await fetchFn(`https://${domain}/.well-known/stellar.toml`);
    if (!res.ok) return undefined; // transient? don't negative-cache
    const text = await res.text();
    if (text.length > MAX_TOML_BYTES) return undefined;
    const match = parseTomlCurrencies(text).find(
      (c) => c.code === code && (issuer === undefined || c.issuer === issuer),
    );
    icon = sanitizeIconUrl(match?.image);
  } catch {
    return undefined; // network failure — retry next load
  }

  try {
    // Cache misses as "" too: a toml without our currency won't grow one soon,
    // and this keeps repeat loads at zero toml fetches.
    localStorage.setItem(cacheKey(contractId), icon ?? "");
  } catch {
    /* best-effort cache */
  }
  return icon;
}
