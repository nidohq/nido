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
 * and `<label>.localhost` to `<label>.nido.localhost`. Returns the host to
 * redirect to, or null when `host` (a `Host` header, port included) is already
 * on `nido.localhost` or is not a loopback name at all.
 */
export function devRedirectHost(host: string): string | null {
  const portAt = host.startsWith("[") ? host.indexOf("]:") + 1 : host.lastIndexOf(":");
  const port = portAt > 0 ? host.slice(portAt) : "";
  const hostname = (portAt > 0 ? host.slice(0, portAt) : host).toLowerCase();

  if (hostname === "nido.localhost" || hostname.endsWith(".nido.localhost")) return null;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return `nido.localhost${port}`;
  }
  if (hostname.endsWith(".localhost")) {
    return `${hostname.slice(0, -".localhost".length)}.nido.localhost${port}`;
  }
  return null;
}
