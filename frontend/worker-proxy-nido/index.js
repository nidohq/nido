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
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestPath = url.pathname + url.search;
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

    // Advertise the onion mirror per-subdomain (Tor Browser shows a manual
    // ".onion available" button; auto-redirect was removed upstream for
    // fingerprinting reasons). No-op until the ONION_ADDR var is set — the
    // production onion address doesn't exist until the key ceremony
    // (infra/onion/README.md). Previews have no onion counterpart.
    const onionAddr = env?.ONION_ADDR;
    if (!onionAddr || preview.pr || previewRoot(sub)) return upstream;

    const response = new Response(upstream.body, upstream);
    const scheme = env.ONION_SCHEME || "http";
    response.headers.set(
      "Onion-Location",
      `${scheme}://${sub}.${onionAddr}${requestPath}`
    );
    return response;
  },
};
