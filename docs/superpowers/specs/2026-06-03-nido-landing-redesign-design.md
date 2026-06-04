# Nido landing redesign + "My Nido" menu — Design

_Date: 2026-06-03 · Status: approved design, pre-implementation_

## 1. Problem & goal

The current landing (`packages/frontend/src/pages/index.astro`) couples marketing
content with account state: it shows either the marketing hero **or** a full-page
"welcome-back" list (a whole-page swap added in a prior pass), depending on whether
`localStorage` holds any Nidos.

We want a cleaner model:

- The landing is a **general info page, shown identically to every visitor**.
- A single, premium **"My Nido"** entry point — a button in the top-right of the
  nav — handles all account state via a dropdown menu:
  - **0 Nidos** → a create walkthrough (start creating one)
  - **1 Nido** → the menu opens with that Nido as the top row (tap = open its wallet)
  - **2+ Nidos** → a selector listing each Nido

The full-page welcome-back swap is **removed** and replaced by this button-driven menu.

## 2. Scope

**In scope**
- Restructure `index.astro` into an always-on info page (hybrid: new top-level
  structure + hero, reusing the strong existing pieces).
- A self-contained `MyNidoMenu` component (trigger button + popover + behavior).
- Extract shared helpers (`balance`, `createNido`, `myNidoModel`) so the menu and
  the wallet page reuse one implementation.
- Remove the old `enterWelcomeBack` full-page-swap logic and its markup
  (`#accounts-section` welcome-back framing, `#create-another`).

**Out of scope**
- The wallet (`/account/`), `/new-account/`, security, sign, connect pages — unchanged
  except for the balance-helper extraction.
- Any contract / SDK / auth changes.
- R-01 (status-message dApp) — unrelated, tracked separately.

## 3. Behavior model

The landing renders the same informational content for everyone. Account state is
read **client-side** from `localStorage` and surfaced only inside the My Nido menu:

- `loadAccounts()` → confirmed (active) Nidos (`g2c:accounts`)
- `loadPendingAccounts()` → reserved-but-not-yet-deployed Nidos (`g2c:pending`)

Menu state is derived purely from those two lists plus saved names
(`loadAccountName`):

| Active | Menu state | Header | Body |
|-------:|------------|--------|------|
| 0 | `empty`  | — | Create-card (Nest mark, copy, "Set up with your face") |
| 1 | `single` | "Welcome back" | The one Nido row + "Create another Nido" |
| 2+ | `multi` | "Your Nidos · N" | One row per Nido + "Create another Nido" |

Pending accounts appear (in any state) as muted **"Finishing setup…"** rows that
resume `/new-account/?key=<secret>`. When the existing async chain-verification
confirms a pending account, it is promoted (`activateAccount`) and its row
re-renders as a normal active row. If only pending accounts exist (0 active), the
menu still shows the create-card plus the pending row(s) — a user mid-creation can
both resume and start fresh.

**The menu opens in every state** (consistent interaction). For a single Nido it
opens with that Nido as the top row — one tap opens the wallet — rather than
auto-redirecting, so "Create another" stays reachable.

## 4. Components & files

Designed as small, independently-testable units.

### 4.1 `components/MyNidoMenu.astro` (new)
Self-contained: renders **both** the nav trigger button and the popover, with
scoped `<style>` (premium treatment) and a co-located client `<script>` (the
controller). `index.astro` drops `<MyNidoMenu />` into the nav and it is fully wired.

- **Trigger:** the nav button. Also opens on a `nido:open-menu` CustomEvent so the
  hero and CTA-band buttons can open it (handler smooth-scrolls to top, then opens).
- **Open/close:** click toggles; closes on outside-click and `Escape`.
- **Render:** builds DOM from `buildMyNidoModel(...)` on open (and re-renders when a
  pending account confirms or a balance resolves).
- **Balances:** on open, kicks `fetchXlmBalance` per active row; row shows a
  `.skeleton` placeholder until the number resolves; on failure shows `—`.
- **Create:** the create-card / "Create another" calls `createNido()` then navigates.
- **Motion:** spring-open popover (transform-origin top-right), staggered row
  cascade (~70 ms apart), caret flip, breathing teal status dots. All entrance
  motion gated under `@media (prefers-reduced-motion: no-preference)` — reduced-motion
  users get an instant, calm render. Uses existing nido.css tokens (`--sh-3`,
  `--acc-soft`, `--good`, radii, fonts).

### 4.2 `lib/myNidoModel.ts` (new, pure — unit-tested)
```ts
type MyNidoRow = {
  contractId: string;
  name: string | null;       // friendly name or null
  status: 'active' | 'pending';
  resumeKey?: string;        // for pending rows → /new-account/?key=
};
type MyNidoModel = {
  state: 'empty' | 'single' | 'multi';
  rows: MyNidoRow[];         // active first, then pending
};
function buildMyNidoModel(
  accounts: string[],
  pending: { contractId: string; secretKey: string }[],
  nameOf: (id: string) => string | null,
): MyNidoModel
```
No DOM, no network — easy to unit-test the 0/1/2+/pending derivations.

### 4.3 `lib/balance.ts` (new — extracted from `account/index.astro`)
Moves the existing `fetchXlmBalance(contractId): Promise<string>` (RPC simulate of
the XLM SAC `balance` call) into a shared module. `account/index.astro` imports it
instead of its inline copy — single source of truth. Formatting stays via the
existing `money.formatXlm`.

### 4.4 `lib/createNido.ts` (new — extracted from `index.astro`)
Moves the account-reservation half of the current `createAccount()`: friendbot-fund
a fresh keypair, call the factory `get_c_address`, `savePendingAccount`, and return
`accountUrl(host, cAddress, "/new-account/?key=<secret>")`. The menu's create button
awaits it and navigates. Progress/error surfaced inside the menu.

### 4.5 `pages/index.astro` (restructured)
- **Nav:** Logo (left) · `<MyNidoMenu />` + GitHub link (right).
- **Hero:** informational, identical for all visitors — reuse current copy/voice +
  the preview card (already shows XLM / Receive / Approve / testnet line). Its
  primary CTA is **state-neutral** (label: "Get started", since the hero is the
  same for everyone) and fires `nido:open-menu` — the menu then adapts to state.
- **Reused sections:** how-it-works (`#how`), features (`#why`), CTA band — its
  button is likewise labelled "Get started" and fires `nido:open-menu`.
- **Removed:** `enterWelcomeBack()`, `#accounts-section` welcome-back framing,
  `#create-another`, the inline `createAccount` reservation logic (now in
  `createNido.ts`), and the `addAccountRow` landing-list rendering (the menu owns
  account presentation now). Name/dapp redirect logic at the top of the script is
  preserved.

## 5. Data flow

```
page load
  → render info page (static, same for all)
  → MyNidoMenu mounts:
       accounts = loadAccounts() (sync)
       pending  = loadPendingAccounts() (sync)
       model    = buildMyNidoModel(accounts, pending, loadAccountName)
       (menu DOM built lazily on first open)
  → async, non-blocking:
       • verify each pending vs chain → activateAccount + re-render row
       • on menu open: fetchXlmBalance per active row → fill skeleton
```
The page never blocks on network; the menu degrades gracefully offline.

## 6. Error handling

- **Balance fetch fails / offline** → row shows `—`; no thrown error, other rows
  unaffected.
- **createNido fails** (friendbot / factory / registry) → message shown in the menu,
  button re-enabled.
- **Pending chain-check fails** → row stays "Finishing setup…" (retried on next load).
- **Name-resolution redirect** (existing) → preserved verbatim.

## 7. Testing

- **vitest**
  - `myNidoModel.test.ts` — 0/1/2+ active, pending-only, mixed active+pending,
    name vs no-name, ordering (active before pending).
  - balance formatting via existing `money` tests (extraction keeps behavior).
- **Playwright** (same harness used to verify prior fixes; `astro preview` on
  `0.0.0.0`, URL host `moss`)
  - fresh (no `g2c:accounts`) → button shows; menu opens to create-card.
  - seed one account → menu opens to "Welcome back" + 1 row + create-another.
  - seed several → "Your Nidos · N" + rows.
  - open/close via outside-click and Escape.
  - `prefers-reduced-motion` emulation → no spring/cascade, content visible.
- **Baseline gates:** `astro check` stays at the known 2-error baseline (no new
  diagnostics); `astro build` (9 pages) and `vitest` green.

## 8. Visual reference

Approved mockups live in `.superpowers/brainstorm/` (gitignored):
`mynido-menu.html` (three states) and `mynido-animated.html` (motion). Premium cues:
warm gradient header, anchored caret, brand-hued avatars with breathing teal status
dots, mono short-addresses, async balances, soft 28px elevation.

## 9. Risks / open considerations

- **Balance cost:** one RPC simulate per active Nido on menu open. Acceptable
  (fires only on open, async, skeleton-backed). If a user has many Nidos this is N
  calls — fine at expected scale; could batch later if needed.
- **Popover positioning** from a far-down CTA: resolved by scroll-to-top-then-open,
  so the menu always appears anchored to the nav button in the viewport.
- **Reduced-motion** correctness is a first-class requirement, not an afterthought
  (mirrors the S-01 audit fix).
