const PREVIEW_SEP = "--";

/**
 * Reserved subdomains that map to a built-in dApp path on this site.
 * `status-message.<base>` is served the same static bundle as the wallet,
 * but the root page redirects to the listed path. Keep keys lowercase.
 */
export const RESERVED_DAPP_SUBDOMAINS: Record<string, string> = {
  'status-message': '/status-message/',
};

/**
 * If `host` is a reserved dApp subdomain, return the path the root should
 * redirect to. Strips any numeric preview suffix before matching, so
 * `status-message--24.<base>` resolves the same as production.
 */
export function dappPathFromHostname(host: string): string | null {
  const parts = host.split(".");
  if (parts.length <= 1) return null;
  const raw = previewSubdomain(parts[0]).raw.toLowerCase();
  return RESERVED_DAPP_SUBDOMAINS[raw] ?? null;
}

/**
 * Build a protocol-relative URL to a reserved-dApp subdomain, preserving the
 * preview prefix if the calling page is in a PR preview. Mirrors `accountUrl`
 * but for dApp names rather than contract IDs.
 *
 *   dappUrl("cabc--24.mysoroban.xyz", "status-message", "/?contract=C…")
 *     → "//status-message--24.mysoroban.xyz/?contract=C…"
 *
 *   dappUrl("cabc.mysoroban.xyz", "status-message", "/?contract=C…")
 *     → "//status-message.mysoroban.xyz/?contract=C…"
 *
 * Pass `window.location.host` (with port) as the host parameter.
 */
export function dappUrl(host: string, dappName: string, path: string = "/"): string {
  const preview = previewPrefix(host);
  if (preview) {
    // Drop the calling page's first label entirely (whether it's a
    // contract+preview subdomain, bare preview root, or another reserved
    // dApp) and rebuild from the apex.
    const apex = host.split(".").slice(1).join(".");
    return `//${dappName}${PREVIEW_SEP}${preview}.${apex}${path}`;
  }
  // Production: the calling host could be a contract subdomain
  // (cabc.mysoroban.xyz), a name subdomain (alice.mysoroban.xyz), the apex
  // (mysoroban.xyz), or another reserved dApp (status-message.mysoroban.xyz).
  // Strip to the apex: 3+ labels means there's a subdomain to drop, 2 labels
  // means we're already at the apex. (This codebase doesn't deal with
  // multi-segment TLDs like co.uk.)
  const parts = host.split(".");
  const apex = parts.length > 2 ? parts.slice(1).join(".") : host;
  return `//${dappName}.${apex}${path}`;
}

/**
 * Check if a subdomain string looks like a Stellar contract ID.
 * Contract IDs are exactly 56 characters starting with C.
 */
export function isContractId(subdomain: string): boolean {
  return subdomain.length === 56 && /^[cC]/i.test(subdomain);
}

function previewSubdomain(sub: string): { raw: string; preview: string | null } {
  const m = sub.match(/^(.*)--(?:pr-)?(\d+)$/);
  return m ? { raw: m[1], preview: m[2] } : { raw: sub, preview: null };
}

/**
 * Extract contract ID from a subdomain hostname.
 * Handles both production and preview URLs:
 *   "cabc1234.mysoroban.xyz"             → "CABC1234"
 *   "cabc1234--10.mysoroban.xyz"         → "CABC1234"
 * Returns null if hostname has no subdomain or contract ID.
 */
export function contractIdFromHostname(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length <= 1) return null;

  const { raw } = previewSubdomain(parts[0]);
  return raw ? raw.toUpperCase() : null;
}

/**
 * Extract a human-readable name from a subdomain hostname.
 * Returns null if the subdomain is a contract ID, empty, or a preview prefix.
 *   "alice.mysoroban.xyz"               → "alice"
 *   "alice--10.mysoroban.xyz"           → "alice"
 *   "cabc1234...mysoroban.xyz"          → null (contract ID)
 *   "10.mysoroban.xyz"                 → null (preview root)
 */
export function nameFromHostname(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length <= 1) return null;

  const sub = parts[0];
  const { raw } = previewSubdomain(sub);

  if (!raw) return null;
  if (isContractId(raw)) return null;
  if (/^\d+$/.test(sub)) return null;
  if (/^pr-\d+$/.test(sub)) return null;
  if (RESERVED_DAPP_SUBDOMAINS[raw.toLowerCase()]) return null;

  return raw.toLowerCase();
}

/**
 * Build a protocol-relative URL with the contract ID as subdomain.
 * In preview environments (hostname contains `--<N>` or is the numeric
 * `<N>.<base>` root), the account gets a short numeric preview suffix:
 *   accountUrl("10.mysoroban.xyz", "CABC", "/account/")
 *     → "//cabc--10.mysoroban.xyz/account/"
 *
 * In production:
 *   accountUrl("mysoroban.xyz", "CABC", "/account/")
 *     → "//cabc.mysoroban.xyz/account/"
 *
 * Pass `window.location.host` (includes port) as the host parameter.
 */
export function accountUrl(host: string, contractId: string, path: string = "/"): string {
  const preview = previewPrefix(host);
  if (preview) {
    // Full C-address labels are 56 chars. Appending `--pr-100` exceeds DNS's
    // 63-character label limit, but `--100` keeps PR #100 at 61 chars.
    // This remains valid through PR #99999; re-evaluate at six digits.
    const apex = host.split(".").slice(1).join(".");
    return `//${contractId.toLowerCase()}${PREVIEW_SEP}${preview}.${apex}${path}`;
  }
  // The calling host could be the apex (mysoroban.xyz), a contract subdomain
  // (cabc.mysoroban.xyz), or a reserved-dApp subdomain (status-message.nido.fyi).
  // Strip to the apex before prepending, mirroring dappUrl: 3+ labels means
  // there's a subdomain to drop, 2 labels means we're already at the apex.
  // (This codebase doesn't deal with multi-segment TLDs like co.uk.)
  const parts = host.split(".");
  const apex = parts.length > 2 ? parts.slice(1).join(".") : host;
  return `//${contractId.toLowerCase()}.${apex}${path}`;
}

/**
 * Strip the contract ID from a host string, preserving any preview prefix.
 *   "cabc1234.mysoroban.xyz"            → "mysoroban.xyz"
 *   "cabc1234--10.mysoroban.xyz"        → "10.mysoroban.xyz"
 *   "10.mysoroban.xyz"                  → "10.mysoroban.xyz"   (already a root)
 *   "pr-10.mysoroban.xyz"               → "10.mysoroban.xyz"   (legacy → numeric)
 *   "cabc1234.localhost:3000"           → "localhost:3000"
 */
export function stripSubdomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 1) return host;

  const sub = parts[0];
  const rest = parts.slice(1).join(".");

  // A bare preview root ("10" or legacy "pr-10") IS already the stripped base —
  // keep it (normalized to the numeric form) rather than dropping the preview
  // number. Otherwise callers that rebuild an account URL from this base (e.g.
  // `accountUrl(stripSubdomain(host), …)`) lose the `--<N>` suffix and fall back
  // to the production apex.
  const bareRoot = sub.match(/^(?:pr-)?(\d+)$/);
  if (bareRoot) return `${bareRoot[1]}.${rest}`;

  const { preview } = previewSubdomain(sub);
  if (preview) {
    // Preserve the preview root: "contract--10" → "10"
    return `${preview}.${rest}`;
  }
  return rest;
}

/**
 * Extract the preview number from a hostname, or null if production.
 * Checks the first subdomain segment for the numeric `--<N>` separator,
 * and also matches bare numeric roots. Legacy `--pr-<N>`/`pr-<N>` links are
 * accepted as input but new URLs emit the numeric form.
 */
function previewPrefix(host: string): string | null {
  const parts = host.split(".");
  if (parts.length <= 1) return null;

  const sub = parts[0];

  const { preview } = previewSubdomain(sub);
  if (preview) return preview;

  // Bare numeric preview root: "10"
  if (/^\d+$/.test(sub)) return sub;

  // Legacy bare preview root: "pr-10"
  const prMatch = sub.match(/^pr-(\d+)$/);
  if (prMatch) {
    return prMatch[1];
  }

  return null;
}
