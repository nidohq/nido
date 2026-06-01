/**
 * Thin, browser-only redirect glue. NOT unit-tested (it drives `window.open`
 * and `postMessage`); kept deliberately small so the testable logic lives in
 * `urls.ts` / `handover.ts`.
 *
 * The kit's `getAddress` / `signTransaction` / etc. are Promises that must
 * resolve with a value — a full-page redirect would tear down the calling
 * page and lose the Promise. So we open the wallet ceremony in a popup and
 * wait for it to `postMessage` the result back to us, then close it. The
 * wallet's `/connect/` and `/sign/` pages post `{ source: 'g2c-wallet', search }`
 * (the return query string) back to the opener and self-close.
 *
 * If popups are blocked, the caller can fall back to a full-page redirect via
 * `redirectTopLevel` and read the result on return with the `handover.ts`
 * parsers — but that requires the dApp to re-invoke after navigation, so the
 * popup path is the default.
 */
const MESSAGE_SOURCE = 'g2c-wallet';
/**
 * Open `url` in a popup and resolve with the return query string once the
 * wallet posts it back. Rejects if the popup is blocked, the user closes it
 * without completing, or `timeoutMs` elapses.
 *
 * `expectedOrigin` guards against a malicious page posting a forged result:
 * we only accept messages whose `event.origin` matches.
 */
export function openCeremonyPopup(url, expectedOrigin, timeoutMs = 5 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const popup = window.open(url, 'g2c-wallet', 'popup,width=460,height=720');
        if (!popup) {
            reject(new Error('g2c: popup was blocked. Allow popups for this site and retry.'));
            return;
        }
        let settled = false;
        const cleanup = () => {
            settled = true;
            window.removeEventListener('message', onMessage);
            clearInterval(closedTimer);
            clearTimeout(timer);
        };
        const onMessage = (event) => {
            if (event.origin !== expectedOrigin)
                return;
            const data = event.data;
            if (!data || data.source !== MESSAGE_SOURCE)
                return;
            cleanup();
            try {
                popup.close();
            }
            catch { /* ignore */ }
            resolve({ search: data.search ?? '' });
        };
        window.addEventListener('message', onMessage);
        // Detect a user closing the popup without finishing.
        const closedTimer = setInterval(() => {
            if (settled)
                return;
            if (popup.closed) {
                cleanup();
                reject(new Error('g2c: the wallet window was closed before completing.'));
            }
        }, 500);
        const timer = setTimeout(() => {
            if (settled)
                return;
            cleanup();
            try {
                popup.close();
            }
            catch { /* ignore */ }
            reject(new Error('g2c: timed out waiting for the wallet.'));
        }, timeoutMs);
    });
}
/** Full-page redirect fallback (loses the Promise; caller must re-read on return). */
export function redirectTopLevel(url) {
    window.location.href = url;
}
/**
 * Called by the wallet's `/connect/` and `/sign/` pages to hand a result back
 * to the dApp's popup opener. Posts `{ source: 'g2c-wallet', search }` to the
 * opener (targeting `dappOrigin`) and closes the window. If there's no opener
 * (the page was reached by full-page redirect, not a popup), falls back to a
 * top-level redirect to `returnUrl` with the result query string appended.
 *
 * `search` is the result query string, e.g. `?g2c_signed=…&kind=tx`.
 */
export function postResultToOpener(search, dappOrigin, returnUrl) {
    const opener = window.opener;
    if (opener && !opener.closed) {
        opener.postMessage({ source: MESSAGE_SOURCE, search }, dappOrigin);
        window.close();
        return;
    }
    // No opener: full-page-redirect fallback. Append the result params to the
    // return URL (which must be same-origin as dappOrigin — caller validates).
    if (returnUrl) {
        const u = new URL(returnUrl);
        const incoming = new URLSearchParams(search);
        for (const [k, v] of incoming)
            u.searchParams.set(k, v);
        window.location.href = u.toString();
    }
}
export { MESSAGE_SOURCE };
//# sourceMappingURL=redirect.js.map