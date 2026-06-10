# Account URLs + Nido Switcher + Home-link fix — Design

- **Date:** 2026-06-10
- **Branch:** `feat/account-urls-and-switcher` (off `origin/main` @ `11a1673`)
- **Status:** Approved (design), pending implementation plan
- **Area:** `packages/frontend` (Astro)

## Goal

Three related changes to how an account is addressed and navigated:

1. **Shareable account URL drops the `/account` suffix.** `alice.nido.fyi` instead of
   `alice.nido.fyi/account/`. Applies to **all** account links (user decision), relying on the
   existing subdomain-root → `/account/` redirect.
2. **"Home" returns to the apex** from a subdomain. Today the desktop sidebar brand links to `/`,
   which on a subdomain redirects straight back to the account — a loop. It should go to the apex
   marketing home, matching the mobile topbar mark which already does.
3. **An "other nidos" switcher** at the account identity location: the **mobile topbar chip**
   (top-right) and the **desktop sidebar chip** both become the switcher trigger, opening the same
   "My Nido" panel (your nidos + balances + "Create another").

## Current state (main @ 11a1673)

- **Routing already works:** `index.astro` (the `bleed`/marketing landing) redirects a subdomain
  root to `/account/` — synchronously for a contract-ID subdomain, and after registry resolution
  for a name subdomain (`src/pages/index.astro` subdomain-redirect block).
- **`accountUrl(host, id, path = "/")`** (`packages/passkey-sdk/src/url.ts`) builds the
  protocol-relative `//<id-or-name>.<apex><path>` URL, preview-aware. It already **defaults to `/`**.
- **Account page** (`src/pages/account/index.astro`) uses the default **`app` shell**
  (`NidoLayout.astro`: `shell="app"` → left `<Sidebar />` + content grid on desktop):
  - **Mobile (<1024px):** `.topbar` visible — Nest mark `#home-link` (left), `.topbar-account`
    chip "Your Nido" + avatar (right, links `/account/`).
  - **Desktop (≥1024px):** `.col-app .topbar:has(.topbar-mark)` is **hidden**; the `<Sidebar />`
    carries nav; the Home view shows a `.home-greeting` header (name + "Testnet" chip).
  - Share link is rendered in the "Your name" card and set at
    `accountUrl(rootHost, existingName, "/account/")`; the post-name-claim redirect uses the same
    `/account/` path; the signing-mode redirect uses `accountUrl(rootHost, resolved, pathname+search)`.
  - The mobile `#home-link` is rewritten early to `//<apex>/` to avoid the redirect loop.
- **`Sidebar.astro`** (≥1024 only): brand `href="/"`, nav Home (`/`) / Activity
  (`/account/activity/`) / Security (`/security/`), account chip `.nido-sidebar-account`
  `href="/account/"` (avatar + "Your Nido"). The brand and nav-Home are **not** rewritten on a
  subdomain → the desktop "home" loop.
- **`MyNidoMenu.astro`** renders the "My Nido ▾" pill + an anchored popover whose rows/header/foot
  are injected via `innerHTML` at runtime. Used **only** on the landing page (top-right of
  `.lp-nav`). Its inline script targets global IDs `#mynido` / `#mynido-btn` / `#mynido-panel`,
  renders rows from `buildMyNidoModel(loadAccounts(), loadPendingAccounts(), loadAccountName)`,
  loads balances, and wires open/close + the `nido:open-menu` event (hero/CTA buttons). Row hrefs
  use `accountUrl(window.location.host, name ?? contractId, "/account/")`.
- Activity/Security pages have **no** mobile account-chip topbar.

## Design

### 1. Bare account links

Change every **navigational account-location** link from `"/account/"` to `"/"` (or drop the arg —
`accountUrl` defaults to `/`), and strip the trailing slash in displayed link text:

- `account/index.astro` — the "Share link" `<a id="name-url">` (`nameHref`), and the post-name-claim
  redirect (`nameUrl`). For the displayed share text, render `host` without `//` **and without a
  trailing `/`** (e.g. `alice.nido.fyi`).
- The switcher row links (in the shared switcher module — see §3).

**Explicitly unchanged:**
- The **signing-mode redirect** (`accountUrl(rootHost, resolved, pathname + search)`) — it must
  preserve `?sign=…&callback=…` for passkey RP binding. Not an "account location" link.
- `index.astro`'s redirect **target** stays `/account/` — that is the real page bare links resolve
  *to*; the redirect itself is untouched (low risk).

**Out of scope:** the `status-message` example dApp's account link (a separate demo) and per-name
social cards (tracked separately).

### 2. Home → apex

Rewrite the **brand logo** to the apex on a subdomain, matching the existing mobile `#home-link`:
- `Sidebar.astro` brand anchor gets an id/hook; a small inline script sets its `href` to
  `//${stripSubdomain(window.location.host)}/` when on a subdomain. Shared `Sidebar` ⇒ fixes the
  desktop "home" on Home/Activity/Security at once.
- The mobile topbar Nest mark already does this — no change.

The sidebar **"Home" nav item stays** pointing at the account overview (`/` → `/account/` on a
subdomain). Within an account, "Home" = your dashboard; only the brand logo is "exit to Nido home".

### 3. Nido switcher

Three triggers must open the **same** panel, so the panel becomes a single shared implementation
rather than duplicated markup/logic.

**Extract** the panel model/render/wiring out of `MyNidoMenu.astro`'s inline script into
`src/lib/nidoSwitcher.ts`, exported as `mountNidoSwitcher(root: HTMLElement)`:
- Scopes all queries to `root` via **data-attributes** (`[data-mynido-trigger]`,
  `[data-mynido-panel]`) instead of global IDs, so multiple instances can coexist on one page.
- Owns: render rows (`buildMyNidoModel`), balances, "Create another" wiring, open/close,
  Escape/click-outside, and the `nido:open-menu` listener (opens the first instance — the landing
  pill). `buildMyNidoModel` stays in `myNidoModel.ts` unchanged.
- Row hrefs use the **bare** URL (`accountUrl(host, name ?? contractId, "/")`).

**`MyNidoMenu.astro`** becomes a thin wrapper:
- Renders `.mynido` root + `[data-mynido-panel]` + a **trigger `<slot>`** (default = the existing
  "My Nido ▾" pill marked `data-mynido-trigger`).
- Accepts a `placement` prop: `down` (default; panel below, `top: 100%`) or `up` (panel above,
  `bottom: 100%`) for the sidebar. The `is:global` `.mynido` / `.mn-*` styles stay; add the `up`
  variant.
- A single page-level script calls `mountNidoSwitcher` for **each** `.mynido` on the page.

**Triggers:**
- *Landing* (`index.astro`): unchanged — default pill, already top-right.
- *Mobile topbar* (`account/index.astro`): the `.topbar-account` chip becomes
  `data-mynido-trigger` (current nido name + avatar + caret) wrapped in a `.mynido` root + panel.
  Account-page only. It was an `<a href="/account/">`; it becomes a `<button>` (opens the panel).
- *Desktop sidebar* (`Sidebar.astro`): the `.nido-sidebar-account` chip becomes the
  `data-mynido-trigger` (placement `up`), wrapped in a `.mynido` root + panel. Covers
  Home/Activity/Security via the shared component.

Because the mobile topbar and desktop sidebar are mutually exclusive by breakpoint, the account page
carries two `.mynido` instances (only one visible per breakpoint); the mount script handles both.

**Trigger identity:** the trigger shows the current Nido where the page knows it — the account page
already resolves and sets `#account-nickname` + `.js-account-name`; extend that to the chip name +
avatar. The sidebar uses the cached name (`loadAccountName`) / short address + deterministic avatar
as a best-effort fallback on Activity/Security.

## Component boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `lib/nidoSwitcher.ts` (new) | Render + wire one switcher panel for a given root; bare row links | `myNidoModel`, `balance`, `avatarStyle`, `createNido`, `@g2c/passkey-sdk` |
| `MyNidoMenu.astro` (refactor) | Root + panel + trigger slot + placement; mount all instances; styles | `nidoSwitcher.ts` |
| `Sidebar.astro` (edit) | Brand→apex; account chip as switcher trigger (placement `up`) | `MyNidoMenu` parts |
| `account/index.astro` (edit) | Topbar chip as switcher trigger; bare share + claim links | `MyNidoMenu` parts, `accountUrl` |
| `url.ts` (unchanged) | `accountUrl` already defaults to `/` | — |

## Testing

- **Unit (vitest):**
  - `nidoSwitcher` row-model test: rows produce **bare** hrefs (no `/account/`).
  - Share-link text assertion: displayed text has no `/account/` suffix and no trailing slash.
  - `accountUrl(host, id)` default-path behavior is already covered by `url.ts` tests; add a case if
    a gap exists.
- **Build/typecheck:** `astro check` + `astro build` (note: a small pre-existing `astro check`
  baseline may exist — compare against baseline, don't regress).
- **Manual:** bare name + contract subdomain → account page; brand logo → apex (mobile + desktop);
  switcher opens from the topbar (mobile) and sidebar (desktop), rows navigate, "Create another"
  works; share link reads `alice.nido.fyi`.

## Risks / tradeoffs

- **Bare internal links** route through `index.astro` first; for **name** subdomains that is a
  registry round-trip + a brief landing flash before redirect (contract subdomains redirect
  synchronously, no flash). Accepted by the user for consistency; `index.astro` stays untouched to
  keep risk low. A future "redirect any account subdomain immediately, resolve on the account page"
  change would remove the flash.
- **ID → data-attribute refactor** of the switcher is the largest change; it is required to run more
  than one instance per page and yields a single source of truth for the panel. Landing behavior
  must stay byte-identical (default pill, `nido:open-menu`).

## Out of scope

- `status-message` example dApp account link.
- Per-name Open Graph / social cards.
- Changing `index.astro`'s name-resolution/redirect strategy.
