/**
 * passkeySupport.ts — one place to decide whether a passkey ceremony can run.
 *
 * WebAuthn (`navigator.credentials` + `window.PublicKeyCredential`) is only
 * exposed in a SECURE CONTEXT — https, or a loopback host (localhost/127.0.0.1).
 * Over plain http on a non-loopback origin (e.g. `http://moss:4321` reached over
 * Tailscale) Safari strips `navigator.credentials` entirely, so an unguarded
 * `navigator.credentials.create(...)` throws the cryptic
 * "undefined is not an object (evaluating 'navigator.credentials.create')".
 *
 * Callers check support first and show `message` instead of that raw error.
 */

export type PasskeyUnsupportedReason = "insecure-context" | "unsupported";

export interface PasskeyEnv {
  isSecureContext: boolean;
  hasPublicKeyCredential: boolean;
  hasCredentials: boolean;
}

export interface PasskeySupport {
  ok: boolean;
  reason?: PasskeyUnsupportedReason;
  message?: string;
}

const INSECURE_CONTEXT_MESSAGE =
  "Passkeys need a secure connection. Open Nido at its https:// address (or on localhost) and try again.";
const UNSUPPORTED_MESSAGE =
  "This browser can't use passkeys here. Try opening Nido in Safari or Chrome.";

/** Snapshot the current browser's WebAuthn capability. `Window & typeof
 *  globalThis` is the real type of the `window` global — it includes global
 *  constructors like `PublicKeyCredential` that the bare `Window` lacks. */
export function readPasskeyEnv(win: Window & typeof globalThis = window): PasskeyEnv {
  return {
    isSecureContext: Boolean(win.isSecureContext),
    hasPublicKeyCredential: typeof win.PublicKeyCredential !== "undefined",
    hasCredentials: Boolean(win.navigator && win.navigator.credentials),
  };
}

/** Decide whether a passkey ceremony can run; if not, say why (so the UI can
 *  give an actionable message). Secure-context failures are distinguished from
 *  genuinely-unsupported browsers because the fix differs (use https vs switch
 *  browser). */
export function checkPasskeySupport(
  env: PasskeyEnv = readPasskeyEnv(),
): PasskeySupport {
  if (env.hasPublicKeyCredential && env.hasCredentials) {
    return { ok: true };
  }
  if (!env.isSecureContext) {
    return {
      ok: false,
      reason: "insecure-context",
      message: INSECURE_CONTEXT_MESSAGE,
    };
  }
  return { ok: false, reason: "unsupported", message: UNSUPPORTED_MESSAGE };
}

/** Whether this page runs in an app's embedded WebView (Twitter, Instagram,
 *  …), where passkeys can't run and the fix is opening the real browser. Real
 *  Safari and SFSafariViewController carry both "Safari" and "Version/";
 *  WKWebViews omit "Version/". So does Nido installed to the iOS home screen,
 *  which is Safari's own engine with passkeys intact: `standalone` (iOS's
 *  `navigator.standalone`) tells it apart. */
export function isInAppBrowser(ua: string, standalone: boolean): boolean {
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  return (isIOS && !standalone && (!/Safari/.test(ua) || !/Version\//.test(ua)))
    || /Twitter|Instagram|FBAN|FBAV|Line\//.test(ua);
}
