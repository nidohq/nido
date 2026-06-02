# Nido — Desktop / Responsive Layout Design Spec

**Date:** 2026-06-01
**Status:** Draft (brainstorm) — pending user review
**Builds on:** PR #38 (Nido reskin), [`2026-06-01-nido-rebrand-design.md`](./2026-06-01-nido-rebrand-design.md) (brand identity)

---

## 1. Problem

PR #38 wraps **every** page in `NidoLayout`'s `.col` (a `max-width: 448px` phone column). Two consequences:

- The **landing** page's existing 1180px responsive marketing layout (`.lp` hero/steps/features grids) is **clamped into the 448px column** — the wide desktop design renders at mobile width ("renders desktop to mobile").
- The **app screens** (account, security, status-message) only ever show the mobile phone-card, even on a wide desktop — there is **no real desktop experience**.

The brand spec defines color/type/voice/logo but **says nothing about desktop layout**. This spec fills that gap with a genuine phone → desktop responsive system.

## 2. Scope

**In scope**
1. `NidoLayout` **`shell` modes** — `app` (default) / `focused` / `bleed`.
2. **Desktop sidebar + card-grid** for the persistent app screens (account, security, status-message).
3. **Landing un-clamp** — full-bleed responsive marketing page.
4. **Logo #3** — replace the standin wallet-kit `productIcon` with the Nido Nest-Ring mark.
5. **Logo #4** — Nido mark in the top-left (sidebar header on desktop, top bar on mobile), replacing the seeded `<Avatar>` circle.

**Out of scope**
- Send / Activity / Add-money / zk-18 / spending-limits screens — no backend (Send tracked in #40).
- Code/identifier rename (`g2c-*`, contract IDs, RP IDs, query params) — per brand spec §9.
- Production logo asset finalization — still the sketch Nest Ring.
- Self-hosting fonts — later hardening task (per #38).

## 3. Shell modes (`NidoLayout.astro`)

Add a `shell` prop: `'app' | 'focused' | 'bleed'`, default `'app'`. The prop only changes the **wrapper around `<slot/>`** plus grid/sidebar classes — page **bodies and their byte-identical auth/recovery `<script>` blocks are untouched** (same guarantee as #38).

| `shell` | Pages | `<800px` | `800–1024px` | `≥1024px` |
|---|---|---|---|---|
| `app` (default) | account, security/*, status-message | phone column | widened column, cards 2-up | **sidebar + card grid** |
| `focused` | new-account, sign, connect | phone column | centered card | centered card on stage |
| `bleed` | index (landing) | full-bleed responsive | full-bleed responsive | full-bleed responsive |

## 4. Breakpoints

- **`<800px`** — today's phone column, unchanged (the mobile design ships as-is).
- **`800–1024px`** — centered widened column (~820px); cards reflow 2-up; no sidebar yet (needs width).
- **`≥1024px`** — sidebar + card grid.

## 5. Desktop app shell (`≥1024px`)

- **Sidebar** (fixed left, ~240px):
  - **Top:** Nido **Nest-Ring mark + "Nido" wordmark** → satisfies **Logo #4** on desktop.
  - **Nav:** Home (`/`), Security (`/security`). *(Today's "Settings" quick action just links to `/security/`, so Security covers it; a dedicated Settings nav item lands when a real settings page exists.)*
  - **Bottom:** account chip (nickname + avatar) — pinned. *(A multi-account switcher slots here when multi-account lands; not in this spec.)*
- **Main pane:** the page's existing cards reflow into a responsive grid — `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`. The primary card (balance / address) spans full width via a `.span-all` class.
- **Account page developer actions** (*Invoke a contract* / *Sign a hash*) → folded into **one collapsible "Developer" card** at the bottom of the grid (collapsed by default), keeping the consumer view clean.

## 6. Mobile (`<800px`) and middle tier (`800–1024px`)

- **`<800px`** — the phone column exactly as it ships today, with one change: the top bar's **left slot becomes the Nido Nest-Ring mark** (Logo #4); the account avatar/identity moves to the **top-right**.
- **`800–1024px`** — centered widened column (~820px); cards reflow 2-up; no sidebar. Top bar same as mobile (mark left, account right).

## 7. Focused shell (onboarding / sign / connect)

A **centered card on the stage** at all widths (no sidebar) — these are single-task confirmations ("Create your Nido", "Confirm with Face ID", "Connect to dApp"); a dashboard chrome around them would be wrong. On mobile, the existing phone column.

## 8. Landing — `bleed` shell

`index.astro` → `shell="bleed"`: render **full-bleed** (outside `.col`), so the existing `.lp` responsive layout works on desktop — hero 2-col grid, steps/features 3-col grids, `max-width: 1180px`, with its own 720/760/860px breakpoints. **This is the literal "renders desktop to mobile" fix.** The prototype's router already special-cased the landing as full-bleed (`app/app.jsx`); this restores that distinction the Astro port lost.

## 9. Logos

- **#3 — wallet-kit standin:** replace `G2C_ICON` (base64 `data:image/svg+xml`) in `packages/stellar-wallets-kit-module/src/module.ts:53` (wired as `productIcon`) with the Nido Nest-Ring mark; rebuild the package `dist/`. The wallet **name stays "g2c"** (identifier rename is out of scope).
- **#4 — top-left mark:** covered by §5 (sidebar header, desktop) and §6 (top bar, mobile) — the Nest-Ring mark replaces the seeded `<Avatar>` circle.

## 10. Account identity placement

Because the Nido mark takes the top-left, the account **nickname + avatar** move to: **sidebar bottom** (desktop ≥1024) / **top-right** (mobile + middle tier <1024). *(A multi-account switcher is future work.)*

## 11. Implementation approach & constraints

- Confine changes to: `NidoLayout.astro` (shell prop + conditional wrapper), a new `components/Sidebar.astro`, `styles/nido.css` (sidebar + grid + breakpoint rules + landing escaping `.col`), a per-page `shell="…"` prop, and light wrapper-class additions around **existing** cards.
- **Do NOT** alter the auth / recovery / sign / connect `<script>` logic — byte-identical, per #38.
- **No** `g2c-*` / contract-ID / RP-ID / query-param renames.
- Reuse existing components (`Logo`, `Nest`, `Avatar`, `Icon`) — no new design primitives beyond `Sidebar`.

## 12. File inventory (what changes)

| File | Change |
|---|---|
| `src/layouts/NidoLayout.astro` | `shell` prop; conditional `app`/`focused`/`bleed` wrapper |
| `src/components/Sidebar.astro` | **new** — brand mark, nav, account chip/switcher |
| `src/styles/nido.css` | `.shell-app` sidebar + grid + breakpoint rules; landing escapes `.col`; `.span-all` |
| `src/pages/index.astro` | `shell="bleed"` |
| `src/pages/new-account`, `sign`, `connect` | `shell="focused"` |
| `src/pages/account`, `security/*`, `status-message` | `shell="app"`; wrap cards in grid |
| `src/pages/account/index.astro` | fold dev actions into collapsible "Developer" card; move account chip to sidebar/top-right |
| `packages/stellar-wallets-kit-module/src/module.ts` (+ `dist/`) | new Nest-Ring `productIcon` |

## 13. Testing / verification

- **Visual:** Playwright screenshots at **1440 / 1024 / 375px** for landing + account + security (before/after).
- **Regression:** existing `vitest` suite stays green; `astro check` introduces **no new** errors (baseline = 2 pre-existing); `astro build` builds all 9 pages.

## 14. Resolved decisions

- Breakpoints: **800 / 1024**.
- Account chip: **sidebar-bottom (desktop) / top-right (mobile)**.
- Developer actions: **collapsed "Developer" card** at the bottom of the grid.
- Shell pattern: **sidebar + card grid** for the persistent app; focused flows stay centered; landing full-bleed.
