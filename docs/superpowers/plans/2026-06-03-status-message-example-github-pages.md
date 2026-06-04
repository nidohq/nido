# Status-message example on GitHub Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `examples/status-message-dapp/` scaffold (PR #43) on `main` and deploy it as a live testnet dApp on GitHub Pages at `https://theahaco.github.io/g2c/`, then add a footer link from the Nido wallet frontend to it.

**Architecture:** The example is a stellar-scaffold React+Vite app whose contract TS client is normally generated at build time and gitignored. We bind the already-deployed testnet contract by id, generate the client **once**, and **commit** it so CI can do a pure `npm ci && vite build` with no Rust/scaffold/live-RPC. A new GitHub Actions workflow builds the example with `--base=/g2c/` against testnet env and deploys to the `github-pages` environment. The Nido footer link ships as a separate PR off `main`.

**Tech Stack:** React 19, Vite 7, react-router-dom 7, `@creit.tech/stellar-wallets-kit` v2, `@g2c/stellar-wallets-kit-module`, `@g2c/passkey-sdk`, stellar-scaffold/stellar CLI v26, GitHub Actions Pages, Astro (Nido frontend).

**Key facts established during research:**
- Contract deployed to testnet: `CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM`.
- Network config is read from `import.meta.env.PUBLIC_STELLAR_*` in `examples/status-message-dapp/src/contracts/util.ts` (zod-validated, LOCAL fallback) → build-time env drives the runtime network.
- `src/util/friendbot.ts` already maps `TESTNET → https://friendbot.stellar.org` (no change needed).
- `src/main.tsx` uses `<BrowserRouter>` with **no** basename; `src/components/StatusMessage.tsx` does `import statusMessage from "../contracts/status_message"` (default export = configured client).
- Build chain for the example: `@g2c/passkey-sdk` (tsc) → `@g2c/stellar-wallets-kit-module` (tsc) → generated client → vite. Both `@g2c/*` packages publish `dist/` via `exports`, so they MUST be built before `vite build` can resolve them.
- `packages/frontend/src/layouts/BaseLayout.astro` has no footer.
- `stellar` + `stellar scaffold` CLI v26 available locally; node 22 / npm 10.
- Repo `theahaco/g2c` is **public**, admin access confirmed → free GitHub Pages project site.

---

## Part A — Bring PR #43 onto `main`

### Task A1: Stash the unrelated working-tree WIP

**Files:** none (git state only)

- [ ] **Step 1: Confirm what's dirty**

Run: `git status --short`
Expected: modifications under `contracts/`, `crates/integration-tests/`, `packages/frontend/`, plus untracked `app/`, `g2c.zip`, `crates/.../auth_entry_guards.rs`, `docs/auth-entry-review.html`, `packages/frontend/src/lib/delegationHandover.test.ts`, `.gitignore`, `CLAUDE.md`.

- [ ] **Step 2: Stash everything (tracked + untracked), preserving it for the user**

```bash
git stash push -u -m "wip: auth-entry guards + frontend (NOT for PR #43)"
```

- [ ] **Step 3: Verify clean tree**

Run: `git status --short`
Expected: empty output. (The spec commit `5abd290` remains in history.)

> NOTE: This stash is the user's separate WIP. Do NOT pop it during this work. It is restored later with `git stash pop` by the user, on their own branch.

### Task A2: Retarget PR #43 base to `main` and rebase

**Files:** `package.json`, `package-lock.json` (conflict resolution only)

- [ ] **Step 1: Retarget the PR base**

```bash
gh pr edit 43 --base main
```
Expected: `https://github.com/theahaco/g2c/pull/43` printed.

- [ ] **Step 2: Fetch and rebase onto main**

```bash
git fetch origin main
git rebase origin/main
```
Expected: either clean replay of `d4390b6` (scaffold) + `5abd290` (spec), or a conflict in `package-lock.json`/`package.json`.

- [ ] **Step 3: If a lockfile/package.json conflict occurs, resolve by regenerating**

```bash
# Resolve package.json workspaces by keeping both main's entries and the example entries (manual edit), then:
git checkout --theirs package-lock.json 2>/dev/null || true
npm install            # regenerates package-lock.json against the merged package.json
git add package.json package-lock.json
git rebase --continue
```
Expected: rebase completes. (`--theirs` during rebase = the branch being replayed.)

- [ ] **Step 4: Verify the branch diff vs main is ONLY the example + workspace wiring + spec**

Run: `git diff --stat origin/main...HEAD | tail -5`
Expected: paths limited to `examples/status-message-dapp/**`, `package.json`, `package-lock.json`, and `docs/superpowers/specs/2026-06-03-...md`. No `contracts/`, `crates/`, or `packages/frontend/` paths.

- [ ] **Step 5: Force-push the rebased branch**

```bash
git push --force-with-lease origin feat/status-message-scaffold-template
```

- [ ] **Step 6: Confirm PR is now mergeable**

Run: `gh pr view 43 --json mergeable,baseRefName -q '{base: .baseRefName, mergeable: .mergeable}'`
Expected: `base: main`, `mergeable: MERGEABLE` (may briefly show `UNKNOWN` while GitHub recomputes).

---

## Part B — Make the example build statically against testnet

### Task B1: Generate and commit the contract TS client (bound to the testnet id)

**Files:**
- Modify: `examples/status-message-dapp/environments.toml` (uncomment `staging` id binding)
- Create (generated): `examples/status-message-dapp/packages/status_message/**`, `examples/status-message-dapp/src/contracts/status_message.ts`

- [ ] **Step 1: Bind the deployed contract by id in the `staging` env**

In `examples/status-message-dapp/environments.toml`, under `[staging.contracts]`, replace the commented line with:

```toml
[staging.contracts]
status_message = { id = "CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM" }
```

- [ ] **Step 2: Ensure a testnet identity exists (scaffold needs one in config, even for id-bound read-only gen)**

```bash
stellar keys generate testnet-user --network testnet --fund 2>/dev/null || echo "key already exists"
```

- [ ] **Step 3: Generate the client from the on-chain spec (no Rust build, no deploy)**

```bash
cd examples/status-message-dapp
STELLAR_SCAFFOLD_ENV=staging XDG_CONFIG_HOME=".config" stellar scaffold build --build-clients
```
Expected: `packages/status_message/` and `src/contracts/status_message.ts` created. If scaffold insists on building from source, fall back to direct bindings:
```bash
stellar contract bindings typescript --network testnet \
  --contract-id CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM \
  --output-dir packages/status_message --overwrite
# then hand-author src/contracts/status_message.ts mirroring scaffold's other generated importers
```

- [ ] **Step 4: Inspect + RECORD the generated artifact (feeds the CI build step C1)**

Run:
```bash
cat packages/status_message/package.json | python3 -c "import sys,json;d=json.load(sys.stdin);print('name:',d['name']);print('scripts:',d.get('scripts'));print('main/exports:',d.get('main'),d.get('exports'))"
head -30 src/contracts/status_message.ts
```
Record: the package **name** (e.g. `status_message`) and whether it has a `build` script + a `dist`-pointing `main`/`exports`. These determine whether Task C1 must build this package before `vite build`.

- [ ] **Step 5: Strip generated `node_modules`/`dist` from the package so only source is committed**

```bash
rm -rf packages/status_message/node_modules packages/status_message/dist
```

### Task B2: Un-ignore the committed client paths

**Files:** Modify `examples/status-message-dapp/.gitignore`

- [ ] **Step 1: Replace the two ignore blocks**

Change the `# generated contract clients` block from:
```gitignore
packages/*
# if you have other workspace packages, add them here
!packages/.gitkeep
```
to:
```gitignore
packages/*
# if you have other workspace packages, add them here
!packages/.gitkeep
# Committed for the GitHub Pages build (bound to the deployed testnet id):
!packages/status_message/
!packages/status_message/**
packages/status_message/node_modules/
packages/status_message/dist/
```
And change the `# generated contract client imports` block from:
```gitignore
src/contracts/*
!src/contracts/util.ts
```
to:
```gitignore
src/contracts/*
!src/contracts/util.ts
!src/contracts/status_message.ts
```

- [ ] **Step 2: Verify the generated files are now tracked-eligible**

Run:
```bash
git check-ignore examples/status-message-dapp/src/contracts/status_message.ts examples/status-message-dapp/packages/status_message/package.json; echo "exit: $?"
```
Expected: no output, `exit: 1` (meaning NOT ignored).

### Task B3: Add a router basename so routes work under `/g2c/`

**Files:** Modify `examples/status-message-dapp/src/main.tsx`

- [ ] **Step 1: Pass the Vite base to BrowserRouter**

Change:
```tsx
					<BrowserRouter>
						<App />
					</BrowserRouter>
```
to:
```tsx
					<BrowserRouter basename={import.meta.env.BASE_URL}>
						<App />
					</BrowserRouter>
```
(`import.meta.env.BASE_URL` is `/` in dev and `/g2c/` when built with `--base=/g2c/`; React Router normalizes the trailing slash.)

### Task B4: Make index.html asset paths base-relative

**Files:** Modify `examples/status-message-dapp/index.html`

- [ ] **Step 1: Use `%BASE_URL%` for the favicon**

Change:
```html
		<link rel="icon" type="image/x-icon" href="/favicon.ico" />
```
to:
```html
		<link rel="icon" type="image/x-icon" href="%BASE_URL%favicon.ico" />
```
(Vite rewrites the `<script src="/src/main.tsx">` entry automatically; only the favicon needs the explicit base.)

### Task B5: Verify the exact CI build locally (the gate before committing)

**Files:** none (verification)

- [ ] **Step 1: Install + build workspace deps from repo root**

```bash
cd <repo-root>
npm ci
npm run build -w @g2c/passkey-sdk
npm run build -w @g2c/stellar-wallets-kit-module
# If Task B1/Step 4 showed the client package has a dist-pointing build, also:
# npm run build -w <generated-client-name>
```
Expected: each `tsc` exits 0, `dist/` produced.

- [ ] **Step 2: Build the example with the Pages base + testnet env**

```bash
cd examples/status-message-dapp
PUBLIC_STELLAR_NETWORK=TESTNET \
PUBLIC_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
PUBLIC_STELLAR_RPC_URL="https://soroban-testnet.stellar.org" \
PUBLIC_STELLAR_HORIZON_URL="https://horizon-testnet.stellar.org" \
PUBLIC_G2C_BASE="https://mysoroban.xyz" \
npx vite build --base=/g2c/
```
Expected: build succeeds, `dist/` written.

- [ ] **Step 3: Confirm assets are base-prefixed and no stray absolute `/assets` leaked**

```bash
grep -o '/g2c/[^"]*' dist/index.html | head
grep -rEo '(src|href)="/(assets|favicon)[^"]*"' dist/index.html || echo "no unprefixed absolute asset paths — good"
```
Expected: asset URLs begin `/g2c/`; the second grep prints the "good" message.

- [ ] **Step 4: Smoke the built app**

```bash
npx vite preview --base=/g2c/ --host 0.0.0.0 --port 4173 &
```
Load `http://moss:4173/g2c/` in a browser (or use the `verify`/`run` skill / Playwright). Expected: app mounts at `/g2c/` with zero console errors; wallet picker opens with **g2c listed first**; entering a C-address reads its on-chain status from testnet. Kill the preview after.

- [ ] **Step 5: Unit tests + lint + types still green**

```bash
npm test            # vitest — 2/2 (g2c-first ordering)
npm run typecheck
npm run lint
```
Expected: all pass.

### Task B6: Commit the static-build changes

- [ ] **Step 1: Stage only example paths + the generated client**

```bash
cd <repo-root>
git add examples/status-message-dapp/.gitignore \
        examples/status-message-dapp/environments.toml \
        examples/status-message-dapp/src/main.tsx \
        examples/status-message-dapp/index.html \
        examples/status-message-dapp/src/contracts/status_message.ts \
        examples/status-message-dapp/packages/status_message
git status --short   # confirm nothing outside examples/ is staged
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(example): commit testnet client + base-path for GitHub Pages

Bind status-message by deployed testnet id and commit the generated TS
client so the Pages build needs no Rust/scaffold/live-RPC. Router basename
+ %BASE_URL% favicon let the app serve under /g2c/.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Update the example README's "client is build output" note**

In `examples/status-message-dapp/README.md`, replace the blockquote that says the generated client is **not** committed with a note that, for the live GitHub Pages demo, the client is committed (bound to the deployed testnet id) and that local dev still regenerates it via `npm start`. Commit:
```bash
git add examples/status-message-dapp/README.md
git commit -m "docs(example): note the committed testnet client for Pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part C — GitHub Pages deploy workflow

### Task C1: Add `.github/workflows/pages.yml`

**Files:** Create `.github/workflows/pages.yml`

- [ ] **Step 1: Write the workflow**

```yaml
name: Deploy Example to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - "examples/status-message-dapp/**"
      - ".github/workflows/pages.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

env:
  PUBLIC_STELLAR_NETWORK: TESTNET
  PUBLIC_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015"
  PUBLIC_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org"
  PUBLIC_STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org"
  PUBLIC_G2C_BASE: "https://mysoroban.xyz"

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: npm ci
      - name: Build workspace deps
        run: |
          npm run build -w @g2c/passkey-sdk
          npm run build -w @g2c/stellar-wallets-kit-module
          # If Task B1/Step 4 recorded a dist-built client package, add:
          # npm run build -w <generated-client-name>
      - name: Build example (base=/g2c/)
        run: npx vite build --base=/g2c/
        working-directory: examples/status-message-dapp
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: examples/status-message-dapp/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

> If Task B1/Step 4 recorded that the generated client package needs building, uncomment the `npm run build -w <name>` line with the recorded name before relying on CI.

- [ ] **Step 2: Lint the YAML locally**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/pages.yml')); print('YAML ok')"
```
Expected: `YAML ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy status-message example to GitHub Pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push --force-with-lease origin feat/status-message-scaffold-template
```

### Task C2: Enable GitHub Pages (source = GitHub Actions)

**Files:** none (repo settings via API)

- [ ] **Step 1: Create the Pages site with the workflow build type**

```bash
gh api --method POST repos/theahaco/g2c/pages -f build_type=workflow 2>&1 \
  || gh api --method PUT repos/theahaco/g2c/pages -f build_type=workflow
```
Expected: JSON with `"build_type": "workflow"` (or 409 "already exists" → then the PUT updates it).

- [ ] **Step 2: Confirm**

Run: `gh api repos/theahaco/g2c/pages -q '{url: .html_url, build_type: .build_type}'`
Expected: `build_type: workflow`, `url` ≈ `https://theahaco.github.io/g2c/`.

### Task C3: Merge PR #43 and deploy

**Files:** none

- [ ] **Step 1: Ensure PR checks pass + request review per repo norms, then merge**

```bash
gh pr checks 43
gh pr merge 43 --squash --delete-branch=false   # only after approval / per repo policy
```
> Do NOT self-merge if the repo requires review — surface to the user instead.

- [ ] **Step 2: Watch the Pages workflow run**

```bash
gh run list --workflow pages.yml --limit 1
gh run watch <run-id>
```
Expected: `build` then `deploy` succeed; deploy step outputs the page URL.

### Task C4: Verify the live site

**Files:** none

- [ ] **Step 1: Fetch the live page**

```bash
curl -sSI https://theahaco.github.io/g2c/ | head -5
```
Expected: `HTTP/2 200`.

- [ ] **Step 2: Browser smoke (verify skill / Playwright)**

Load `https://theahaco.github.io/g2c/`. Expected: app mounts, zero console errors, picker shows **g2c first**, reading a C-address returns its testnet status, "Connect" redirects to `mysoroban.xyz`. Passkey **write** → manual QA (real WebAuthn at mysoroban.xyz).

---

## Part D — Nido → example footer link (SEPARATE PR off `main`)

### Task D1: Add a global footer with the example link to BaseLayout

**Files:** Modify `packages/frontend/src/layouts/BaseLayout.astro`

- [ ] **Step 1: New branch off updated main**

```bash
git checkout main && git pull
git checkout -b chore/link-example-dapp
```

- [ ] **Step 2: Add a footer inside `<body>`, after `<slot />`**

Insert before the closing `</body>`:
```html
    <footer class="site-footer">
      <a href="https://theahaco.github.io/g2c/" target="_blank" rel="noopener">
        Example dApp
      </a>
    </footer>
```
And add to the `<style is:global>` block (using existing design tokens from `../styles/global.css` — confirm token names when executing):
```css
  .site-footer {
    text-align: center;
    padding: 1.5rem 1rem;
    font-size: 0.85rem;
  }
  .site-footer a {
    color: inherit;
    opacity: 0.7;
    text-decoration: none;
  }
  .site-footer a:hover {
    opacity: 1;
    text-decoration: underline;
  }
```

> Verify the footer is acceptable on the connect/sign ceremony pages (it sits below content and shouldn't interfere). If the design team prefers it only on the landing page, move the markup there instead — confirm with the user during this PR.

- [ ] **Step 3: Build the frontend and confirm no NEW astro-check errors (baseline is 2)**

```bash
npx astro build --root ./packages/frontend
npx astro check --root ./packages/frontend 2>&1 | tail -3
```
Expected: build succeeds; check shows the same 2 pre-existing errors, no new ones.

- [ ] **Step 4: Visual smoke**

Load a frontend page locally (bind `0.0.0.0`, use `moss` host). Expected: "Example dApp" link renders in the footer and opens `https://theahaco.github.io/g2c/` in a new tab.

- [ ] **Step 5: Commit + PR**

```bash
git add packages/frontend/src/layouts/BaseLayout.astro
git commit -m "feat(frontend): link to the live example dApp in the footer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin chore/link-example-dapp
gh pr create --base main --title "Link to the live example dApp in the footer" \
  --body "Adds a global footer link to the live status-message example at https://theahaco.github.io/g2c/ (deployed from examples/status-message-dapp via the Pages workflow).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review

**Spec coverage:**
- Part A (retarget+rebase, stash WIP) → Tasks A1–A2. ✓
- Part B1 commit client → B1, B2, B6. ✓
- Part B2 base path → B3 (router) + B4 (index.html) + B5/Step2 (`--base`). ✓
- Part B3 testnet env → B5 (local) + C1 `env:` (CI). ✓
- Part B4 friendbot → confirmed already correct in research; no task needed (noted). ✓
- Part C workflow + enable Pages + deploy → C1, C2, C3, C4. ✓
- Part D footer link → D1. ✓
- Verification section → B5, C4, D1/Step3-4. ✓
- Risk #1 (client gen tooling) → B1 has primary + fallback; CLI confirmed present. ✓
- Risk #3 (base-path leaks) → B5/Step3 grep audit. ✓
- Risk #4 (network plumbing) → confirmed via util.ts read; B5/Step4 reads testnet. ✓

**Placeholder scan:** The only deferred value is the generated client package name (Task B1/Step4 records it; C1 + B5 reference it explicitly with the recorded-name instruction). This is inherent to code generation, not a placeholder — the discovery step is concrete.

**Type/name consistency:** `status_message` import path, `PUBLIC_*` env var names, contract id, and branch name `feat/status-message-scaffold-template` are consistent across tasks.
