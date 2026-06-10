import { EXPLORER_BASE, NATIVE_SAC_ID } from "../network.js";
import { formatDecimal, rawToDecimal } from "../money.js";
import { shortAddr } from "../address.js";
import { fetchCuratedAssets } from "./curated.js";
import { discoverFromEvents } from "./discover.js";
import { loadKnownAssets, replaceKnownAssets } from "./store.js";
import { fetchSacBalances, probeSep41Token, type TokenProbe } from "./balances.js";
import type { AssetCandidate, AssetHolding } from "./types.js";

/** SACs always expose 7 decimals (classic-asset precision). */
export const SAC_DECIMALS = 7;

// Bound the per-load simulation work: non-SAC candidates beyond the cap are
// skipped this load (curated entries sort first in the merge, so a spray can
// only starve other sprayed tokens), and probes run a few at a time.
const MAX_PROBES = 20;
const PROBE_CONCURRENCY = 5;

/**
 * Dedup candidates by contract id. Earlier groups win on conflicts but
 * metadata gaps are backfilled from later ones (the curated list usually has
 * the richest metadata; an event find for the same token adds nothing).
 * Pure — exported for tests.
 */
export function mergeCandidates(...groups: AssetCandidate[][]): AssetCandidate[] {
  const byId = new Map<string, AssetCandidate>();
  for (const group of groups) {
    for (const c of group) {
      const prev = byId.get(c.contractId);
      byId.set(
        c.contractId,
        prev
          ? {
              ...prev,
              code: prev.code || c.code,
              issuer: prev.issuer || c.issuer,
              domain: prev.domain || c.domain,
              decimals: prev.decimals ?? c.decimals,
              icon: prev.icon || c.icon,
              sac: prev.sac || c.sac,
            }
          : c,
      );
    }
  }
  return [...byId.values()];
}

/** Display order: XLM first, then alphabetical by code. Pure — exported for tests. */
export function sortHoldings(items: AssetHolding[]): AssetHolding[] {
  return [...items].sort((a, b) => {
    if (a.contractId === NATIVE_SAC_ID) return -1;
    if (b.contractId === NATIVE_SAC_ID) return 1;
    return a.code.localeCompare(b.code, "en");
  });
}

function toHolding(c: AssetCandidate, raw: bigint, decimals: number): AssetHolding {
  const verified = c.source === "native" || c.source === "curated";
  return {
    contractId: c.contractId,
    code: c.code || shortAddr(c.contractId, 4, 4),
    issuer: c.issuer,
    domain: c.domain,
    decimals,
    raw,
    formatted: formatDecimal(rawToDecimal(raw, decimals)),
    verified,
    // Icons only for verified assets: a spoofed "USDC" must not be able to
    // wear the real logo (same posture as the unverified row tag).
    icon: verified ? c.icon : undefined,
    explorerUrl: `${EXPLORER_BASE}/contract/${c.contractId}`,
  };
}

/** Probe non-SAC candidates a few at a time; one failed probe never sinks the rest. */
async function probeAll(candidates: AssetCandidate[], address: string): Promise<(TokenProbe | null)[]> {
  const out: (TokenProbe | null)[] = new Array(candidates.length).fill(null);
  for (let i = 0; i < candidates.length; i += PROBE_CONCURRENCY) {
    const batch = candidates.slice(i, i + PROBE_CONCURRENCY);
    const probes = await Promise.all(
      batch.map((c) => probeSep41Token(c.contractId, address).catch(() => null)),
    );
    probes.forEach((p, j) => {
      out[i + j] = p;
    });
  }
  return out;
}

/**
 * All assets the account holds, best-effort within a static frontend's reach.
 *
 * Candidates: native XLM (always) + the curated SEP-42 testnet list + tokens
 * seen in recent transfer events (~1-day scan; RPC retention caps deeper
 * walks at ~7 days) + this browser's persisted confirmed holdings. Balances:
 * batched ledger-entry reads for SAC-backed assets, a balance() simulation
 * per non-SAC SEP-41 token. Full enumeration of an arbitrary C-address is
 * not possible without an indexer today — Horizon can't see contract
 * balances at all and RPC has no portfolio API (issue #71 documents the
 * research) — so a token outside the curated list whose last move predates
 * the scan window and was never confirmed by this browser is missed until it
 * next moves.
 *
 * Zero balances are hidden, except XLM which anchors the list. Tokens are
 * only persisted AFTER a nonzero balance is confirmed, so sprayed junk
 * events can't accumulate in localStorage or future probe work.
 */
export async function loadAssets(address: string): Promise<AssetHolding[]> {
  const native: AssetCandidate = {
    contractId: NATIVE_SAC_ID,
    code: "XLM",
    domain: "stellar.org",
    sac: true,
    source: "native",
  };
  const [curated, discovered] = await Promise.all([
    fetchCuratedAssets(),
    discoverFromEvents(address),
  ]);
  const stored = loadKnownAssets(address);
  const candidates = mergeCandidates([native], curated, discovered, stored);

  const sacs = candidates.filter((c) => c.sac);
  const others = candidates.filter((c) => !c.sac).slice(0, MAX_PROBES);

  const holdings: AssetHolding[] = [];

  const sacBalances = await fetchSacBalances(sacs.map((c) => c.contractId), address);
  for (const c of sacs) {
    const raw = sacBalances.get(c.contractId) ?? 0n;
    if (raw <= 0n && c.contractId !== NATIVE_SAC_ID) continue;
    holdings.push(toHolding(c, raw, SAC_DECIMALS));
  }

  const probes = await probeAll(others, address);
  others.forEach((c, i) => {
    const probe = probes[i];
    if (!probe || probe.balance <= 0n) return;
    try {
      holdings.push(toHolding({ ...c, code: c.code || probe.symbol }, probe.balance, c.decimals ?? probe.decimals));
    } catch {
      /* one malformed token must not sink the card */
    }
  });

  // Persist exactly the confirmed non-curated holdings: finds survive the
  // short event window, sold/junk tokens prune themselves next load.
  const curatedIds = new Set(curated.map((c) => c.contractId));
  const held = new Set(holdings.map((h) => h.contractId));
  replaceKnownAssets(
    address,
    mergeCandidates(discovered, stored).filter(
      (c) => held.has(c.contractId) && !curatedIds.has(c.contractId) && c.contractId !== NATIVE_SAC_ID,
    ),
  );

  return sortHoldings(holdings);
}
