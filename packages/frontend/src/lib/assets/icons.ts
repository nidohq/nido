import { Keypair, rpc, xdr } from "@stellar/stellar-sdk";
import { RPC_URL } from "../network.js";
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
 * The issuer account's on-chain home_domain. Curated lists often omit
 * domains (stellar.expert's testnet top50 carries none at all), but classic
 * issuers declare their domain on-chain — the canonical SEP-1 discovery
 * path. Resolves undefined when the account doesn't exist or declares no
 * domain (definite); throws on RPC failure (transient) so callers can avoid
 * negative-caching it.
 */
export async function fetchIssuerHomeDomain(issuer: string, rpcUrl = RPC_URL): Promise<string | undefined> {
  const server = new rpc.Server(rpcUrl);
  const key = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(issuer).xdrAccountId() }),
  );
  const res = await server.getLedgerEntries(key);
  const entry = res.entries[0];
  if (!entry) return undefined;
  const domain = entry.val.account().homeDomain().toString();
  return domain || undefined;
}

/**
 * Resolve a verified holding's icon from its anchor's SEP-1 stellar.toml
 * (`https://{domain}/.well-known/stellar.toml` — the spec requires it be
 * served with `Access-Control-Allow-Origin: *`, so a static frontend can
 * fetch it). Runs as a lazy second pass after the rows render, only for
 * verified holdings without a list-provided icon. The domain comes from the
 * curated list when present, else from the issuer's on-chain home_domain.
 * Currency matching prefers exact code+issuer but falls back to code-only:
 * anchors usually publish only their mainnet issuers (centre.io lists no
 * testnet USDC), and the domain is the issuer's own declaration, so its
 * images are trustworthy for its asset codes. Both hits and misses are
 * cached per contract, so each asset costs at most one toml fetch per
 * browser. Returns undefined when nothing usable resolves.
 */
export async function resolveTomlIcon(
  holding: AssetHolding,
  fetchFn: typeof fetch = fetch,
  lookupDomain: (issuer: string) => Promise<string | undefined> = fetchIssuerHomeDomain,
): Promise<string | undefined> {
  const { contractId, code, issuer, verified } = holding;
  if (!verified || !code) return undefined;

  try {
    const cached = localStorage.getItem(cacheKey(contractId));
    if (cached !== null) return sanitizeIconUrl(cached);
  } catch {
    /* storage blocked — fall through to a fresh fetch */
  }

  const negativeCache = () => {
    try {
      // Cache misses as "" too: a toml without our currency won't grow one
      // soon, and this keeps repeat loads at zero fetches.
      localStorage.setItem(cacheKey(contractId), "");
    } catch {
      /* best-effort cache */
    }
  };

  let domain = holding.domain;
  if (!domain && issuer) {
    try {
      domain = await lookupDomain(issuer);
    } catch {
      return undefined; // RPC failure — retry next load
    }
    if (!domain) {
      negativeCache(); // issuer declares no domain: definite miss
      return undefined;
    }
  }
  // The domain comes from a curated list or the issuer's account entry, but
  // constrain it to hostname shape anyway before splicing it into a URL.
  if (!domain || !/^[a-z0-9][a-z0-9.-]*$/i.test(domain)) return undefined;

  let icon: string | undefined;
  try {
    const res = await fetchFn(`https://${domain}/.well-known/stellar.toml`);
    if (!res.ok) return undefined; // transient? don't negative-cache
    const text = await res.text();
    if (text.length > MAX_TOML_BYTES) return undefined;
    const currencies = parseTomlCurrencies(text);
    const match =
      currencies.find((c) => c.code === code && c.issuer === issuer) ??
      currencies.find((c) => c.code === code);
    icon = sanitizeIconUrl(match?.image);
  } catch {
    return undefined; // network failure — retry next load
  }

  if (icon === undefined) {
    negativeCache();
    return undefined;
  }
  try {
    localStorage.setItem(cacheKey(contractId), icon);
  } catch {
    /* best-effort cache */
  }
  return icon;
}
