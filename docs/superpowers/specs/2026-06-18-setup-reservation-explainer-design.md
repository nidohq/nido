# Design: "Setting up your Nido" reservation explainer

## Context

Account setup spans two pages on two different hosts:

1. **Page 1 — apex/preview host** (`/new-account/?setup=1`): reserves the
   account's C-address (a Soroban RPC simulation of the factory's
   `get_c_address`), then `window.location.replace(...)` to the account's own
   subdomain.
2. **Page 2 — account subdomain** (`/new-account/` on `<cAddress>.nido.fyi`):
   the "Lock it to you" step where the user clicks **Create with a passkey**,
   which registers the WebAuthn credential and deploys the account.

The hop from page 1 to page 2 is a **cross-subdomain hard navigation** (different
origin — no shared `localStorage`, no cross-document View Transition). Today page
1 just spins the small passkey-step Nest, so on arrival page 2 snaps to the
static ready step — reading as a jarring "blink."

A prior attempt hid the seam with a "continuity splash" (a brief mirrored
spinning state on page 2, commit `e17a41e`). The decision is to **not hide the
seam** but to make it an explicit, explained step instead, so it reads as
intentional rather than glitchy.

### Why the passkey click stays on page 2 (constraint that shaped this design)

The natural follow-on idea — let the user press "Create with a passkey" on page
1 so they don't click again on page 2 — is **not compatible with the security
model** and is explicitly out of scope:

- The app binds each passkey to its account via `rpId = the account's
  subdomain` (documented in `sign/index.astro`, `primaryPasskeySigner.ts`,
  `walletSign.ts`, `delegationHandover.ts` — every `credentials.get()` uses
  `rpId: window.location.hostname`).
- WebAuthn requires `rpId` to be the current origin or a **parent**. Page 1 is
  the apex; the account subdomain is a **child**, so a passkey created on page 1
  could only use `rpId = apex`. That would make all accounts share one rpId,
  dissolving per-account passkey isolation at the browser layer (any account's
  sign page would surface every Nido passkey) and would force an rpId change at
  every `get()` call site.

Therefore the passkey-creating gesture **must** happen on the account subdomain.
The explainer only reframes the reservation+redirect; it adds no clicks (page 1
is passive; the lone click already lives on page 2).

## Goal

Replace the blink with a calm, explicit **reservation explainer** on page 1 that
tells the user what's happening, stays long enough to be read, then redirects to
the subdomain where they land directly on the ready step.

## Design

### 1. New `preparing-section` (page 1 only)

A dedicated section in `packages/frontend/src/pages/new-account/index.astro`,
sibling to `deploy-section` / `done-section`, hidden by default via the existing
`.hidden` toggle and shown by JS while reserving. It **replaces** today's
"add `setup-reserving` to the passkey step" behavior on page 1.

Layout (mirrors the deploy step's calm, centered aesthetic):

```
        ◌   ← spinning Nest, <Nest spin/> (the per-ring animation)

      Setting up your Nido            ← .disp heading, 28px

   We're reserving your private address
   and moving you into your own secure
   space. This only takes a moment.    ← .mut body, max-width ~330px

      · Reserving your address…        ← status line; .dot.acc + text
```

Copy is the agreed starting point; final wording can be tuned during
implementation without changing structure.

### 2. Flow & timing

> **Revised after first build (user-triggered redirect + auto-attempt).** The
> redirect is now the user's to trigger via a button, and the destination
> auto-attempts the passkey on arrival. The original timed auto-redirect
> (`withMinimumDuration` min-dwell) was removed — superseded by the button.

- On page 1 load, when `isSetupReservation && saltHex`: show `preparing-section`,
  keep `passkey-section` hidden, and reserve the address **in the background**.
- The explainer carries a **"Continue" button**, disabled (`Preparing…`) until
  the reservation resolves; then it enables (`Continue`) and the status line
  becomes "Your Nido is ready." The page does **not** auto-redirect — the
  navigation is the user's to trigger.
- On click: `window.location.replace(accountUrl(host, cAddress,
  "/new-account/?salt=…&autopass=1#salt=…"))` — a one-shot `autopass=1` flag.
- **Arrival (page 2):** lands on the "Lock it to you" step and **auto-attempts**
  the passkey prompt (`attemptAutoPasskey`), then strips the flag. WebAuthn needs
  a transient user gesture that does not survive the cross-subdomain redirect, so
  where it's enforced (notably iOS Safari) the attempt rejects immediately — it's
  swallowed silently (no sheet, no flicker) and the ready "Create with a passkey"
  button remains for a manual tap. The attempt is non-blocking (never disables
  the button) and abortable (a manual tap aborts it and starts the sheet-based
  ceremony), so it can never strand the button. On browsers that allow
  gestureless creation, the OS dialog appears automatically.
- The `reserveNidoAddress` → passkey-create logic is factored into reusable
  units: `buildPasskeyCreateOptions` + `completeRegistration` are shared by the
  manual click handler and `attemptAutoPasskey`.

### 3. Remove the continuity splash

Delete the continuity-splash block and the `prepared=1` redirect flag introduced
in commit `e17a41e` — this explicit explainer supersedes it. Keep the
`display=optional` font change (independent fix, still valid).

### 4. Error handling

If `reserve()` rejects, the `preparing-section` shows the failure inline
("Couldn't prepare your Nido: …") with a path back to the home page, instead of
redirecting — same information as today's "Setup paused" state, on the new
screen. The min-dwell timer is irrelevant on the error path (no redirect).

### 5. Components touched

- `packages/frontend/src/pages/new-account/index.astro` — add the
  `preparing-section` markup + its show/reserve/min-dwell/redirect/error logic;
  remove the page-2 continuity splash and `prepared=1`.
- Reuse existing primitives: `<Nest spin/>`, `.disp`, `.mut`, `.dot.acc`,
  `.hidden` toggle, `accountUrl`, `reserveNidoAddress` (refactored to resolve a
  C-address rather than redirect itself).

## Testing

- **Happy path (preview):** drive home → reservation → redirect. Assert the
  explainer shows, the min-dwell holds it ≥~2.5s on a fast RPC, the status line
  swaps to "Taking you there…", the redirect lands on the subdomain's ready step,
  and only the page-2 click remains.
- **Slow reservation:** simulate a slow RPC; explainer stays for the full
  reservation, no premature redirect.
- **Error path:** force `reserve()` to reject; assert the inline error + home
  link show and no redirect occurs.
- **Regression:** confirm the page-2 ready step and passkey creation still work
  unchanged, and the continuity splash / `prepared=1` are gone.

## Out of scope

- Moving passkey creation to page 1 / shared-rpId one-click flow (breaks
  per-account passkey isolation — see constraint above).
- Reworking where reservation happens (e.g. at name-entry on the home page).
- The logo animation itself (already done earlier in this branch).
