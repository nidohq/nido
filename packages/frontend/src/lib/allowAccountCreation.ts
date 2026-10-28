/**
 * Whether account creation should be live on this hostname, vs. a "Coming
 * soon" placeholder. Cosmetic only, not a network switch: each build talks to
 * the network it was built for (PUBLIC_STELLAR_NETWORK, see network.ts)
 * regardless of domain — this just decides what the landing page and the My
 * Nido switcher show.
 *
 * Open on both Nido apexes — nido.fyi (mainnet) and test.nido.fyi (testnet) —
 * and on every account subdomain under them (alice.nido.fyi,
 * cabc.test.nido.fyi), which the `.nido.fyi` suffix covers.
 *
 * Allowlisted rather than blocklisted, so an unexpected hostname (the raw
 * Cloudflare Pages origin, a look-alike domain) fails toward "coming soon"
 * rather than toward live.
 *
 * `EXACT_HOSTNAMES`/`HOSTNAME_SUFFIXES` are exported (not just the function)
 * so index.astro's parser-blocking inline script — which can't `import`,
 * since it must stay a classic, non-module script — can pass this same data
 * in via `define:vars` instead of hardcoding its own copy of the allowlist.
 */
export const EXACT_HOSTNAMES = ["nido.fyi", "localhost", "127.0.0.1"];
export const HOSTNAME_SUFFIXES = [".nido.fyi"];

export function allowAccountCreation(hostname: string): boolean {
  return EXACT_HOSTNAMES.includes(hostname) || HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}
