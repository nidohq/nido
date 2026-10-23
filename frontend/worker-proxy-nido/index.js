/**
 * nido.fyi wildcard-subdomain proxy. Identical logic to the mysoroban-proxy
 * worker, but the upstream origin is a Pages project rather than the apex.
 * Bound to `*.nido.fyi/*`.
 *
 * What differs per deployment comes from wrangler.toml `[vars]` (one set per
 * wrangler environment):
 *   PAGES              this environment's Pages origin for a NON-preview
 *                      request, e.g. `nido-1am.pages.dev` (production) or
 *                      `test.nido-1am.pages.dev` (testnet's own `test`
 *                      branch alias).
 *   PAGES_PROJECT_ROOT the bare Pages PROJECT root, e.g. `nido-1am.pages.dev`
 *                      — same value in every environment. PR preview
 *                      deployments are always `pr-<N>.<project-root>.pages.dev`
 *                      regardless of which hostname/environment a preview
 *                      link uses, so preview rewriting must anchor to this,
 *                      not to PAGES: testnet's PAGES is itself already a
 *                      branch alias, and `pr-<N>.test.nido-1am.pages.dev`
 *                      isn't a real deployment (confirmed by hand: that
 *                      hostname 404s "Deployment Not Found", while
 *                      `pr-<N>.nido-1am.pages.dev` serves the real preview).
 *   CSP_SITE_HOSTS     the wallet's own hosts, e.g. `https://*.nido.fyi`
 *                      (CSP wildcards match every depth, so this covers
 *                      `*.test.nido.fyi` too)
 *   CSP_NETWORK_HOSTS  the relayer and Stellar RPC/Horizon/friendbot hosts of
 *                      the network the build targets
 *
 * Keep `RESERVED_DAPP_SUBDOMAINS` in sync with `packages/passkey-sdk/src/url.ts`.
 */
const RESERVED_DAPP_SUBDOMAINS = {
  "status-message": "/status-message/",
};

function previewSubdomain(sub) {
  const match = sub.match(/^(.*)--(?:pr-)?(\d+)$/);
  return match ? { raw: match[1], pr: match[2] } : { raw: sub, pr: null };
}

function previewRoot(sub) {
  const numeric = sub.match(/^(\d+)$/);
  if (numeric) return numeric[1];
  const legacy = sub.match(/^pr-(\d+)$/);
  return legacy ? legacy[1] : null;
}

export default {
  async fetch(request, env) {
    const { PAGES, PAGES_PROJECT_ROOT, CSP_SITE_HOSTS, CSP_NETWORK_HOSTS } = env;
    const url = new URL(request.url);
    const parts = url.hostname.split(".");
    const sub = parts[0];

    const preview = previewSubdomain(sub);
    const dappPath = RESERVED_DAPP_SUBDOMAINS[preview.raw.toLowerCase()];

    if (dappPath && url.pathname === "/") {
      url.pathname = dappPath;
    }

    if (preview.pr) {
      const prBranch = "pr-" + preview.pr;
      url.hostname = `${prBranch}.${PAGES_PROJECT_ROOT}`;
    } else {
      const pr = previewRoot(sub);
      if (pr) {
        url.hostname = `pr-${pr}.${PAGES_PROJECT_ROOT}`;
      } else {
        url.hostname = PAGES;
      }
    }

    const upstream = await fetch(url.toString(), { headers: request.headers });

    // Attach security headers the Pages origin doesn't set. Cloudflare Response
    // headers are immutable until copied into a fresh Response.
    const response = new Response(upstream.body, upstream);
    // Block MIME-sniffing. HSTS covers every subdomain: the storage bridge and
    // the setup cookie trust *.nido.fyi, so none of it may be served over http.
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // The account C-address / name is the HOST subdomain (e.g. `Cabc...def.nido.fyi`),
    // NOT the URL path -- so `strict-origin-when-cross-origin` would still leak the
    // active account to every cross-origin request (fonts, price/RPC APIs) via the
    // Origin it keeps in Referer. `no-referrer` sends no Referer at all; nothing in
    // the app relies on it (cross-origin calls are unauthenticated and addressed by URL).
    response.headers.set("Referrer-Policy", "no-referrer");

    // The storage bridge is the one page meant to be framed: account and name
    // origins embed it to share the account list. It gets an enforced policy
    // of its own admitting only the wallet's own hosts over https; its message
    // handler narrows that to account and name labels. Every other page is a
    // signing surface and stays unframeable. Keep identical to the
    // /nido-storage-bridge/ rule in packages/frontend/public/_headers.
    if (url.pathname === "/nido-storage-bridge/") {
      response.headers.delete("X-Frame-Options");
      response.headers.delete("Content-Security-Policy-Report-Only");
      response.headers.set(
        "Content-Security-Policy",
        `default-src 'none'; script-src 'self'; frame-ancestors ${CSP_SITE_HOSTS}; base-uri 'none'; form-action 'none'`,
      );
      return response;
    }
    // Block framing (this is a signing surface -- no clickjacking).
    response.headers.set("X-Frame-Options", "DENY");

    // CSP still shipped in *Report-Only* (never blocks) so the enforced flip can
    // be browser-verified first -- but the policy is now TIGHT, not `connect-src
    // https:`. The allowlist below is every host the app actually reaches:
    //   - CSP_SITE_HOSTS      — sibling account/app subdomains (name resolution, cross-app)
    //   - CSP_NETWORK_HOSTS   — OZ relayer (Channels), Stellar RPC / Horizon / testnet funding
    //   - api.refractor.space, api.soroswap.finance — tx-coordination + token/price API
    //   - fonts.googleapis.com (stylesheet) + fonts.gstatic.com (font files) — NidoLayout.astro
    // Keep it identical to packages/frontend/public/_headers (the static-origin
    // copy). style-src still carries 'unsafe-inline' (Astro/Tailwind inline styles);
    // dropping it needs its own verification pass.
    // TODO(mainnet cutover): CSP_NETWORK_HOSTS is TESTNET today
    // (soroban-testnet/horizon-testnet/friendbot). At mainnet, set it to
    // soroban.stellar.org + horizon.stellar.org without friendbot, in lockstep
    // with the frontend network config AND packages/frontend/public/_headers.
    // TODO(CSP enforce): after a clean report stream in prod, promote to
    // `Content-Security-Policy` (drop `-Report-Only`). See docs/MAINNET_READINESS.md.
    response.headers.set(
      "Content-Security-Policy-Report-Only",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data:",
        "font-src 'self' data: https://fonts.gstatic.com",
        `connect-src 'self' ${CSP_SITE_HOSTS} ${CSP_NETWORK_HOSTS} https://api.refractor.space https://api.soroswap.finance`,
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
    );
    return response;
  },
};
