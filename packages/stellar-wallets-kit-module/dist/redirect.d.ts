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
declare const MESSAGE_SOURCE = "g2c-wallet";
export interface PopupResult {
    /** The query string the wallet posted back (e.g. "?g2c_signed=…"). */
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
export declare function openCeremonyPopup(url: string, expectedOrigin: string, timeoutMs?: number): Promise<PopupResult>;
/** Full-page redirect fallback (loses the Promise; caller must re-read on return). */
export declare function redirectTopLevel(url: string): void;
/**
 * Called by the wallet's `/connect/` and `/sign/` pages to hand a result back
 * to the dApp's popup opener. Posts `{ source: 'g2c-wallet', search }` to the
 * opener (targeting `dappOrigin`) and closes the window. If there's no opener
 * (the page was reached by full-page redirect, not a popup), falls back to a
 * top-level redirect to `returnUrl` with the result query string appended.
 *
 * `search` is the result query string, e.g. `?g2c_signed=…&kind=tx`.
 */
export declare function postResultToOpener(search: string, dappOrigin: string, returnUrl?: string): void;
export { MESSAGE_SOURCE };
//# sourceMappingURL=redirect.d.ts.map