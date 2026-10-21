const PREVIEW_SEP = "--";

/**
 * The apexes Nido is served under, longest first: a host is read against the
 * longest apex it ends with, so `alice.test.nido.fyi` is the name `alice` on
 * the testnet apex `test.nido.fyi`, and `test.nido.fyi` itself is an apex
 * rather than an account named `test` on `nido.fyi`. `localhost` is always an
 * apex too. A host under none of them falls back to "the last two labels are
 * the apex" (`cabc.mysoroban.xyz` → `mysoroban.xyz`); this codebase doesn't
 * deal with multi-segment TLDs like co.uk.
 */
export const NIDO_APEXES: readonly string[] = ["test.nido.fyi", "nido.fyi"];

/**
 * A Nido host taken apart.
 *
 *   apex     the site apex, with any port: "nido.fyi", "test.nido.fyi", "localhost:4321"
 *   preview  the PR preview number, or null in production
 *   label    the one label below the apex (contract id, name, or reserved dApp),
 *            lowercased and without its `--<N>` preview suffix; null on the
 *            apex itself and on a bare preview root (`<N>.<apex>`)
 */
export interface HostParts {
  apex: string;
  preview: string | null;
  label: string | null;
}

const PREVIEW_ROOT_RE = /^(?:pr-)?(\d+)$/;
const PREVIEW_LABEL_RE = /^(.*)--(?:pr-)?(\d+)$/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function apexOfHostname(hostname: string, apexes: readonly string[]): string {
  if (hostname.startsWith("[") || IPV4_RE.test(hostname)) return hostname;
  const known = [...apexes, "localhost"].sort((a, b) => b.length - a.length);
  for (const apex of known) {
    if (hostname === apex) return apex;
    // Exactly one label below a known apex. Anything deeper is not a Nido
    // host shape and takes the generic rule below.
    if (hostname.endsWith(`.${apex}`) && !hostname.slice(0, -apex.length - 1).includes(".")) {
      return apex;
    }
  }
  const labels = hostname.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : hostname;
}

/**
 * Split a host (`window.location.host`, port included, or a bare hostname)
 * into its apex, preview number and account label. Every helper in this file
 * reads hosts through here, so the apex is never guessed by counting labels.
 *
 *   splitHost("nido.fyi")                 → { apex: "nido.fyi",      preview: null,  label: null }
 *   splitHost("test.nido.fyi")            → { apex: "test.nido.fyi", preview: null,  label: null }
 *   splitHost("alice.test.nido.fyi")      → { apex: "test.nido.fyi", preview: null,  label: "alice" }
 *   splitHost("126.test.nido.fyi")        → { apex: "test.nido.fyi", preview: "126", label: null }
 *   splitHost("cabc--126.nido.fyi")       → { apex: "nido.fyi",      preview: "126", label: "cabc" }
 *   splitHost("cabc.localhost:4321")      → { apex: "localhost:4321", preview: null, label: "cabc" }
 */
export function splitHost(host: string, apexes: readonly string[] = NIDO_APEXES): HostParts {
  const portAt = host.startsWith("[") ? host.indexOf("]:") + 1 : host.lastIndexOf(":");
  const port = portAt > 0 ? host.slice(portAt) : "";
  const hostname = (portAt > 0 ? host.slice(0, portAt) : host).toLowerCase();
  const apexName = apexOfHostname(hostname, apexes);
  const apex = apexName + port;
  if (apexName === hostname) return { apex, preview: null, label: null };

  const sub = hostname.slice(0, -apexName.length - 1);
  const root = sub.match(PREVIEW_ROOT_RE);
  if (root) return { apex, preview: root[1], label: null };
  const preview = sub.match(PREVIEW_LABEL_RE);
  if (preview) return { apex, preview: preview[2], label: preview[1] || null };
  return { apex, preview: null, label: sub };
}

/**
 * Reserved subdomains that map to a built-in dApp path on this site.
 * `status-message.<base>` is served the same static bundle as the wallet,
 * but the root page redirects to the listed path. Keep keys lowercase.
 */
export const RESERVED_DAPP_SUBDOMAINS: Record<string, string> = {
  'status-message': '/status-message/',
};

/**
 * Labels no Nido name may take, on either network: each is, or would collide
 * with, a host of its own one label below an apex. `test` is the testnet apex
 * (`test.nido.fyi` under `nido.fyi`), `www` and `nido` are aliases people type
 * for an apex, `relay` is the recovery relay, and the built-in dApps have their
 * subdomains. Keep in sync with infra/nido-resolver/src/handler.ts.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'test',
  'www',
  'nido',
  'relay',
  ...Object.keys(RESERVED_DAPP_SUBDOMAINS),
]);

/**
 * Whether `label` is reserved: one of {@link RESERVED_NAMES}, or a numeric or
 * `pr-<N>` preview root (`<N>.<apex>`). The name syntax already refuses the
 * preview roots; they are listed so every host-shaped check agrees.
 */
export function isReservedName(label: string): boolean {
  const l = label.toLowerCase();
  return RESERVED_NAMES.has(l) || PREVIEW_ROOT_RE.test(l);
}

/**
 * If `host` is a reserved dApp subdomain, return the path the root should
 * redirect to. Ignores any numeric preview suffix, so
 * `status-message--24.<base>` resolves the same as production.
 */
export function dappPathFromHostname(host: string): string | null {
  const { label } = splitHost(host);
  return label ? (RESERVED_DAPP_SUBDOMAINS[label] ?? null) : null;
}

/** `<label>.<apex>`, or `<label>--<N>.<apex>` when `host` is in PR preview N. */
function siblingHost(host: string, label: string): string {
  const { apex, preview } = splitHost(host);
  return preview ? `${label}${PREVIEW_SEP}${preview}.${apex}` : `${label}.${apex}`;
}

/**
 * Build a protocol-relative URL to a reserved-dApp subdomain, preserving the
 * preview prefix if the calling page is in a PR preview. Mirrors `accountUrl`
 * but for dApp names rather than contract IDs.
 *
 *   dappUrl("cabc--24.mysoroban.xyz", "status-message", "/?contract=C…")
 *     → "//status-message--24.mysoroban.xyz/?contract=C…"
 *
 *   dappUrl("cabc.test.nido.fyi", "status-message", "/?contract=C…")
 *     → "//status-message.test.nido.fyi/?contract=C…"
 *
 * The calling host may be the apex, a contract or name subdomain, a preview
 * root, or another reserved dApp. Pass `window.location.host` (with port).
 */
export function dappUrl(host: string, dappName: string, path: string = "/"): string {
  return `//${siblingHost(host, dappName)}${path}`;
}

/**
 * Check if a subdomain string looks like a Stellar contract ID.
 * Contract IDs are exactly 56 characters starting with C.
 */
export function isContractId(subdomain: string): boolean {
  return subdomain.length === 56 && /^[cC]/i.test(subdomain);
}

/**
 * Extract contract ID from a subdomain hostname.
 * Handles both production and preview URLs:
 *   "cabc1234.mysoroban.xyz"             → "CABC1234"
 *   "cabc1234--10.mysoroban.xyz"         → "CABC1234"
 * Returns null on an apex or a bare preview root. Does no strkey validation
 * (a name host returns the name upper-cased); pipe through `isContractId`.
 */
export function contractIdFromHostname(hostname: string): string | null {
  const { label } = splitHost(hostname);
  return label ? label.toUpperCase() : null;
}

/**
 * Extract a human-readable name from a subdomain hostname.
 * Returns null if the subdomain is a contract ID, a reserved name (built-in
 * dApps included), or there is no account label (an apex or a preview root).
 *   "alice.mysoroban.xyz"               → "alice"
 *   "alice--10.mysoroban.xyz"           → "alice"
 *   "cabc1234...mysoroban.xyz"          → null (contract ID)
 *   "10.mysoroban.xyz"                  → null (preview root)
 *   "test.nido.fyi"                     → null (apex)
 */
export function nameFromHostname(hostname: string): string | null {
  const { label } = splitHost(hostname);
  if (!label) return null;
  if (isContractId(label)) return null;
  if (isReservedName(label)) return null;
  return label;
}

/**
 * Build a protocol-relative URL with the contract ID as subdomain.
 * In preview environments (hostname contains `--<N>` or is the numeric
 * `<N>.<base>` root), the account gets a short numeric preview suffix:
 *   accountUrl("10.mysoroban.xyz", "CABC", "/account/")
 *     → "//cabc--10.mysoroban.xyz/account/"
 *
 * In production:
 *   accountUrl("test.nido.fyi", "CABC", "/account/")
 *     → "//cabc.test.nido.fyi/account/"
 *
 * The calling host may be the apex, a contract or name subdomain, or a
 * reserved-dApp subdomain (status-message.nido.fyi); the account is always
 * built one label below the apex. Full C-address labels are 56 chars:
 * appending `--pr-100` would exceed DNS's 63-character label limit, but
 * `--100` keeps PR #100 at 61 chars, valid through PR #99999.
 *
 * Pass `window.location.host` (includes port) as the host parameter.
 */
export function accountUrl(host: string, contractId: string, path: string = "/"): string {
  return `//${siblingHost(host, contractId.toLowerCase())}${path}`;
}

/**
 * Reduce a host to its account root: the apex in production, the `<N>.<apex>`
 * preview root in a preview.
 *   "cabc1234.mysoroban.xyz"            → "mysoroban.xyz"
 *   "cabc1234--10.mysoroban.xyz"        → "10.mysoroban.xyz"
 *   "10.mysoroban.xyz"                  → "10.mysoroban.xyz"   (already a root)
 *   "pr-10.mysoroban.xyz"               → "10.mysoroban.xyz"   (legacy → numeric)
 *   "alice.test.nido.fyi"               → "test.nido.fyi"
 *   "nido.fyi"                          → "nido.fyi"           (already an apex)
 *   "cabc1234.localhost:3000"           → "localhost:3000"
 *
 * A bare preview root keeps its preview number: callers rebuild account URLs
 * from this base (`accountUrl(stripSubdomain(host), …)`), and dropping it would
 * send a preview account onto the production host.
 */
export function stripSubdomain(host: string): string {
  const { apex, preview } = splitHost(host);
  return preview ? `${preview}.${apex}` : apex;
}
