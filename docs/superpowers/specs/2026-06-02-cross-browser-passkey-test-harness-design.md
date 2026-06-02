# Cross-Browser Passkey Test Harness — Design

**Date:** 2026-06-02
**Branch:** `test/passkey-e2e-harness` (off `feat/nido-rebrand`, PR #38)
**Status:** Approved design; Phase 1 complete (PR #42), Phase 2 in progress

> **Amendment (2026-06-02): real-device cloud is TestingBot, not BrowserStack.**
> Wherever this doc says "BrowserStack," read **TestingBot** — the chosen
> provider switched. The architecture is unchanged: TestingBot also drives
> Playwright via a CDP/WS endpoint (`+ TestingBot Tunnel` for localhost) and is
> isolated behind `tests/support/` + env-gated projects. The Phase 0 hard-gate
> spike (does `addInitScript` run on real iOS Safari?) now targets TestingBot.
> Credentials live in 1Password (`op://theahaco/TheTestingBot/key` + `/secret`).

## Problem

g2c is a passkey-authenticated Soroban smart-account wallet. Every meaningful
user flow — account creation/deploy, name claim, dapp connect + SEP-7 signing,
multisig recovery, session-key delegation — depends on WebAuthn
(`navigator.credentials.create` / `.get`), which requires real authenticator
hardware and a human biometric gesture. That makes the app effectively
untestable end-to-end with conventional automation, and impossible to run
across the browser/device matrix we need for "wide support".

We need:

1. **An abstraction over passkey interactions** that lets automated tests
   register and sign *without* a real authenticator, while still exercising the
   real app code and submitting real transactions to **testnet**.
2. **Coverage across as many browsers and devices as feasible** — Chromium,
   Firefox, WebKit, emulated mobile, and real iOS Safari / Android Chrome.

This is built on top of PR #38 (`feat/nido-rebrand`), the canonical Astro
frontend in `packages/frontend`.

## Goals / Non-Goals

**Goals**
- Deterministic, cross-browser passkey mocking that produces signatures the
  on-chain WebAuthn verifier accepts.
- Three test tiers: unit (existing), fast UI e2e (no chain), testnet e2e.
- Real-testnet coverage of the four critical flows.
- A browser/device matrix including a real-device cloud (BrowserStack).
- Local-first, structured so CI (GitHub Actions) drops in later.

**Non-Goals**
- No native/Capacitor app target (the app is web-only; the Capacitor branch in
  `webauthn.ts` is a code-path fallback, not a build target).
- No replacement of the existing Vitest unit tests.
- No GitHub Actions workflow authored in this work (CI-ready, not CI-wired).
- No attempt to test the *real* platform authenticator UX (biometric prompts).

## Key Findings That Shape the Design

These were validated by a parallel investigation of the codebase + external
research (see "References" for file:line evidence).

1. **The synthetic signature is already verifier-compatible.**
   `packages/passkey-sdk/src/syntheticAssertion.ts::buildSyntheticAssertion()`
   produces `{authenticatorData(37B), clientDataJSON, signature(64B low-S r‖s)}`
   over `SHA-256(authenticatorData ‖ SHA-256(clientDataJSON))`. The on-chain
   verifier (`contracts/webauthn-verifier`) checks only: challenge ==
   base64url(payload), digest equality, and a valid low-S P-256 signature. It
   **ignores `origin` and `rpIdHash`.** So a synthetic P-256 key signs
   assertions testnet accepts — no authenticator needed.

2. **Registration needs a faked `create()` response with two readable fields.**
   The app extracts the public key via `response.getPublicKey()` (SPKI; last 65
   bytes = `0x04‖x‖y`), with a CBOR `attestationObject` fallback
   (`packages/passkey-sdk/src/webauthn.ts`). The shim must provide both. The
   credential id (`rawId`) and public key are persisted to localStorage under
   `passkey:{contractId}:credentialId` (base64url) and
   `passkey:{contractId}:publicKey` (hex).

3. **The account address is deterministic.**
   `salt = SHA-256(credentialId)`, then `computeAccountAddress(factory, salt,
   passphrase)` (`packages/passkey-sdk/src/deploy.ts`). A fixed test
   `credentialId` ⇒ a fixed account address ⇒ reusable, idempotent on-chain
   accounts across runs.

4. **One seam covers every flow.** Dapp connect/sign (all three SEP-7 kinds),
   in-app signing, recovery-friend signing, and session-key signing all call
   `navigator.credentials.get()` with `allowCredentials:[{id}]`. A single shim
   that dispatches by `credentialId` covers all of them.

5. **Element IDs are stable across the reskin.** `#approve`, `#cancel`,
   `#claim-name-btn`, `#dapp-origin`, `#payload-text`, recovery/delegate IDs,
   etc. are identical between working-tree and `feat/nido-rebrand`. Selector
   churn from the Nido reskin is not a concern; we add `data-testid` only where
   current IDs are dynamic or ambiguous.

6. **Cross-browser injection works — with one unverified lane.**
   - `page.addInitScript` runs on all three Playwright engines (Chromium,
     Firefox, WebKit). Pass an **inline string/function**, never `{path}`
     (WebKit bug, Playwright #13274). Init scripts **re-run** on Firefox
     (about:blank + each navigation) and double-run on WebKit iframes
     (#26992) — the shim **must be idempotent**.
   - CDP `WebAuthn.addVirtualAuthenticator` is **Chromium-only**; there is no
     cross-browser virtual authenticator in Playwright (WebDriver BiDi has no
     `webauthn` module as of early 2026).
   - **⚠ LOAD-BEARING RISK:** It is **not documented** that `addInitScript`
     runs on **BrowserStack real iOS Safari**. Apple forbids natively
     automating stock Safari; BrowserStack drives it via an undocumented
     bridge, and real iOS exposes no console logs for debugging. If injection
     fails there, passkey tests silently hit the *real* WebAuthn API and hang
     on a biometric prompt. **This is de-risked by a Phase 0 spike that is a
     hard gate on the iOS lane.**

7. **Secure context.** `localhost`/`*.localhost` and HTTPS are secure contexts;
   `http://moss` is **not** and disables `window.PublicKeyCredential` (existing
   memory: `passkey-needs-secure-context.md`). The shim must also define
   `window.PublicKeyCredential` + static methods so app-side feature detection
   (`isUserVerifyingPlatformAuthenticatorAvailable`) passes on any origin.
   Tests serve over `localhost` (local) or an HTTPS tunnel (BrowserStack).

## Architecture

### Component 1 — `TestAuthenticator` (the passkey abstraction)

A self-contained, in-page virtual authenticator injected via
`context.addInitScript`. Bundled (esbuild) into a single IIFE string that
embeds `@noble/curves` P-256 + the create/get overrides + a deterministic key
vault. **Approach A** from brainstorming: in-page, no Node round-trip, so it
runs identically on Chromium/Firefox/WebKit *and* on BrowserStack real devices.

**Interface (what it does):**
- Overrides `CredentialsContainer.prototype.create` and `.get` (writable,
  configurable) rather than reassigning the read-only `navigator.credentials`
  getter. Defines `window.PublicKeyCredential` + static methods.
- `create(options)` → mints a credential: derives a deterministic P-256
  keypair from `(seed, credentialId)`, returns a `PublicKeyCredential` whose
  `rawId` = credentialId, `response.getPublicKey()` = SPKI of the pubkey, and
  `response.attestationObject` = minimal CBOR (authData + COSE key) for the
  fallback path.
- `get(options)` → reads `options.publicKey.challenge` (32B) and
  `allowCredentials[0].id`, looks up the keyed private scalar, and returns an
  `AuthenticatorAssertionResponse` via the existing `buildSyntheticAssertion`
  logic (authenticatorData 37B, clientDataJSON with base64url challenge,
  64B low-S r‖s signature).
- **Idempotent install** (guard flag on `window`), because init scripts re-run
  on Firefox/WebKit.
- **Context-wide, multi-credential vault** keyed by `credentialId`. Because
  every `get()` pins a single `credentialId`, the shim dispatches by id with no
  "active credential" state. Keys are shared across origins/pages in the
  context, so multi-actor and cross-origin flows (friend on another subdomain,
  dapp session key on another origin) work without coordination.
- Deterministic seeding: a fixed seed list maps logical identities
  (`originator`, `friend-a`, `friend-b`, `dapp-session`) to stable
  credentialIds ⇒ stable account addresses ⇒ idempotent testnet reuse.
- Exposes a small `window.__testAuthenticator` debug API (list credentials,
  assert install) so tests can verify installation via a DOM/JS marker — the
  only viable check on real iOS where console logs are unavailable.

**Depends on:** `@noble/curves` (already a passkey-sdk dependency); the
`buildSyntheticAssertion` digest logic (extracted/shared so the Rust tests, the
SDK, and this shim stay byte-identical).

**Packaging:** lives in `tests/support/auth/` with an esbuild step that emits
the init-script string; a `seedAuthenticator(context, identities)` Playwright
helper installs it.

### Component 2 — CDP lane (Chromium high-fidelity)

A `chromium-cdp` Playwright project that uses the real
`WebAuthn.addVirtualAuthenticator` (as the existing
`tests/e2e/account-name.spec.ts` already does) to exercise the browser's
**native** WebAuthn parsing (`getPublicKey()`, real attestation CBOR). This
guards against the shim hiding a real-WebAuthn bug. Chromium-only by nature.

### Component 3 — Test tiers

| Tier | Runner | Chain | Browsers | When |
|------|--------|-------|----------|------|
| **Unit** | Vitest (jsdom) | none | n/a | every push (unchanged) |
| **Fast UI e2e** (`@fast`) | Playwright + shim | none | full matrix | every push |
| **Testnet e2e** (`@testnet`) | Playwright + shim/CDP | testnet | chromium + webkit | nightly / manual, **quarantined (non-blocking)** |

Tiering is by tag (`@fast` / `@testnet`) and directory (`tests/e2e/ui/`,
`tests/e2e/testnet/`). Fast UI tests assert rendering, client validation,
routing, the popup ceremony wiring, and error states without touching the
chain. Testnet tests run the real round-trips.

### Component 4 — Browser/device matrix (Playwright projects)

- `chromium`, `firefox`, `webkit` (shim) — fast UI tier.
- `chromium-cdp` (real virtual authenticator) — fidelity lane.
- `mobile-chrome`, `mobile-safari` (Playwright device emulation, shim).
- `browserstack-ios-safari`, `browserstack-android-chrome`,
  `browserstack-desktop-safari`/`edge` — **gated** behind the Phase 0 spike and
  `BROWSERSTACK_*` env credentials. Wired for **BrowserStack** (the chosen
  provider): tests connect to BrowserStack-hosted browsers via the
  BrowserStack Playwright WS endpoint (`browserType.connect`) with capabilities
  set per project. Cloud-specific glue is isolated in `tests/support/` so the
  rest of the suite is unaware of where a browser runs.

### Component 5 — testnet reliability

- **Funded "bank" account.** A pre-funded G-address secret (`G2C_TEST_BANK_SECRET`
  env) injected into `localStorage['g2c:name-keypair']` before tests, so the
  submitter/fee-payer is reused instead of minting a fresh friendbot account per
  test. `primaryPasskeySigner.ts::getSubmitter()` reads this key (the
  `SUBMITTER_KEY` constant); the exact injection seam for each signing path
  (`walletSign.ts` has its own submitter handling) is pinned during
  implementation. Friendbot is used only as a fallback / for one-time bank
  top-up.
- **Bounded retries with backoff** on transient RPC/friendbot errors and a
  helper to poll `getTransaction` (mirrors the existing in-app poll loop).
- **Idempotent identities + unique-per-run names.** Deterministic accounts are
  reused if already deployed (skip deploy); name-claim tests use a unique name
  per run and use the **release** flow as cleanup.
- **Quarantine.** The testnet project is marked non-blocking so chain flakiness
  never reds the whole run; failures are reported but don't gate.

### Component 6 — Serving & layout

- Root `playwright.config.ts` with a Playwright-managed **`webServer`** serving
  `packages/frontend/dist` (replaces the per-test hand-rolled `http.createServer`
  in `account-name.spec.ts`, which port-collides under parallel workers). The
  server honors `*.localhost` subdomain routing (browsers resolve `.localhost`
  to loopback automatically; the app derives the contract id from the hostname).
- `baseURL` = `http://localhost:<port>`; tests build subdomain URLs as
  `http://<caddr>.localhost:<port>/...`.
- Directory layout:
  - `tests/e2e/ui/` — `@fast` specs
  - `tests/e2e/testnet/` — `@testnet` specs
  - `tests/support/` — `auth/` (TestAuthenticator + esbuild), `fixtures.ts`
    (Playwright fixtures: seeded authenticator, bank, server), `dapp/` (a tiny
    static "test dapp" page to drive connect/sign popups), `testnet.ts`
    (retry/bank helpers).
- `just` recipes: `test-e2e` (fast, all browsers), `test-e2e-testnet`
  (quarantined), `test-e2e-cdp` (chromium fidelity lane).
- Migrate the existing `tests/e2e/account-name.spec.ts` into the new structure
  (its CDP setup becomes the `chromium-cdp` lane; its UI assertions become
  `@fast`; its testnet flow becomes `@testnet`).

## Flow Coverage (testnet tier)

Driven via the seeded `TestAuthenticator`; multi-actor flows use one Page per
actor sharing the context-wide vault.

1. **Create + deploy** — landing → create G-funded account → register passkey →
   deploy smart account. Foundational; other flows reuse the deployed account.
2. **Claim / release name** — claim via name registry (build → simulate →
   passkey-sign → submit), then release (cleanup). Exercises the full in-app
   signing round-trip.
3. **Dapp connect + sign (SEP-7)** — a tiny test "dapp" page opens the wallet
   `/connect/` popup (`?dapp=&return=`), reads the `postMessage`
   `{source:'g2c-wallet', search:'?g2c_address=…'}` (or redirect fallback),
   then opens `https://<caddr>.localhost/sign/?kind=tx|message|authEntry&…` and
   approves. Uses Playwright `waitForEvent('popup')`. All three kinds go through
   the same `get()` seam.
4. **Recovery + session keys + delegate** —
   - *Recovery* (N+1 actors): originator stages a rotation, hands off
     `?handoff=…` to each friend page (distinct credentialId per friend), each
     signs the **nested auth entry targeting the recovering account's
     `__check_auth`** with the **byte-identical canonical
     `parentSignatureExpirationLedger`**, originator collects M-of-N and
     submits. (Matches existing memory `delegated-friend-nested-auth.md`.)
   - *Session-key delegation* (2 actors): dapp origin creates a session passkey
     (`createSessionPasskey`), redirects to `/security/delegate/?…pubkey=…`,
     wallet signs install with primary passkey, returns `?delegation=ok`.
   - *Delegate form* (in-wallet) happy path.

## Phasing

- **Phase 0 — BrowserStack iOS de-risking spike (hard gate).** A one-off:
  `addInitScript` sets a DOM marker (`documentElement.dataset.shimInstalled`)
  and a session over BrowserStack real iOS Safari asserts the marker
  post-navigation. **If absent**, the shim-on-real-iOS assumption is dead and we
  fall back to: real iOS covered for *non-WebAuthn* UI only (Approach C floor),
  while shim coverage stays on Chromium/Firefox/WebKit/emulated-mobile +
  Android. Decision recorded before building the iOS lane.
- **Phase 1 — TestAuthenticator + fixtures.** Build/bundle the shim, the
  Playwright fixtures, `playwright.config.ts`, `webServer`, and migrate the
  existing spec. Prove the `@fast` tier green on chromium/firefox/webkit +
  `chromium-cdp`.
- **Phase 2 — testnet tier.** Bank + retries + quarantine; create+deploy and
  claim/release flows on chromium + webkit.
- **Phase 3 — dapp + multi-actor flows.** Test dapp page; connect/sign SEP-7;
  recovery + session-key + delegate.
- **Phase 4 — real-device matrix.** BrowserStack projects (gated on Phase 0);
  emulated mobile profiles.
- **CI-ready handoff.** Structure documented so a GitHub Actions matrix
  (`--grep @fast` per browser, secrets for bank/BrowserStack, artifact upload)
  drops in without restructuring. No workflow authored here.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `addInitScript` doesn't run on BrowserStack real iOS | **Phase 0 hard gate**; DOM-marker check (no console on iOS); documented fallback to Approach C for iOS |
| Init script re-runs (Firefox/WebKit) corrupt vault | Idempotent install guard on `window` |
| WebKit `{path}` init-script bug | Inject inline string only |
| App feature-detects `window.PublicKeyCredential` before shim | Shim defines `PublicKeyCredential` + static methods; serve over secure context |
| Synthetic crypto drifts from Rust/SDK | Share the `buildSyntheticAssertion` digest logic; assert against the SDK's existing unit tests |
| Nested-auth digest byte-mismatch in recovery | Pin canonical `parentSignatureExpirationLedger` in handoff; assert originator==friend digest |
| testnet flakiness reds CI | Quarantine tier + retries + funded bank |
| credentialId format mismatch (base64url/hex/ArrayBuffer) | Mirror `storage.ts` serialization exactly; round-trip assertions |
| `http://moss` insecure context | Tests use `localhost` / HTTPS tunnel; never `moss` for WebAuthn-touching tests |

## References (file:line evidence)

- `packages/passkey-sdk/src/syntheticAssertion.ts:20-57` — synthetic assertion
- `packages/passkey-sdk/src/webauthn.ts:22-73,206-316` — registration parse
- `packages/passkey-sdk/src/deploy.ts:18-50` — deterministic account address
- `packages/passkey-sdk/src/storage.ts:9-30` — localStorage credential keys
- `packages/passkey-sdk/src/auth.ts:110-120` — assertion parse / inject
- `packages/frontend/src/lib/walletSign.ts:121-261` — dapp sign (all 3 kinds)
- `packages/frontend/src/lib/primaryPasskeySigner.ts:136-152` — in-app sign
- `packages/frontend/src/lib/recoveryActions.ts:~552` — friend signing
- `packages/passkey-sdk/src/sessionKey.ts:113-171` — session passkey create/get
- `packages/stellar-wallets-kit-module/src/{urls,handover,redirect,module}.ts`
  — SEP-7 connect/sign URL + postMessage contract
- `tests/e2e/account-name.spec.ts` — existing CDP virtual-authenticator pattern
- Playwright: addInitScript cross-browser (mock-browser-apis docs), #13274
  (WebKit path bug), #26992 (re-run), #26621 (no WebKit virtual authenticator)
- BrowserStack Playwright real iOS (June 2025 launch; addInitScript parity
  undocumented — Phase 0 spike)
