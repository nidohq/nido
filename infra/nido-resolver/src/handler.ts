/**
 * nido-resolver — serves GET <subdomain>.nido.fyi/.well-known/nido.json,
 * turning a Nido name into the account's contract address (forward) and a
 * contract address into its name (reverse). Read-only.
 *
 * This module is pure: registry access is injected as `Registry` so the handler
 * is unit-testable without Soroban RPC. The real implementation lives in
 * ./registry.ts.
 */

/** name <-> address resolution against the on-chain name registry. */
export interface Registry {
  /** name -> C-address, or null if the name is unregistered.
   *  MUST throw on RPC/transport failure (so the handler can answer 502). */
  resolve(name: string): Promise<string | null>;
  /** C-address -> its registered name, or null if the account has none.
   *  MUST throw on RPC/transport failure. */
  lookup(address: string): Promise<string | null>;
}

const WELL_KNOWN_PATH = "/.well-known/nido.json";

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

// Subdomain rules — keep in sync with packages/passkey-sdk/src/url.ts.
const RESERVED_DAPP_SUBDOMAINS: Record<string, true> = { "status-message": true };
// Contract id: 56-char strkey, 'C' + 55 base32 (RFC4648, no padding) chars.
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
// Name: 1-15 chars, lowercase letter then letters/digits (mirrors the claim form).
const NAME_RE = /^[a-z][a-z0-9]{0,14}$/;

/** Strip a `--<N>` / `--pr-<N>` preview suffix from a subdomain label. */
function stripPreview(label: string): string {
  const m = label.match(/^(.*)--(?:pr-)?\d+$/);
  return m ? m[1] : label;
}

function json(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache, ...CORS },
  });
}

const OK_CACHE = "public, max-age=60";
const MISS_CACHE = "public, max-age=10";

export async function handleResolve(
  request: Request,
  registry: Registry,
  network: string,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405, MISS_CACHE);
  }

  const url = new URL(request.url);
  if (url.pathname !== WELL_KNOWN_PATH) {
    // The route only forwards /.well-known/nido.json; be defensive anyway.
    return json({ error: "not found" }, 404, MISS_CACHE);
  }

  const firstLabel = url.hostname.split(".")[0] ?? "";
  const raw = stripPreview(firstLabel);
  const candidate = raw.toUpperCase();

  // Contract-id subdomain -> reverse lookup. The address is valid on its own,
  // so a missing name is `null`, not a 404.
  if (CONTRACT_ID_RE.test(candidate)) {
    try {
      const name = await registry.lookup(candidate);
      return json({ name: name ?? null, address: candidate, network }, 200, OK_CACHE);
    } catch {
      return json({ error: "resolver upstream unavailable" }, 502, "no-store");
    }
  }

  // Name subdomain -> forward resolve. Exclude preview roots ("126", "pr-126")
  // and reserved dApp subdomains, mirroring nameFromHostname.
  const name = raw.toLowerCase();
  const isPreviewRoot = /^\d+$/.test(firstLabel) || /^pr-\d+$/.test(firstLabel);
  if (!isPreviewRoot && NAME_RE.test(name) && !RESERVED_DAPP_SUBDOMAINS[name]) {
    try {
      const address = await registry.resolve(name);
      if (!address) {
        return json({ error: "name not found", name, network }, 404, MISS_CACHE);
      }
      return json({ name, address, network }, 200, OK_CACHE);
    } catch {
      return json({ error: "resolver upstream unavailable" }, 502, "no-store");
    }
  }

  return json({ error: "not a Nido account" }, 404, MISS_CACHE);
}
