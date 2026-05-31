const PREVIEW_SEP = "--pr-";

/**
 * Reserved subdomains that serve a specific dApp path. When the request
 * hits the root (`/`), we rewrite the upstream path to the dApp's entry
 * before proxying. Keep in sync with `RESERVED_DAPP_SUBDOMAINS` in
 * `packages/passkey-sdk/src/url.ts` — that map drives the equivalent
 * client-side redirect (which still runs as a fallback for direct
 * .pages.dev URLs or local dev where this worker isn't in the path).
 */
const RESERVED_DAPP_SUBDOMAINS = {
  "status-message": "/status-message/",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.hostname.split(".");
    const sub = parts[0];

    // The reserved-dApp prefix is just the leading label before any
    // preview suffix. `status-message` and `status-message--pr-24` both
    // count as the same dApp; the preview part is handled below.
    const sepIndex = sub.indexOf(PREVIEW_SEP);
    const labelRaw = sepIndex !== -1 ? sub.slice(0, sepIndex) : sub;
    const dappPath = RESERVED_DAPP_SUBDOMAINS[labelRaw.toLowerCase()];

    // Rewrite root requests on a reserved-dApp subdomain to the dApp's
    // path. Other paths pass through verbatim so static assets, fetches,
    // and explicit deep links still resolve. `/` covers the case where
    // the user lands on the bare subdomain.
    if (dappPath && url.pathname === "/") {
      url.pathname = dappPath;
    }

    // Check for preview encoding: "<sub>--pr-<N>.mysoroban.xyz"
    // or bare preview root: "pr-<N>.mysoroban.xyz".
    if (sepIndex !== -1) {
      const prBranch = "pr-" + sub.slice(sepIndex + PREVIEW_SEP.length);
      url.hostname = `${prBranch}.mysoroban.pages.dev`;
    } else if (/^pr-\d+$/.test(sub)) {
      url.hostname = `${sub}.mysoroban.pages.dev`;
    } else {
      url.hostname = "mysoroban.xyz";
    }

    return fetch(url.toString(), { headers: request.headers });
  },
};
