/**
 * Local development serves Nido at `nido.localhost:<port>` and each account at
 * `<c-address>.nido.localhost:<port>`, so that, as `nido.fyi` and
 * `<c>.nido.fyi` do in production, the apex and its accounts share the
 * registrable domain `nido.localhost`. Bare `localhost` has no registrable
 * domain: every `<c>.localhost` is a site of its own, browsers partition the
 * storage bridge's iframe away from the top-level apex, and the main site
 * never sees an account created on its address.
 *
 * The dev server sends a request for that old topology to the same path on
 * the new one: `localhost`, `127.0.0.1` and `[::1]` move to `nido.localhost`,
 * and an account's `<c-address>.localhost` to `<c-address>.nido.localhost`.
 * Every other `<label>.localhost` stays where it is: `dapp.localhost` is a
 * local dApp, and moving it under `nido.localhost` would make it the same site
 * as the wallet. Returns the host to redirect to, or null when `host` (a
 * `Host` header, port included) is not one of those.
 */
export function devRedirectHost(host: string): string | null {
  const portAt = host.startsWith("[") ? host.indexOf("]:") + 1 : host.lastIndexOf(":");
  const port = portAt > 0 ? host.slice(portAt) : "";
  const hostname = (portAt > 0 ? host.slice(0, portAt) : host).toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return `nido.localhost${port}`;
  }
  const account = /^(c[a-z2-7]{55})\.localhost$/.exec(hostname);
  return account ? `${account[1]}.nido.localhost${port}` : null;
}
