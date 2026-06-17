import { NATIVE_SAC_ID, NETWORK_NAME } from "../network.js";
import { sanitizeDecimals } from "./balances.js";
import { sanitizeIconUrl } from "./icons.js";
import type { AssetCandidate } from "./types.js";

/**
 * SEP-42 curated asset lists. Two complementary CORS-open sources (unlike
 * Stellar Expert's balance and `/tx` APIs, which are origin-gated):
 * - Stellar Expert's top-50 (Freighter's default testnet list): the broad
 *   set — testnet entries carry NO domain or icon fields at all, so icon
 *   resolution falls back to the issuer's on-chain home_domain (icons.ts).
 * - Soroswap's list: a smaller set that DOES carry icon URLs — including
 *   one for native XLM, whose entry merges into the always-present native
 *   candidate downstream.
 * Each entry carries the asset's SAC contract id, which is what the balance
 * probe needs (issue #71).
 */
export const CURATED_LIST_URL =
  `https://api.stellar.expert/explorer/${NETWORK_NAME}/asset-list/top50`;
export const SOROSWAP_LIST_URL = "https://api.soroswap.finance/api/tokens";

const isContractId = (s: unknown): s is string =>
  typeof s === "string" && /^C[A-Z2-7]{55}$/.test(s);

/**
 * Parse a SEP-42 asset-list document into candidates. Entries without a
 * valid SAC contract id are dropped. A native-XLM entry is kept: it dedups
 * into the orchestrator's always-present native candidate, backfilling its
 * icon/domain. Pure — exported for tests.
 */
export function parseAssetList(doc: unknown): AssetCandidate[] {
  const assets = (doc as { assets?: unknown } | null)?.assets;
  if (!Array.isArray(assets)) return [];
  const out: AssetCandidate[] = [];
  for (const entry of assets) {
    const e = entry as Record<string, unknown>;
    if (!isContractId(e.contract)) continue;
    // Normalize empty strings to absent — "" would win ?? / || fallback
    // chains downstream and render a blank row title.
    const issuer = typeof e.issuer === "string" && e.issuer ? e.issuer : undefined;
    out.push({
      contractId: e.contract,
      code: typeof e.code === "string" && e.code ? e.code : undefined,
      issuer,
      domain: typeof e.domain === "string" && e.domain ? e.domain : undefined,
      decimals: sanitizeDecimals(e.decimals) ?? undefined,
      icon: sanitizeIconUrl(e.icon),
      // A classic issuer means the contract is that asset's SAC; entries
      // without one are standalone Soroban tokens (custom storage layout).
      sac: issuer !== undefined,
      source: "curated",
    });
  }
  return out;
}

/** Soroswap serves all networks in one array — pluck ours into SEP-42 shape. */
export function pluckSoroswapNetwork(doc: unknown): unknown {
  if (!Array.isArray(doc)) return null;
  return doc.find((n) => (n as { network?: unknown })?.network === NETWORK_NAME) ?? null;
}

const LISTS: { url: string; cacheKey: string; pluck: (doc: unknown) => unknown }[] = [
  { url: CURATED_LIST_URL, cacheKey: "nido:assets:curated", pluck: (doc) => doc },
  { url: SOROSWAP_LIST_URL, cacheKey: "nido:assets:curated:soroswap", pluck: pluckSoroswapNetwork },
];

async function fetchList(list: (typeof LISTS)[number]): Promise<AssetCandidate[]> {
  try {
    const res = await fetch(list.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc: unknown = await res.json();
    const parsed = parseAssetList(list.pluck(doc));
    if (parsed.length > 0) {
      try {
        localStorage.setItem(list.cacheKey, JSON.stringify(doc));
      } catch {
        /* storage full/blocked — caching is best-effort */
      }
    }
    return parsed;
  } catch {
    try {
      const cached = localStorage.getItem(list.cacheKey);
      if (cached) return parseAssetList(list.pluck(JSON.parse(cached)));
    } catch {
      /* corrupt cache — treat as absent */
    }
    return [];
  }
}

// One fetch pair per page load: the assets card AND both activity surfaces
// consume the lists; Astro full-reloads between navigations, so module state
// lives exactly one page view. (Never rejects, so no eviction needed.)
let curatedPromise: Promise<AssetCandidate[]> | null = null;

/**
 * Fetch the curated lists, falling back per-list to the last good copy
 * cached in localStorage. Order matters: top-50 entries come first so their
 * richer metadata wins merges, with Soroswap icons backfilling the gaps.
 * Returns [] when nothing is available — the assets card still shows XLM +
 * discovered tokens. Memoized per page load.
 */
export function fetchCuratedAssets(): Promise<AssetCandidate[]> {
  curatedPromise ??= Promise.all(LISTS.map(fetchList)).then((groups) => groups.flat());
  return curatedPromise;
}

/** Reset the per-page list memo (tests only). */
export function clearCuratedAssetsCache(): void {
  curatedPromise = null;
}

/**
 * The SAC contract ids the curated lists vouch for, plus native XLM — the
 * trust set the activity feed uses to tell the canonical "USDC" from a
 * genuine-but-unknown issuer's SAC wearing the same code. Best-effort: when
 * both lists are unavailable only XLM counts as curated (rows degrade to
 * "unverified", never to silently trusted).
 */
export async function fetchCuratedSacIds(): Promise<Set<string>> {
  const curated = await fetchCuratedAssets();
  const ids = new Set(curated.filter((c) => c.sac).map((c) => c.contractId));
  ids.add(NATIVE_SAC_ID);
  return ids;
}
