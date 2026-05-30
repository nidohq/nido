# UX & Product Reviewers (51-65)

## Reviewer 51 — UX Researcher
**Severity: HIGH** — The claim flow requires 3 page loads with 2 redirects (claim → sign → callback). User sees: "Registering..." → blank → "Signature Request" → passkey prompt → "Signed! Redirecting..." → blank → "Simulating..." → "Submitting...". This is disorienting. Add a step indicator or progress bar.

## Reviewer 52 — Mobile UX Designer
**Severity: HIGH** — On mobile, the signing redirect causes the page to fully reload twice. Each reload loses scroll position and context. The user sees flashing content with no explanation of what's happening. Consider an iframe-based or same-page signing flow for mobile.

## Reviewer 53 — Accessibility Specialist
**Severity: MEDIUM** — No ARIA labels on dynamic content. Screen readers won't announce name registration progress, error messages, or passkey status changes. The error-box has no `role="alert"`. Add ARIA live regions.

## Reviewer 54 — First-time User Tester
**Severity: MEDIUM** — After claiming a name, the success message says "registered! Redirecting..." but doesn't explain where. The redirect goes to the same account page. User may not notice anything changed. Show the shareable URL prominently and explain what happened.

## Reviewer 55 — Product Manager
**Severity: MEDIUM** — No way to check name availability before claiming. User types "alice", clicks claim, waits 10+ seconds for funding + simulation, then learns it's taken. Add a real-time availability check as the user types.

## Reviewer 56 — Error State Designer
**Severity: MEDIUM** — When the claim fails ("Simulation failed — name may already be taken"), the error message includes raw RPC error text. Users see: "Name claim failed: Simulation failed — name may already be taken. HostError: Error(Auth, ...)". Show a human-readable message and hide technical details behind a "Details" toggle.

## Reviewer 57 — Onboarding Flow Designer
**Severity: LOW** — The claim form appears at the bottom of the account page, below passkey info, below balance, below the "Try It Out" section. Most users won't scroll down to find it. Move it higher or add a prominent CTA.

## Reviewer 58 — Form Validation UX Expert
**Severity: LOW** — Name validation shows a single error message for all failures: "Name must be 1-15 characters, lowercase letters and digits only, starting with a letter." This doesn't tell the user what specifically is wrong. Show contextual errors: "Too long", "Must start with a letter", etc.

## Reviewer 59 — Loading State Designer
**Severity: LOW** — The "Funding transaction keypair..." step calls Friendbot which can take 5-10 seconds. No spinner, no cancel button, no timeout indicator. User thinks the app is frozen. Add animated progress.

## Reviewer 60 — Shareable URL Designer
**Severity: MEDIUM** — After name registration, the shareable URL is shown as raw text in a code block. No "Copy URL" button, no "Share" button, no QR code. Users on mobile can't easily share their new address.

## Reviewer 61 — Naming Convention Designer
**Severity: LOW** — The 15-character limit may be too restrictive. "cryptocurrency" is 14 chars. Common name patterns like "first-last" are blocked (no hyphens). Consider allowing hyphens (avoiding `--pr-` collision specifically) and extending to 32 chars.

## Reviewer 62 — Existing User Experience Reviewer
**Severity: LOW** — If a user already has a name, the "Account Name" section shows the name and URL but no options to change it, transfer it, or release it. It's display-only. Add management actions.

## Reviewer 63 — Multi-account UX Designer
**Severity: LOW** — On the home page, account list shows `name (CONTRACT_ID)` but only for accounts with locally-saved names. If the user cleared localStorage or uses a different device, names disappear. Should query the registry on-chain for reverse lookup.

## Reviewer 64 — Offline-first Designer
**Severity: LOW** — No offline handling. If the user visits their account page without internet, the page loads (static HTML) but all dynamic content fails silently. No "You're offline" indicator.

## Reviewer 65 — Cross-device Experience Reviewer
**Severity: MEDIUM** — Names are saved in localStorage per-browser. A user who claims "alice" on their laptop won't see it on their phone. The name exists on-chain but the UI doesn't check. Add on-chain reverse lookup (`registry.lookup(contractId)`) on page load.
