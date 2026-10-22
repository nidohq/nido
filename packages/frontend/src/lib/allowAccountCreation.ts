/**
 * Whether account creation should be live on this hostname, vs. a "Coming
 * soon" placeholder. Cosmetic only, not a network switch: every build still
 * talks to the same backend (today, testnet) regardless of domain — this
 * just decides what the landing page and the My Nido switcher show.
 *
 * Allowlisted rather than blocklisted, so an unexpected hostname (the raw
 * Cloudflare Pages origin, a typo'd subdomain) fails toward "coming soon"
 * rather than toward live.
 *
 * `EXACT_HOSTNAMES`/`HOSTNAME_SUFFIXES` are exported (not just the function)
 * so index.astro's parser-blocking inline script — which can't `import`,
 * since it must stay a classic, non-module script — can pass this same data
 * in via `define:vars` instead of hardcoding its own copy of the allowlist.
 */
export const EXACT_HOSTNAMES = ["test.nido.fyi", "localhost", "127.0.0.1"];
export const HOSTNAME_SUFFIXES = [".test.nido.fyi"];

export function allowAccountCreation(hostname: string): boolean {
  return EXACT_HOSTNAMES.includes(hostname) || HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}
