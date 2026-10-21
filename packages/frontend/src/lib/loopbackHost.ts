/** True iff `hostname` is a loopback dev host that may be served over plain
 *  `http:` (everything else must be `https:`).
 *
 *  Loopback means `localhost`, any `*.localhost` subdomain, or `127.0.0.1`.
 *  The `.localhost` TLD is reserved by RFC 6761 and browsers resolve every
 *  `*.localhost` name to the loopback interface and treat it as a secure
 *  context, so a remote attacker cannot point one at their server on a
 *  victim's machine — http there is exactly as safe as bare `localhost`.
 *  Nido's whole dev topology is `.localhost` subdomains (the wallet at
 *  `<contractid>.localhost:<port>`, a dApp at `dapp.localhost:<port>`), so the
 *  bare-`localhost` check alone wrongly refused legitimate local dApp origins.
 *  Callers still require an `http:`/`https:` protocol, so `javascript:`/`data:`/
 *  `blob:`/opaque schemes and real remote-http origins stay rejected. */
export function isLoopbackHttpHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1";
}
