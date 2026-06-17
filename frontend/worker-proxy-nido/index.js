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

    return fetch(url.toString(), { headers: request.headers });
  },
};
