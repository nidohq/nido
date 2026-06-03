const PREVIEW_SEP = "--pr-";

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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.hostname.split(".");
    const sub = parts[0];

    const sepIndex = sub.indexOf(PREVIEW_SEP);
    const labelRaw = sepIndex !== -1 ? sub.slice(0, sepIndex) : sub;
    const dappPath = RESERVED_DAPP_SUBDOMAINS[labelRaw.toLowerCase()];

    if (dappPath && url.pathname === "/") {
      url.pathname = dappPath;
    }

    if (sepIndex !== -1) {
      const prBranch = "pr-" + sub.slice(sepIndex + PREVIEW_SEP.length);
      url.hostname = `${prBranch}.${PAGES}`;
    } else if (/^pr-\d+$/.test(sub)) {
      url.hostname = `${sub}.${PAGES}`;
    } else {
      url.hostname = PAGES;
    }

    return fetch(url.toString(), { headers: request.headers });
  },
};
