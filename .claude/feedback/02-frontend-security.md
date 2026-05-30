# Frontend Security Reviewers (16-30)

## Reviewer 16 — Web Application Penetration Tester
**Severity: CRITICAL** — `formatSignResult()` builds HTML via string concatenation and assigns to `.innerHTML` (account page line 685). If any field contains injected HTML (e.g., `<img onerror=...>`), XSS is possible. Use `textContent` or DOM APIs instead.

## Reviewer 17 — Browser Security Researcher
**Severity: HIGH** — Keypair secret stored in `localStorage["g2c:name-keypair"]` (line 812) in plaintext. Any XSS on the same origin reads it. Any browser extension has full access. Use `sessionStorage` (cleared on tab close) or Web Crypto API for encryption.

## Reviewer 18 — OAuth/Auth Flow Specialist
**Severity: HIGH** — The signing redirect flow passes signature components (authenticatorData, clientDataJSON, signature, publicKey) as **URL query parameters** (line 571-578). These are logged in browser history, server access logs, CDN logs, and Referer headers. Move to POST body or `window.postMessage`.

## Reviewer 19 — Open Redirect Specialist
**Severity: MEDIUM** — `callbackUrl` from query params is used directly as redirect target (line 571: `const cbUrl = new URL(callbackUrl!)`). No origin validation. An attacker crafts `/account/?sign=X&callback=https://evil.com` → user signs → signature sent to attacker. Add `cbUrl.origin === window.location.origin` check.

## Reviewer 20 — CSRF Researcher
**Severity: MEDIUM** — The signing flow has no CSRF token or state parameter. An attacker could craft a link that auto-starts the signing flow with a malicious transaction hash. The passkey prompt is the last line of defense, but users may approve without verifying the hash.

## Reviewer 21 — localStorage Security Specialist
**Severity: MEDIUM** — Transaction XDR stored in `localStorage["g2c:name-txXdr"]` (line 885) persists across sessions. If user abandons the flow, stale transaction data remains. On next visit with `?nameresult=1` in URL, it could process an old transaction. Add expiry timestamps to stored data.

## Reviewer 22 — Subdomain Security Researcher
**Severity: MEDIUM** — `contractIdFromHostname()` returns uppercased first subdomain without validation. `contractIdFromHostname("evil-script.mysoroban.xyz")` returns `"EVIL-SCRIPT"`. This invalid string is used as rpId for passkey registration (line 413), in localStorage keys, and passed to Stellar APIs. Add format validation.

## Reviewer 23 — Cache Poisoning Specialist
**Severity: MEDIUM** — `sessionStorage["g2c:name:<name>"]` caches resolved contract IDs for 5 minutes. If a name's mapping changes on-chain within the TTL, stale cache redirects to the wrong account. No cache invalidation mechanism exists.

## Reviewer 24 — Mobile Browser Security Tester
**Severity: LOW** — The `Buffer` polyfill is loaded via `await import("buffer")` inside click handlers (lines 833-836). On slow mobile connections, this dynamic import could take seconds, causing the UI to appear frozen with no progress indicator before "Loading..." appears.

## Reviewer 25 — Content Security Policy Auditor
**Severity: LOW** — No CSP headers configured. The Cloudflare Worker doesn't set `Content-Security-Policy`. This allows inline scripts, external resource loading, and potential XSS amplification. Add strict CSP headers.

## Reviewer 26 — Secret Key in URL Reviewer
**Severity: CRITICAL (for mainnet)** — The G_temp secret key is passed via URL query parameter (`/new-account/?key=SBXXXX...`). This is logged in browser history, CDN logs, Referer headers. Use sessionStorage or fragment identifier (`#key=...`). **Blocks mainnet launch.**

## Reviewer 27 — Frontend Error Handling Reviewer
**Severity: MEDIUM** — The nameresult handler (line 904+) wraps everything in an async IIFE. If `getVerifierAddress()` fails (e.g., `import("buffer")` blocked by CSP), the error is caught and shown, but `$nameResult` may display stale progress text. Reset UI state in the catch block.

## Reviewer 28 — Race Condition Specialist
**Severity: LOW** — Name resolution on page load is non-blocking (`.then()`). If user interacts with the page before resolution completes, they see stale UI. If resolution succeeds during interaction, `window.location.replace()` interrupts whatever they're doing. Add a loading state while resolving.

## Reviewer 29 — DOM Manipulation Reviewer
**Severity: LOW** — Heavy use of `document.getElementById("...")!` with non-null assertion. If any element is missing (template change, ad blocker removing elements), the script crashes silently. Use optional chaining: `document.getElementById("...")?.textContent`.

## Reviewer 30 — Privacy Researcher
**Severity: LOW** — `loadAccountName()` and `loadAccounts()` store contract IDs and names in localStorage indefinitely. A forensic analysis of the browser reveals all accounts the user has ever interacted with. Add a "clear data" option.
