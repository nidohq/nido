// Pure decisions for the name-claim flow. No DOM, no network — unit-tested.
// See docs/superpowers/specs/2026-06-18-name-centric-inline-claim-design.md
import { accountUrl, isContractId } from "@nidohq/passkey-sdk";

/** A valid Nido name: a lowercase letter, then 0–14 more lowercase letters/digits (1–15 chars total). */
export const VALID_NAME_RE = /^[a-z][a-z0-9]{0,14}$/;

export type NameState = "available" | "taken" | "invalid";

/**
 * Classify a name subdomain for the claim entry:
 *  - "invalid"   → fails VALID_NAME_RE (reserved/garbage)
 *  - "taken"     → registry resolved it to a contract id
 *  - "available" → valid syntax, no registry entry
 */
export function classifyNameState(name: string, resolved: string | null): NameState {
  if (!VALID_NAME_RE.test(name)) return "invalid";
  return resolved ? "taken" : "available";
}

export type ClaimerSource = "param" | "single" | "recent" | "none";

export interface ClaimerSelection {
  /** Chosen claimer contract id, or null when there is none to default to. */
  contractId: string | null;
  source: ClaimerSource;
}

/**
 * Pick which account claims the name:
 *  - explicit `?account=` param (a valid contract id) wins → "param"
 *  - exactly one known account → "single"
 *  - several → most-recently-used by `lastUsed`, ties broken by list order → "recent"
 *  - none → null / "none" (caller routes to /new-account)
 */
export function selectClaimer(
  paramAccount: string | null,
  accounts: string[],
  lastUsed: Record<string, number> = {},
): ClaimerSelection {
  if (paramAccount) {
    const id = paramAccount.toUpperCase();
    if (isContractId(id)) return { contractId: id, source: "param" };
  }
  if (accounts.length === 0) return { contractId: null, source: "none" };
  if (accounts.length === 1) return { contractId: accounts[0], source: "single" };
  let best = accounts[0];
  let bestTs = lastUsed[best] ?? 0;
  for (const id of accounts) {
    const ts = lastUsed[id] ?? 0;
    if (ts > bestTs) {
      best = id;
      bestTs = ts;
    }
  }
  return { contractId: best, source: "recent" };
}

/** Human label for a claimer row: its name, else a shortened contract id. */
export function formatClaimerLabel(contractId: string, name: string | null): string {
  if (name) return name;
  return `${contractId.slice(0, 4)}…${contractId.slice(-4)}`;
}

export interface HandoffParams {
  /** apex host, e.g. nido.fyi — use stripSubdomain(location.host). */
  apexHost: string;
  /** current host, e.g. alice.nido.fyi (breadcrumb). */
  fromHost: string;
  /** name being claimed, e.g. "alice". */
  claimName: string;
  /** claimer contract id (authoritative). */
  claimerContractId: string;
  /** claimer's existing name if any (its home subdomain key), else null. */
  claimerName: string | null;
  /** protocol incl. trailing colon, default "https:". */
  protocol?: string;
}

/**
 * Build the absolute URL that hands the claim off to the account's OWN
 * subdomain (where its passkey rpId matches), carrying the target name and the
 * authoritative claimer id as params. accountUrl returns a protocol-relative
 * `//host/path`, so we prepend the protocol.
 */
export function buildClaimHandoffUrl(p: HandoffParams): string {
  const key = p.claimerName ?? p.claimerContractId;
  const search = new URLSearchParams({
    claim: p.claimName,
    account: p.claimerContractId,
    from: p.fromHost,
  });
  const rel = accountUrl(p.apexHost, key, `/account/?${search.toString()}`);
  return `${p.protocol ?? "https:"}${rel}`;
}

export interface ReturnIntent {
  kind: "claim";
  name: string;
}

/** Parse a `?then=claim:alice` return intent. Null when absent/malformed. */
export function parseReturnIntent(then: string | null): ReturnIntent | null {
  if (!then) return null;
  const m = /^claim:(.+)$/.exec(then);
  if (!m) return null;
  const name = m[1].toLowerCase();
  return VALID_NAME_RE.test(name) ? { kind: "claim", name } : null;
}

export interface ReturnTargetParams {
  apexHost: string;
  name: string;
  contractId: string;
  protocol?: string;
}

/**
 * After new-account finishes, build the URL back to the name subdomain's
 * account page so the confirm→claim path runs for the freshly-created account.
 */
export function buildClaimReturnUrl(p: ReturnTargetParams): string {
  const search = new URLSearchParams({ account: p.contractId });
  const rel = accountUrl(p.apexHost, p.name, `/account/?${search.toString()}`);
  return `${p.protocol ?? "https:"}${rel}`;
}
