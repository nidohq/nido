/**
 * nido.fyi wildcard-subdomain proxy. Identical logic to the mysoroban-proxy
 * worker, but the upstream origin is the `nido` Pages project
 * (`nido-1am.pages.dev`) rather than the apex. Bound to `*.nido.fyi/*`.
 *
 * Keep `RESERVED_DAPP_SUBDOMAINS` in sync with `packages/passkey-sdk/src/url.ts`.
 */
const RESERVED_DAPP_SUBDOMAINS = {
  "status-message": "/status-message/",
};

// The Pages production origin for nido (Cloudflare appended "-1am" because the
// bare `nido` project subdomain was taken).
const PAGES = "nido-1am.pages.dev";

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
  async fetch(request) {
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
      url.hostname = `${prBranch}.${PAGES}`;
    } else {
      const pr = previewRoot(sub);
      if (pr) {
        url.hostname = `pr-${pr}.${PAGES}`;
      } else {
        url.hostname = PAGES;
      }
    }

    const upstream = await fetch(url.toString(), { headers: request.headers });

    // Attach security headers the Pages origin doesn't set. Cloudflare Response
    // headers are immutable until copied into a fresh Response.
    const response = new Response(upstream.body, upstream);
    // Block MIME-sniffing, framing (this is a signing surface -- no clickjacking),
    // and strip the path (account subdomain) from cross-origin referrers.
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    // CSP shipped in *Report-Only* first: an enforced strict policy must be
    // browser-verified against everything the app actually loads (Stellar
    // RPC/Horizon, Friendbot, fonts, the WebAuthn ceremony) or it will break
    // onboarding/signing. Report-Only never blocks -- it surfaces what a future
    // enforced policy would reject. Promote to `Content-Security-Policy` (drop
    // `-Report-Only`) once the console/report stream is clean.
    // TODO(audit E): tighten (esp. connect-src to explicit RPC hosts, remove
    // style 'unsafe-inline' if Astro allows) + enforce. See docs/MAINNET_READINESS.md.
    response.headers.set(
      "Content-Security-Policy-Report-Only",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' https:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join("; "),
    );
    return response;
  },
};
