/**
 * Thin, browser-only redirect glue. NOT unit-tested (it drives `window.open`
 * and `postMessage`); kept deliberately small so the testable logic lives in
 * `urls.ts` / `handover.ts`.
 *
 * The kit's `getAddress` / `signTransaction` / etc. are Promises that must
 * resolve with a value — a full-page redirect would tear down the calling
 * page and lose the Promise. So we open the wallet ceremony in a popup and
 * wait for it to `postMessage` the result back to us, then close it. The
 * wallet's `/connect/` and `/sign/` pages post `{ source: 'nido-wallet', search }`
 * (the return query string) back to the opener and self-close.
 *
 * If popups are blocked, the caller can fall back to a full-page redirect via
 * `redirectTopLevel` and read the result on return with the `handover.ts`
 * parsers — but that requires the dApp to re-invoke after navigation, so the
 * popup path is the default.
 */

const MESSAGE_SOURCE = 'nido-wallet';

export interface PopupResult {
  /** The query string the wallet posted back (e.g. "?nido_signed=…"). */
  search: string;
}

/**
 * Open `url` in a popup and resolve with the return query string once the
 * wallet posts it back. Rejects if the popup is blocked, the user closes it
 * without completing, or `timeoutMs` elapses.
 *
 * `expectedOrigin` guards against a malicious page posting a forged result:
 * we only accept messages whose `event.origin` matches.
 */
export function openCeremonyPopup(
  url: string,
  expectedOrigin: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<PopupResult> {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'nido-wallet', 'popup,width=460,height=720');
    if (!popup) {
      reject(new Error('Nido: popup was blocked. Allow popups for this site and retry.'));
      return;
    }

    let settled = false;
    const cleanup = () => {
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      clearTimeout(timer);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      const data = event.data as { source?: string; search?: string } | null;
      if (!data || data.source !== MESSAGE_SOURCE) return;
      cleanup();
      try { popup.close(); } catch { /* ignore */ }
      resolve({ search: data.search ?? '' });
    };

    window.addEventListener('message', onMessage);

    // Detect a user closing the popup without finishing.
    const closedTimer = setInterval(() => {
      if (settled) return;
      if (popup.closed) {
        cleanup();
        reject(new Error('Nido: the wallet window was closed before completing.'));
      }
    }, 500);

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      try { popup.close(); } catch { /* ignore */ }
      reject(new Error('Nido: timed out waiting for the wallet.'));
    }, timeoutMs);
  });
}

/** Full-page redirect fallback (loses the Promise; caller must re-read on return). */
export function redirectTopLevel(url: string): void {
  window.location.href = url;
}

/** True iff `hostname` is a loopback dev host allowed over plain `http:`:
 *  `localhost`, any `*.localhost` subdomain, or `127.0.0.1`. Mirrors the
 *  frontend's `isLoopbackHttpHost` — the `.localhost` TLD resolves to the
 *  loopback interface in every browser (RFC 6761), so http there is as safe as
 *  bare `localhost`, and Nido's dev dApps live at `*.localhost:<port>`. */
function isLoopbackHttpHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
}

/** True iff `url` is a well-formed http(s) URL (http only for loopback dev).
 *  Mirrors the frontend's `httpOrigin` scheme rule so a navigation sink can
 *  reject `javascript:`/`data:`/`blob:`/opaque-origin callbacks on its own,
 *  independent of whatever entry-point validation ran (defence in depth). */
function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && isLoopbackHttpHost(u.hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve the full-page return target: `returnUrl` with the result query
 * string merged in. Returns `null` — refusing the navigation — unless
 * `returnUrl` is a well-formed http(s) URL. This is the SINK guard for the
 * open-redirect / wallet-origin-XSS vector: assigning a `javascript:` (or
 * `data:`) callback to `window.location.href` would execute script in the
 * wallet account's own origin. Pure (no `window` access) so it is unit-tested.
 */
export function resolveReturnRedirect(returnUrl: string, search: string): string | null {
  if (!isHttpUrl(returnUrl)) return null;
  const u = new URL(returnUrl);
  const incoming = new URLSearchParams(search);
  for (const [k, v] of incoming) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Called by the wallet's `/connect/` and `/sign/` pages to hand a result back
 * to the dApp's popup opener. Posts `{ source: 'nido-wallet', search }` to the
 * opener (targeting `dappOrigin`) and closes the window. If there's no opener
 * (the page was reached by full-page redirect, not a popup), falls back to a
 * top-level redirect to `returnUrl` with the result query string appended.
 *
 * `search` is the result query string, e.g. `?nido_signed=…&kind=tx`.
 */
export function postResultToOpener(
  search: string,
  dappOrigin: string,
  returnUrl?: string,
): void {
  const opener = window.opener as Window | null;
  if (opener && !opener.closed) {
    opener.postMessage({ source: MESSAGE_SOURCE, search }, dappOrigin);
    window.close();
    return;
  }
  // No opener: full-page-redirect fallback. Append the result params to the
  // return URL. The scheme is re-validated at this sink (resolveReturnRedirect)
  // so a `javascript:`/`data:` callback can never reach `location.href`, even
  // if an entry point failed to reject it.
  if (returnUrl) {
    const target = resolveReturnRedirect(returnUrl, search);
    if (target) window.location.href = target;
  }
}

export { MESSAGE_SOURCE };
