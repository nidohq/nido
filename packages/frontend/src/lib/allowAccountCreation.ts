/**
 * Whether account creation should be live on this hostname, vs. a "Coming
 * soon" placeholder. Cosmetic only, not a network switch: every build still
 * talks to the same backend (today, testnet) regardless of domain — this
 * just decides what the landing page and the My Nido switcher show.
 *
 * Allowlisted rather than blocklisted, so an unexpected hostname (the raw
 * Cloudflare Pages origin, a typo'd subdomain) fails toward "coming soon"
 * rather than toward live.
 */
export function allowAccountCreation(hostname: string): boolean {
  return (
    hostname === "test.nido.fyi" ||
    hostname.endsWith(".test.nido.fyi") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}
