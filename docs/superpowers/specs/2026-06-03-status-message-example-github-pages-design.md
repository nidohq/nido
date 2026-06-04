# Status-message example: live on GitHub Pages

**Date:** 2026-06-03
**Status:** Approved (brainstorming)
**Predecessor:** `2026-06-02-status-message-scaffold-template-design.md` (the scaffold itself, PR #43)

## Goal

Turn the `examples/status-message-dapp/` scaffold (currently PR #43) into a
**live, working example dApp on GitHub Pages** at `https://theahaco.github.io/g2c/`,
running against **Stellar testnet** and connecting to the production g2c passkey
wallet at `https://mysoroban.xyz`. Then add a footer link from the Nido wallet
frontend to that live example.

The example demonstrates a third-party dApp connecting through the
`@creit.tech/stellar-wallets-kit` selector with the g2c passkey smart account
(`@g2c/stellar-wallets-kit-module`) registered first, reading/writing the
`status-message` contract.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Hosting | Default GitHub Pages project site `https://theahaco.github.io/g2c/` (base path `/g2c/`) |
| Contract client | Commit the generated TS client (bound to the deployed testnet id); CI does `npm ci && vite build` only — no Rust, no scaffold, no live RPC at build time |
| Nido → example link | Global site footer |
| PR split | Part A–C (example + Pages) land on **PR #43** (retargeted to `main`); Part D (Nido footer link) is a separate follow-up PR off `main` |
| Live demo network | Testnet |
| `PUBLIC_G2C_BASE` | `https://mysoroban.xyz` (production g2c wallet, testnet) |

## Non-goals

- No change to the existing Cloudflare Pages deploy of the main Nido app
  (`deploy.yml` / `preview.yml`, project `mysoroban`). GitHub Pages is an
  independent, additional target used **only** for this example.
- No automated end-to-end passkey *write* test. The write path needs a real
  WebAuthn ceremony at `mysoroban.xyz` → manual QA (already noted in the
  example README).
- The unrelated working-tree WIP present at the start of this work (contracts,
  auth-entry guards, integration-test snapshots, `packages/frontend`
  delegationHandover/index.astro, `app/`, `g2c.zip`) is **out of scope** and
  must be left untouched.

## Part A — Bring PR #43 onto `main`

PR #43 (`feat/status-message-scaffold-template`) bases on `feat/nido-rebrand`
(#38), which is now merged → PR shows `CONFLICTING`.

1. **Stash unrelated WIP.** `git stash push -u` (or selective stash) so the
   working tree is clean and the WIP is preserved for the user. Nothing from the
   stash enters this branch.
2. **Retarget base:** `gh pr edit 43 --base main`.
3. **Rebase** `feat/status-message-scaffold-template` onto `origin/main`. Because
   #38 is already in `main`, the rebase drops the duplicate commits, leaving only
   the example-scaffold commit(s). Resolve conflicts — expected mainly in
   `package-lock.json` and `package.json` `workspaces`. If the lockfile conflict
   is gnarly, regenerate with `npm install` and re-stage.
4. Confirm `git diff main...HEAD` contains **only** `examples/status-message-dapp/**`
   + root `package.json`/`package-lock.json` workspace entries (plus this spec).

## Part B — Make the example build statically against testnet

### B1. Commit the generated contract client
- The contract is already deployed to testnet at
  `CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM`.
- Generate the TS client once from that id (stellar CLI bindings or the scaffold
  `staging` env which binds by id) and commit:
  - `examples/status-message-dapp/src/contracts/status_message.ts`
  - `examples/status-message-dapp/packages/status_message/**`
- Un-ignore those paths in `examples/status-message-dapp/.gitignore` (currently
  `packages/*` except `.gitkeep`, and `src/contracts/*` except `util.ts`).
- The deployed contract id is baked into the committed client, so the build is
  fully deterministic.
- **Risk / dependency:** generating the client once requires the `stellar` CLI +
  testnet read access. If unavailable in the working environment, surface the
  single command for the user to run (or build the wasm and generate from it).

### B2. Base path that works for both dev and Pages
- Keep `base: '/'` (Vite default) for local `npm start` / `npm run dev`.
- Build for Pages with `vite build --base=/g2c/` (flag only in the Pages
  workflow; local build/preview unaffected unless the flag is passed).
- React Router uses `basename={import.meta.env.BASE_URL}` so routes resolve under
  both `/` and `/g2c/` without code branching. (Inspect `main.tsx`/`App.tsx` for
  the actual router; set basename accordingly.)
- `index.html` asset refs (favicon, etc.) use relative or `%BASE_URL%`-style
  paths so they resolve under the subpath.

### B3. Testnet runtime env (build-time, all public)
Baked via the Pages workflow `env:` block (envPrefix `PUBLIC_`):
- `PUBLIC_STELLAR_NETWORK=TESTNET`
- `PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"`
- `PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org`
- `PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org`
- `PUBLIC_G2C_BASE=https://mysoroban.xyz`

Verify how `src/util/contract.ts` / the generated client reads network config so
these env vars actually drive the runtime RPC the app talks to.

### B4. Funding path on testnet
The dev `vite.config.ts` proxies `/friendbot → localhost:8000`. In the built
testnet app, `FundAccountButton` / `src/util/friendbot.ts` must hit the public
`https://friendbot.stellar.org` (or horizon friendbot) rather than the dev
proxy. Confirm and fix if needed so funding works on the live demo.

## Part C — GitHub Pages deploy workflow

New `.github/workflows/pages.yml`:
- **Triggers:** `push` to `main` with paths filter `examples/status-message-dapp/**`
  (and the workflow file itself), plus `workflow_dispatch`.
- **Permissions:** `pages: write`, `id-token: write`, `contents: read`.
- **Concurrency:** group `pages`, cancel-in-progress false.
- **Build job:** checkout → `actions/setup-node@v4` (node 20) → `npm ci` at root →
  build the workspace `@g2c/*` deps the example imports (mirror `deploy.yml`'s
  `tsc -p packages/passkey-sdk/...`; also build `@g2c/stellar-wallets-kit-module`
  — confirm its build script) → `vite build --base=/g2c/` in
  `examples/status-message-dapp` with the Part B3 env →
  `actions/configure-pages@v5` → `actions/upload-pages-artifact@v3` with
  `path: examples/status-message-dapp/dist`.
- **Deploy job:** `actions/deploy-pages@v4` to the `github-pages` environment.
- **Enable Pages** on `theahaco/g2c` with source = GitHub Actions
  (`gh api -X POST repos/theahaco/g2c/pages` / `--method PUT` with
  `build_type=workflow`, or rely on first `deploy-pages` run auto-enabling).
  Admin access confirmed.

## Part D — Nido → example footer link (separate PR off `main`)

- New branch off `main`, separate PR.
- Locate the Nido frontend global footer component in `packages/frontend/src`
  (layout/footer). Add an "Example dApp" link → `https://theahaco.github.io/g2c/`
  (external, `target="_blank" rel="noopener"`).
- Respect the existing 2-error astro-check baseline (add no new errors).

## Verification

**Local (Part B/C):**
- `npm ci` at root; build `@g2c/*` deps; `vite build --base=/g2c/` in the example → succeeds.
- `vitest run` → 2/2 (g2c-first ordering test); `eslint .` clean; `tsc` clean.
- `vite preview --base=/g2c/` → app mounts at `/g2c/`, zero console errors,
  picker opens with **g2c listed first**, read path returns on-chain status from
  testnet (read-only simulation).
- Optional Playwright smoke (repo already has `@playwright/test`).

**Post-deploy:**
- Load `https://theahaco.github.io/g2c/` → app loads, no console errors, read +
  picker + connect-redirect to `mysoroban.xyz` work.
- Passkey *write* round-trip → manual QA (real WebAuthn at `mysoroban.xyz`).

**Part D:**
- `astro build` of the frontend succeeds; footer link renders and navigates to
  the live example.

## Risks

1. **Client generation tooling.** Needs `stellar` CLI + testnet read once. If
   absent, fall back to a user-run command or wasm-based generation. (Build
   itself is unaffected — client is committed.)
2. **Rebase conflicts** in `package-lock.json`/`package.json` — regenerate lock
   if needed.
3. **Base-path leaks** — any hard-coded absolute path (`/assets`, `/foo`) breaks
   under `/g2c/`. Audit during preview.
4. **Network config plumbing** — confirm the committed client + util read the
   `PUBLIC_STELLAR_*` env at runtime so testnet is actually used.
