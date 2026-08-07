# Adsum Dapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `examples/adsum/` — the Adsum petition dapp (civic-print-culture design) on the deployed testnet contracts, through to fast-lane e2e coverage and a Cloudflare Pages deploy workflow.

**Architecture:** A stellar-scaffold React/Vite project reusing the status-message-dapp's *plumbing* (scaffold client generation, wallet-kit integration, environments, providers) with an entirely custom UI ("living broadside": petitions as typographic proclamations, ADSUM stamp signing, sealed-letter invites, constellation trust page). Reads are simulation-only via generated clients; writes go through the kit `signTransaction` path with the `submitted: true` sentinel guard. Spec: `docs/superpowers/specs/2026-07-08-petition-dapp-design.md` (read the "Example dapp", "QR vouching", "Pre-vouch invites", and design-direction sections before any UI task).

**Tech Stack:** React 19, Vite 7, strict TS (@theahaco/ts-config), stellar-scaffold, @creit.tech/stellar-wallets-kit v2 (static API) + @nidohq/stellar-wallets-kit-module, @stellar/stellar-sdk ^15, `qrcode`, CSS Modules + custom tokens (NO @stellar/design-system), vitest, Playwright.

## Global Constraints

- Dir: `examples/adsum/` (npm package name `adsum`). Root `package.json` `workspaces` gains `"examples/adsum"` and `"examples/adsum/packages/*"`. Install from repo root.
- Vendored contracts: `examples/adsum/contracts/petitions/` and `examples/adsum/contracts/web-of-trust/` — crate names `petitions` / `web-of-trust` (NO `nido-` prefix; scaffold convention, cf. vendored `status-message`). Sources copied verbatim from `contracts/petitions/` and `contracts/web-of-trust/` (only the `[package] name` and workspace-dep lines change).
- environments.toml contract keys: `petitions`, `web_of_trust`. Staging pins (deployed 2026-07-10, DEPLOYED.md): petitions `CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH`, web_of_trust `CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS`.
- Generated client shims land at `src/contracts/petitions.ts` and `src/contracts/web_of_trust.ts`; the staging-generated packages under `packages/petitions/` and `packages/web_of_trust/` are COMMITTED (`.gitignore` whitelist) so the Pages build needs no Rust.
- Claim-payload protocol (MUST match byte-for-byte): `scval-xdr(contract Address) || utf8("adsum:claim_vouch") || scval-xdr(to Address)`. Cross-language pin — TS test asserts against the Rust-captured fixture (Task 4 carries the exact hex).
- Title cap 100 / body cap 2000 in UTF-8 BYTES (`new TextEncoder().encode(s).length`), matching contract `String::len` semantics.
- Deadline is a ledger sequence; UI converts date ↔ ledger with 5 s/ledger estimate anchored at the current ledger.
- Wallet copy + behavior: NidoModule FIRST in the kit module list; `ACCOUNT_SWITCH_REQUESTED` disconnects; `submitted: true` sentinel short-circuits `signAndSend` broadcast.
- Design direction is binding (spec "Design, however, is NOT the scaffold template"): Fraunces (display/petition text) + Hanken Grotesk (UI) — both already loaded by `index.html`; paper/ink palette, dark mode = ink/paper inversion; no @stellar/design-system. **Every UI task's implementer MUST invoke the `frontend-design:frontend-design` skill before writing components**, and treat visual polish as their canvas WITHIN the locked behavior/test contracts below. Interactions must work with animations disabled (`prefers-reduced-motion`).
- localStorage keys: `adsum:invites` (invite store), `adsum:pendingClaim`, `adsum:pendingVouch` (params preserved across wallet-connect roundtrips).
- All lib code carries colocated vitest tests (`src/**/*.test.ts`); `npm test`, `npm run lint`, `npm run typecheck` green after every task. Commit after every task.
- Tabs, no semicolons (repo TS style, enforced by the copied prettier config).

## File Structure (target)

```
examples/adsum/
  Cargo.toml                      # self-contained workspace (copy pattern)
  environments.toml               # petitions + web_of_trust, staging pinned
  package.json  vite.config.ts  tsconfig*.json  eslint.config.js  .env.example
  index.html                      # fonts kept; title/meta → Adsum
  scripts/build-pages.mjs         # copied (used by CF build for --base)
  contracts/petitions/            # vendored
  contracts/web-of-trust/         # vendored
  packages/                       # committed staging clients
  src/
    main.tsx  App.tsx             # routes: / , /petition/:id , /trust , /vouch , /claim , /debug
    styles/tokens.css  styles/global.css
    components/  (PageShell, Broadside, StampButton, InkProgress, SealBadge,
                  SignatureWall, ConstellationGraph, LetterCard, QrPanel — each + .module.css)
    pages/ (Home, Petition, Trust, Vouch, Claim, Debug)
    providers/ (WalletProvider, NotificationProvider)   # copied
    hooks/ (useWallet, useNotification)                 # copied
    lib/ (petitions.ts, trust.ts, invites.ts, claimPayload.ts, urls.ts,
          ledgerTime.ts, textBytes.ts, sentinel.ts, nidoResolver.ts + tests)
    util/ (wallet.ts, walletModules.ts, moduleOrder.ts, storage.ts)  # copied/adapted
    contracts/ (util.ts + generated shims)
```

---

### Task 1: Scaffold plumbing skeleton

**Files:**
- Create: `examples/adsum/` (structure above, minus custom components/pages/lib — a single placeholder Home page)
- Modify: root `package.json` (workspaces), root `.github/workflows/pages.yml` untouched (Adsum gets its own workflow in Task 10)

**Interfaces:**
- Produces: working `npm start` dev loop generating clients `src/contracts/petitions.ts` + `src/contracts/web_of_trust.ts` (default exports: configured `Client` instances); copied wallet plumbing (`src/util/wallet.ts` exporting `wallet`, `connectWallet`, `nidoBase`; `WalletProvider`/`useWallet`); `src/contracts/util.ts` env exports (`networkPassphrase`, `rpcUrl`, `stellarNetwork`, `labPrefix`).

- [ ] **Step 1: Copy the skeleton**

From `examples/status-message-dapp/` copy INTO `examples/adsum/`: `Cargo.toml`, `rust-toolchain.toml`, `environments.toml`, `.env.example`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.js`, `.prettierrc`/prettier config, `reset.d.ts`, `index.html`, `scripts/build-pages.mjs`, `.gitignore`, and `src/{util,providers,hooks}/` plus `src/contracts/util.ts` and `src/main.tsx`. Do NOT copy: `src/components/`, `src/pages/`, `src/lib/` (except `nidoResolver.ts` + its test → `src/lib/nidoResolver.ts`), `contracts/status-message/`, `packages/`, `docs/`.

- [ ] **Step 2: Vendor the contracts**

Copy `contracts/petitions/` → `examples/adsum/contracts/petitions/` and `contracts/web-of-trust/` → `examples/adsum/contracts/web-of-trust/`. In each vendored `Cargo.toml`: change `name` to `petitions` / `web-of-trust`; replace `soroban-sdk = { workspace = true }` style lines so they resolve against the example's own `[workspace.dependencies]` (the copied example `Cargo.toml` already pins `soroban-sdk = "26.0.1"` and the `soroban-sdk-tools` git rev — keep `{ workspace = true }` since the example workspace defines both). Keep `[package.metadata.stellar] contract = true`. Delete `test_snapshots/` from the vendored copies (unit tests run in the canonical crates; the vendored copies exist for scaffold builds). Confirm `cargo check` inside `examples/adsum/` passes.

- [ ] **Step 3: environments.toml**

Replace the `status_message` entries with both contracts in all four sections, keeping the copied file's network blocks and comments-style:

```toml
[development.contracts]
petitions = { client = true }
web_of_trust = { client = true }
# (same shape under [testing.contracts])

[staging.contracts]
petitions = { id = "CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH" }
web_of_trust = { id = "CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS" }

[production.contracts]
# petitions = { id = "C..." }
# web_of_trust = { id = "C..." }
```

Note: the vendored dir is `contracts/web-of-trust` (kebab) while the toml key is `web_of_trust` (snake) — scaffold maps crate name `web-of-trust` → key `web_of_trust`, exactly as `status-message` → `status_message` in the reference project.

- [ ] **Step 4: package.json**

Base on the copied one: `"name": "adsum"`, keep scripts verbatim, DROP `@stellar/design-system` and `@theahaco/contract-explorer` stays (Debug page uses it), ADD `"qrcode": "^1"` and `"@types/qrcode"` (dev). Keep `@nidohq/passkey-sdk` + `@nidohq/stellar-wallets-kit-module` at `"*"` (workspace links).

- [ ] **Step 5: Register in root workspace**

Root `/home/willem/c/nidohq/nido/package.json`: add `"examples/adsum"` and `"examples/adsum/packages/*"` to `workspaces` (next to the status-message entries).

- [ ] **Step 6: Minimal App shell**

`src/App.tsx`: BrowserRouter (basename `import.meta.env.BASE_URL`) with a single route `/` rendering `<h1>Adsum</h1>` placeholder; `index.html` title → `Adsum — I am present`, strip status-message meta. Keep the fonts `<link>` lines (Fraunces + Hanken Grotesk are the design's typefaces).

- [ ] **Step 7: Verify the dev loop**

```bash
cd /home/willem/c/nidohq/nido && npm install
cd examples/adsum && cp .env.example .env
# point the scaffold at staging so no local network is needed:
#   STELLAR_SCAFFOLD_ENV=staging in .env
STELLAR_SCAFFOLD_ENV=staging SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 \
  npx stellar scaffold build --build-clients
```

Expected: `packages/petitions/` + `packages/web_of_trust/` generated; `src/contracts/petitions.ts` + `web_of_trust.ts` shims created. Then run `scripts/fix-bindings.sh`-equivalent check: if the generated packages pin `@stellar/stellar-sdk` `^14`, edit to `^15.1.0` (same dual-SDK-hoisting hazard the root repo guards against — see `scripts/fix-bindings.sh`). Then `npm run typecheck && npm test && npm run build` — all green (tests: the copied `moduleOrder.test.ts` + `nidoResolver` tests).

- [ ] **Step 8: Commit the generated staging clients**

Adapt the copied `.gitignore` whitelist: `!packages/petitions/`, `!packages/web_of_trust/`, `!src/contracts/petitions.ts`, `!src/contracts/web_of_trust.ts`.

- [ ] **Step 9: Commit**

```bash
git add examples/adsum package.json
git commit -m "feat(adsum): scaffold plumbing, vendored contracts, staging clients"
```

---

### Task 2: Design foundation — tokens, shell, core components

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/global.css`, `src/components/PageShell.tsx` (+module.css), `src/components/Broadside.tsx`, `src/components/StampButton.tsx`, `src/components/InkProgress.tsx`, `src/components/SealBadge.tsx` (each + `.module.css`)
- Modify: `src/main.tsx` (import global styles), `src/App.tsx` (wrap routes in PageShell)

**Interfaces:**
- Produces (locked component contracts — later tasks import these exact names/props):
  - `PageShell({ children })` — header (wordmark "ADSUM", nav: Petitions / Trust / connect-wallet control from `useWallet`), footer, theme respects `prefers-color-scheme` with `data-theme` override toggle.
  - `Broadside({ title, body?, children?, onClick?, as? })` — the document/card primitive.
  - `StampButton({ state, onStamp, label? })` where `state: "ready" | "busy" | "stamped" | "disabled"` — renders the ADSUM stamp; `onStamp` fires once per press; `stamped` shows the impressed seal; MUST be a real `<button>` with `aria-pressed`/`disabled` semantics and work with `prefers-reduced-motion` (no animation, instant state change).
  - `InkProgress({ value, max? })` — filling ink line; when `max` undefined renders an open-ended tally (count only).
  - `SealBadge({ count, tone? })` where `tone: "neutral" | "you" | "kin"` — small ink-mark badge (vouch counts; `you` = vouched by viewer, `kin` = vouched by someone the viewer vouches).

**Design mandate:** invoke the `frontend-design:frontend-design` skill FIRST. Tokens: paper/ink palette (light: warm paper bg, near-black ink; dark: inverted — deep ink bg, paper-toned text), Fraunces for display (`font-family: "Fraunces", serif` with optical sizing), Hanken Grotesk for UI. The exact colors, textures (subtle paper grain OK, no heavy skeuomorphism), stamp visual, and motion curves are the implementer's canvas — the prop contracts and a11y requirements above are not.

- [ ] **Step 1: Write component behavior tests (vitest + @testing-library/react — add `@testing-library/react` + `@testing-library/user-event` devDeps)**

`src/components/StampButton.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { StampButton } from "./StampButton"

describe("StampButton", () => {
	it("fires onStamp once when ready", async () => {
		const onStamp = vi.fn()
		render(<StampButton state="ready" onStamp={onStamp} />)
		await userEvent.click(screen.getByRole("button"))
		expect(onStamp).toHaveBeenCalledTimes(1)
	})
	it("is disabled and inert when disabled or busy", async () => {
		const onStamp = vi.fn()
		const { rerender } = render(<StampButton state="disabled" onStamp={onStamp} />)
		expect(screen.getByRole("button")).toBeDisabled()
		rerender(<StampButton state="busy" onStamp={onStamp} />)
		expect(screen.getByRole("button")).toBeDisabled()
	})
	it("announces stamped state", () => {
		render(<StampButton state="stamped" onStamp={() => {}} />)
		expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
	})
})
```

`src/components/InkProgress.test.tsx`: renders `role="progressbar"` with `aria-valuenow`/`aria-valuemax` when `max` given; count-only text when not. (Write the test analogously — assert the two modes.)

Vitest needs jsdom for these: set `environment: "jsdom"` in `vitest.config.ts` (the copied config runs node; change to jsdom or use per-file `// @vitest-environment jsdom` comments — per-file preferred to keep pure-lib tests on node).

- [ ] **Step 2: Run tests — RED** (`npm test` — components don't exist)

- [ ] **Step 3: Implement tokens + components to the contracts above** (design skill guides visuals; the tests define behavior)

- [ ] **Step 4: Run tests — GREEN**; `npm run lint && npm run typecheck` clean

- [ ] **Step 5: Visual smoke** — `npm run build && npm run preview`, load `/` in a browser (or screenshot via the run skill if available), confirm both themes render. Note findings in the report.

- [ ] **Step 6: Commit** — `git add examples/adsum && git commit -m "feat(adsum): design tokens and core broadside components"`

---

### Task 3: Petitions data layer + time/text helpers

**Files:**
- Create: `src/lib/ledgerTime.ts` (+test), `src/lib/textBytes.ts` (+test), `src/lib/sentinel.ts` (+test), `src/lib/petitions.ts` (+test)

**Interfaces:**
- Consumes: generated client `import petitions from "../contracts/petitions"` (methods: `create_petition({creator,title,body,goal,deadline},{publicKey}) → AssembledTransaction`, `sign({id,signer},{publicKey})`, simulation views `get_petition({id})`, `petition_count()`, `has_signed({id,addr})`, `get_signers({id,start,limit})` — results on `tx.result`); `wallet.signTransaction` from `src/util/wallet.ts`.
- Produces:
  - `utf8ByteLength(s: string): number`; `TITLE_MAX_BYTES = 100`, `BODY_MAX_BYTES = 2000` (exported consts).
  - `ledgerForDate(date: Date, currentLedger: number, now?: Date): number` (5 s/ledger, rounds up); `dateForLedger(ledger: number, currentLedger: number, now?: Date): Date`; `formatLedgerCountdown(deadline: number, currentLedger: number): string` (humanized, e.g. "closes in ~3 days"; "closed" when past).
  - `signAndSendWithSentinel(tx: AssembledTransaction, signTransaction): Promise<{ hash?: string; submittedByWallet: boolean }>` — wraps `tx.signAndSend({ signTransaction })`, catching the sentinel path: if the wallet's `signTransaction` result carries `submitted: true`, short-circuit and report `submittedByWallet: true` (port the mechanism from `examples/status-message-dapp/src/components/StatusMessage.tsx` `save()` — read it first; reuse its AlreadySubmittedError trick verbatim).
  - `fetchPetitions(count: number, pageSize?: number): Promise<PetitionView[]>` (id-descending — newest first); `fetchPetition(id): Promise<PetitionView | null>`; `fetchSigners(id, start, limit): Promise<string[]>`; `hasSigned(id, addr): Promise<boolean>`; `fetchPetitionCount(): Promise<number>`; `createPetition(fields, address): Promise<{id?: number} & SendResult>`; `signPetition(id, address): Promise<SendResult>`. `PetitionView = { id, creator, title, body, goal: number | null, deadline: number | null, sigCount, createdLedger }`.

- [ ] **Step 1: Tests for the pure helpers** (complete code):

`src/lib/textBytes.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { BODY_MAX_BYTES, TITLE_MAX_BYTES, utf8ByteLength } from "./textBytes"

describe("utf8ByteLength", () => {
	it("counts ascii 1:1", () => expect(utf8ByteLength("abc")).toBe(3))
	it("counts multibyte by bytes", () => expect(utf8ByteLength("héllo")).toBe(6))
	it("counts emoji as 4", () => expect(utf8ByteLength("🖋")).toBe(4))
	it("exports contract caps", () => {
		expect(TITLE_MAX_BYTES).toBe(100)
		expect(BODY_MAX_BYTES).toBe(2000)
	})
})
```

`src/lib/ledgerTime.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { dateForLedger, formatLedgerCountdown, ledgerForDate } from "./ledgerTime"

const now = new Date("2026-07-10T00:00:00Z")

describe("ledgerTime", () => {
	it("converts a future date to a ledger (5s per ledger, rounded up)", () => {
		const in1h = new Date(now.getTime() + 3600_000)
		expect(ledgerForDate(in1h, 1000, now)).toBe(1000 + 720)
	})
	it("roundtrips approximately", () => {
		const d = dateForLedger(1720, 1000, now)
		expect(d.getTime()).toBe(now.getTime() + 720 * 5000)
	})
	it("humanizes", () => {
		expect(formatLedgerCountdown(1000 + 17280, 1000)).toMatch(/day/)
		expect(formatLedgerCountdown(999, 1000)).toBe("closed")
	})
})
```

- [ ] **Step 2: RED**, **Step 3: implement helpers**, **Step 4: GREEN**.

- [ ] **Step 5: Client wrapper + sentinel.** Implement `petitions.ts` and `sentinel.ts` per the Produces contracts. `sentinel.ts` gets a unit test with a fake `tx` object: a `signAndSend` that invokes the provided callback with a canned wallet result `{ signedTxXdr: "hash-abc", submitted: true }` must resolve `{ submittedByWallet: true }` without calling broadcast (assert via spy that the fake's post-sign submit path was aborted — mirror how the reference implementation throws/catches its sentinel). `petitions.ts` fetch fns get a unit test with a mocked client module (vi.mock the shim: `get_petition` returning a canned `tx.result`) asserting `PetitionView` mapping (Option → null, id order descending in `fetchPetitions`).

- [ ] **Step 6: GREEN + lint + typecheck.** **Step 7: Commit** — `feat(adsum): petitions data layer, ledger-time and byte-cap helpers`

---

### Task 4: Trust data layer, invites, claim payload (cross-language pin)

**Files:**
- Create: `src/lib/claimPayload.ts` (+test), `src/lib/urls.ts` (+test), `src/lib/invites.ts` (+test), `src/lib/trust.ts` (+test)

**Interfaces:**
- Consumes: generated client `import webOfTrust from "../contracts/web_of_trust"` (methods `vouch`, `revoke`, `pre_vouch`, `claim_vouch`, views `vouches_given({a})`, `vouches_received({a})`, `has_vouched({from,to})`, `get_pre_vouch({key})`); `Keypair`, `Address`, `xdr`, `StrKey` from `@stellar/stellar-sdk`; `signAndSendWithSentinel` (Task 3).
- Produces:
  - `buildClaimPayload(contractId: string, to: string): Uint8Array` — THE protocol bytes.
  - `signClaim(secretSeedHex: string, contractId: string, to: string): { key: Uint8Array; sig: Uint8Array }` (ed25519 via `Keypair.fromRawEd25519Seed`; `key` = raw public key 32B, `sig` = 64B over the payload).
  - `newInviteSecret(): { seedHex: string; pubkeyHex: string }`.
  - `buildVouchUrl(origin: string, address: string): string` (`/vouch?for=<addr>`); `parseVouchParam(search: string): string | null` (strkey-validated G/C, else null); `buildClaimUrl(origin: string, seedHex: string): string` (`/claim?k=<seedHex>`); `parseClaimParam(search: string): { seedHex: string; pubkeyHex: string } | null` (64 hex chars, derivable pubkey).
  - `inviteStore`: `list(): StoredInvite[]`, `add(inv)`, `remove(pubkeyHex)` over localStorage `adsum:invites`; `StoredInvite = { seedHex, pubkeyHex, label, createdAt }`.
  - `trust.ts`: `fetchVouchesGiven(a)`, `fetchVouchesReceived(a)`, `hasVouched(from,to)`, `fetchPreVouch(pubkeyHex): Promise<{from,expires,maxClaims,claims} | null>`, mutations `vouchFor(from,to)`, `revokeVouch(from,to)`, `createPreVouch(from,pubkeyHex,expires,maxClaims)`, `claimVouch(seedHex,to)` (builds sig, submits `claim_vouch` — claimant's wallet is the tx source).

- [ ] **Step 1: THE parity test** (this is the task's reason to exist — complete code, do not alter the hex):

`src/lib/claimPayload.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { buildClaimPayload } from "./claimPayload"

// Pinned by crates/integration-tests/tests/it/web_of_trust.rs
// (claim_payload_fixture). The Rust contract, the Rust test, and this TS
// builder are one protocol: if this test fails, the dapp cannot produce
// valid claims. Never edit the hex here without editing the Rust pin.
const FIXTURE_CONTRACT = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S"
const FIXTURE_CLAIMANT = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2"
const CLAIM_PAYLOAD_FIXTURE_HEX =
	"0000001200000001c2bfb1aefd11d7000817bf445950e3f72f46b091450bd0f4b7a6e28af2c45ed3616473756d3a636c61696d5f766f75636800000012000000000000000017cd4681baa12ac9360dcb3087862a98f85c1b9393533fd464533d48c4447db4"

const toHex = (b: Uint8Array) =>
	Array.from(b)
		.map((x) => x.toString(16).padStart(2, "0"))
		.join("")

describe("buildClaimPayload", () => {
	it("reproduces the Rust-pinned protocol bytes exactly", () => {
		expect(toHex(buildClaimPayload(FIXTURE_CONTRACT, FIXTURE_CLAIMANT))).toBe(
			CLAIM_PAYLOAD_FIXTURE_HEX,
		)
	})
})
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement `claimPayload.ts`:**

```ts
import { Address } from "@stellar/stellar-sdk"

const DOMAIN = new TextEncoder().encode("adsum:claim_vouch")

/** contract.to_xdr || "adsum:claim_vouch" || to.to_xdr — the exact bytes
 * `claim_vouch` verifies. Mirrors contracts/web-of-trust claim_payload_for. */
export function buildClaimPayload(contractId: string, to: string): Uint8Array {
	const seg = (addr: string) => new Uint8Array(Address.fromString(addr).toScVal().toXDR())
	const a = seg(contractId)
	const b = seg(to)
	const out = new Uint8Array(a.length + DOMAIN.length + b.length)
	out.set(a, 0)
	out.set(DOMAIN, a.length)
	out.set(b, a.length + DOMAIN.length)
	return out
}
```

(If `toXDR()` returns a Node Buffer, `new Uint8Array(buf)` normalizes it — the test's hex compare is the arbiter.)

- [ ] **Step 4: GREEN — the fixture must pass byte-for-byte.** If it does not, do NOT massage the TS to fit by trial: diff the hex prefix against the fixture (first divergent byte) and re-check the segment encoding (`toScVal().toXDR()` vs some other serialization). BLOCKED with the divergence analysis if still failing.

- [ ] **Step 5: urls/invites/trust + tests.** `urls.test.ts`: valid G and C addresses roundtrip; junk (`"hello"`, truncated strkey, empty, missing param) → null; claim param: 64-hex roundtrips, odd-length/non-hex → null. `invites.test.ts`: add/list/remove roundtrip against a stubbed localStorage. `signClaim` test: signature verifies with `Keypair`'s `verify` against the payload (self-consistency), and `newInviteSecret` derives a pubkey that `signClaim` reproduces. `trust.ts` mapping test with vi.mocked client (Option handling, expires/claims number mapping).

- [ ] **Step 6: GREEN + lint + typecheck. Step 7: Commit** — `feat(adsum): trust data layer, invites, pinned claim-payload builder`

---

### Task 5: Home — poster wall + create flow

**Files:**
- Create: `src/pages/Home.tsx` (+module.css), `src/components/CreatePetition.tsx` (+module.css + test)
- Modify: `src/App.tsx` (route `/`)

**Interfaces:**
- Consumes: `fetchPetitions`, `fetchPetitionCount`, `createPetition`, `utf8ByteLength`/caps, `ledgerForDate`, `formatLedgerCountdown`, `Broadside`, `InkProgress`, `useWallet`, `useNotification`.
- Produces: route `/`; `CreatePetition({ onCreated })` form component.

**Behavior contract (tests lock these):**
- Poster wall lists petitions newest-first as `Broadside` cards: title (Fraunces), body excerpt, `InkProgress value={sigCount} max={goal ?? undefined}`, humanized deadline or "open-ended", click → `/petition/:id`.
- Create form: title/body with live BYTE counters (`87/100`), disabled submit when over cap or empty; optional goal (positive int); optional deadline date → `ledgerForDate` conversion shown as "≈ ledger N"; requires connected wallet (else the submit is a connect prompt); on success navigates to the new petition.
- Empty state (0 petitions) is designed, not blank: an invitation to author the first broadside.

- [ ] **Step 1: `CreatePetition.test.tsx`** — jsdom test asserting: byte counter text for a multibyte title ("héllo" → `6/100`), submit disabled when title bytes > 100 (`"a".repeat(101)`), goal rejects `0`, and `createPetition` (vi.mocked module) called with `deadline: null` when date empty. (Write the complete test in this style; mock `../lib/petitions` and `useWallet` to a connected address.)
- [ ] **Step 2: RED. Step 3: implement page + form (frontend-design skill first; visuals = canvas). Step 4: GREEN + lint + typecheck.**
- [ ] **Step 5: Visual smoke both themes (build + preview). Step 6: Commit** — `feat(adsum): poster-wall home and create-petition flow`

---

### Task 6: Petition detail — proclamation, stamp, signature wall

**Files:**
- Create: `src/pages/Petition.tsx` (+module.css), `src/components/SignatureWall.tsx` (+module.css + test)
- Modify: `src/App.tsx` (route `/petition/:id`)

**Interfaces:**
- Consumes: `fetchPetition`, `fetchSigners`, `hasSigned`, `signPetition`, `fetchVouchesReceived`, `fetchVouchesGiven`, `StampButton`, `InkProgress`, `SealBadge`, `nidoResolver` (reverse name lookup), `formatLedgerCountdown`.
- Produces: route `/petition/:id`; `SignatureWall({ petitionId, viewer })` — paginated signer list ("Load more" pages of 30 via `get_signers`), each entry: resolved nido name or truncated address, `SealBadge count={vouchesReceived.length} tone={...}` where tone `you` if viewer ∈ signer's received, `kin` if intersection(signer's received, viewer's given) nonempty, else `neutral`. Badge data fetched per visible page, cached in a module-level Map for the session.

**Behavior contract:**
- Stamp states: `disabled` (expired / not connected — with reason text), `ready` (connected, unsigned), `busy` (tx in flight), `stamped` (has signed — persists on reload via `hasSigned`).
- After a successful stamp: sigCount increments locally, viewer's name enters the wall top, stamped state sticks.
- Document layout: title + body as the proclamation (Fraunces, generous measure), meta line (creator, created ledger date-ish, deadline countdown), `InkProgress` beneath, signature wall last.

- [ ] **Step 1: `SignatureWall.test.tsx`** — vi.mock trust + petitions libs: renders 2 pages on "Load more" (mock `fetchSigners` returning 30 then 5), badge tones computed (viewer vouches signer-A → `you`; viewer's given ∩ signer-B's received nonempty → `kin`), addresses truncated when resolver returns null. Complete test code in the Task-5 style.
- [ ] **Step 2: RED. Step 3: implement (frontend-design skill; stamp moment is THE interaction — make it land, respecting reduced-motion). Step 4: GREEN + lint + typecheck. Step 5: visual smoke. Step 6: Commit** — `feat(adsum): proclamation page with ADSUM stamp and signature wall`

---

### Task 7: Trust page — constellation, vouching, letters of introduction

**Files:**
- Create: `src/pages/Trust.tsx` (+module.css), `src/components/ConstellationGraph.tsx` (+module.css + test), `src/components/LetterCard.tsx` (+module.css), `src/components/QrPanel.tsx` (+test)
- Modify: `src/App.tsx` (route `/trust`)

**Interfaces:**
- Consumes: trust lib (Task 4), invites lib, `qrcode` (`QRCode.toDataURL`), `nidoResolver`, `buildVouchUrl`/`buildClaimUrl`, `SealBadge`.
- Produces: route `/trust`; `ConstellationGraph({ center, given, received, names })` — pure-SVG 1-hop ego graph: center node = viewer, ring of neighbor nodes, directed edges (given = outbound stroke, received = inbound, mutual = doubled), labels = resolved names/truncated addresses; deterministic radial layout (angle = index/total · 2π — no physics, no graph library); `QrPanel({ value, caption })` — renders QR data-URL img with the value as caption/copy button.

**Behavior contract:**
- "My QR" section: `QrPanel value={buildVouchUrl(origin, address)}` — anyone scanning vouches for ME.
- Vouch form: accepts G/C address or nido name (resolve first; unresolvable → error), self-vouch pre-blocked client-side, submits `vouchFor`, updates graph.
- Given list with revoke buttons (`revokeVouch`).
- Letters drawer: create invite (label, uses default 1, expiry default 30 days → `ledgerForDate`-style conversion 518400 ledgers), flow = generate secret → `createPreVouch` tx → on success `inviteStore.add` → LetterCard shows sealed-letter with `QrPanel value={buildClaimUrl(...)}`, terms text ("x of y claimed · expires ~date"), live claims via `fetchPreVouch`, revoke via `revoke_pre_vouch` + `inviteStore.remove`. Warning copy verbatim: "The QR is the vouch — anyone who scans it can claim one of its uses."

- [ ] **Step 1: `ConstellationGraph.test.tsx`** — renders center + N neighbors as SVG circles (query by role/testid), mutual edge gets the mutual class, empty graph renders the empty-state text. `QrPanel.test.tsx` — renders an `img` whose src is a data URL (mock `qrcode`'s `toDataURL` to resolve `"data:image/png;base64,x"`). Complete code, Task-5 style.
- [ ] **Step 2: RED. Step 3: implement (frontend-design skill; wax-seal/letter visual = canvas). Step 4: GREEN + lint + typecheck. Step 5: visual smoke. Step 6: Commit** — `feat(adsum): trust constellation, vouching, letter-of-introduction invites`

---

### Task 8: /vouch and /claim routes

**Files:**
- Create: `src/pages/Vouch.tsx` (+module.css + test), `src/pages/Claim.tsx` (+module.css + test)
- Modify: `src/App.tsx` (routes), `src/util/wallet.ts` only if the connect-roundtrip persistence hook needs an export it lacks (note it in the report if so)

**Interfaces:**
- Consumes: `parseVouchParam`/`parseClaimParam`, trust lib, `nidoResolver`, localStorage keys `adsum:pendingVouch` / `adsum:pendingClaim`, `useWallet`.

**Behavior contract (anti-spoof rules are binding):**
- `/vouch?for=<addr>`: invalid/missing param → designed error state. Valid → confirmation card showing ONLY on-chain-resolved identity (name via resolver + full address; the URL never carries a display name). Not connected → param saved to `adsum:pendingVouch`, connect CTA; on connect, flow resumes. Connected → vouch button (self-vouch → explanatory disabled state; already-vouched → "already vouched" state); success → link to /trust.
- `/claim?k=<secret>`: invalid param → error state. Valid → derive pubkey, `fetchPreVouch`: null → "expired or exhausted" state; live → letter view: "<resolved name> has vouched for you" + terms. Not connected → secret to `adsum:pendingClaim` + onboarding CTA (wallet selector — creating a Nido account happens in the wallet flow). Connected → claim button → `claimVouch(seedHex, address)`; success clears pending + celebratory stamped state; `AlreadyVouched` contract error surfaced as "you already hold this vouch".
- Both routes MUST parse params before wallet init (QR scans land logged-out).

- [ ] **Step 1: Route tests** — `Vouch.test.tsx`: junk param renders error state; valid param + disconnected renders connect CTA and writes `adsum:pendingVouch`; valid + connected shows resolved name (mock resolver) and fires `vouchFor` on confirm. `Claim.test.tsx`: valid secret + live invite renders "<name> has vouched for you" (mock `fetchPreVouch` + resolver); exhausted (null) renders the exhausted state; connected claim click calls `claimVouch` with the seed + viewer address. Complete code, mocking pattern as Task 5.
- [ ] **Step 2: RED. Step 3: implement. Step 4: GREEN + lint + typecheck. Step 5: visual smoke. Step 6: Commit** — `feat(adsum): vouch and claim QR landing routes`

---

### Task 9: Fast-lane e2e + chain mock

**Files:**
- Create: `tests/support/adsumChainMock.ts`, `tests/support/adsum-server.mjs`, `tests/e2e/ui/adsum.spec.ts` (repo root `tests/`, NOT inside the example)
- Modify: none (fast lane auto-picks `tests/e2e/ui/*.spec.ts` files tagged `@fast`)

**Interfaces:**
- Consumes: the pattern in `tests/support/zkChainMock.ts` (READ IT FIRST — route-interception answering real `@stellar/stellar-sdk`-encoded XDR, dispatched by contract id + function) and `tests/support/example-server.mjs` (serves an example's `dist/` on its own port/origin — 4400).
- Produces: `adsumChainMock(page, { petitions: PetitionSeed[], vouches, preVouches })` — intercepts the staging RPC host and answers `simulateTransaction` for `petition_count`/`get_petition`/`get_signers`/`has_signed`/`vouches_received`/`vouches_given`/`get_pre_vouch` from the seed data (encode return values with the SDK's `nativeToScVal`/`scValToXdr` — mirror zkChainMock's encoding helpers); `adsum-server.mjs` serving `examples/adsum/dist` on port 4401.

**Test contract (each `@fast`-tagged):**
1. Home renders 3 seeded petitions newest-first with counts.
2. `/petition/0` renders body, sigCount, and the stamp in `disabled` (not connected) state.
3. `/vouch?for=<seeded C-addr>` renders the confirmation card with the seeded reverse-resolved name mock; junk param renders error state.
4. `/claim?k=<seed of seeded preVouch>` renders "<from> has vouched for you" with terms; unknown key renders exhausted state.

- [ ] **Step 1: read zkChainMock.ts + example-server.mjs; build the mock + server.**
- [ ] **Step 2: build the example (`npm run build` with staging clients), run the spec: `npx playwright test tests/e2e/ui/adsum.spec.ts --project=chromium`. All 4 green.** Iterate.
- [ ] **Step 3: full fast lane still green: `npx playwright test --grep @fast --project=chromium`.**
- [ ] **Step 4: Commit** — `test(adsum): fast-lane e2e with chain-mocked RPC`

---

### Task 10: Testnet e2e, CF Pages workflow, README

**Files:**
- Create: `tests/e2e/testnet/adsum.testnet.spec.ts`, `.github/workflows/adsum-pages.yml`, `examples/adsum/README.md`
- Modify: `justfile` (recipe `test-e2e-adsum-testnet` mirroring `test-e2e-testnet`'s env sourcing)

**Interfaces:**
- Consumes: `tests/e2e/testnet/example-dapp.testnet.spec.ts` as the model (READ FIRST — wallet account creation, dapp connect, on-chain verification via rpc simulate readers); repo CF secrets already used by `deploy.yml` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — confirm exact names in `.github/workflows/deploy.yml` before writing the workflow).

**Content:**
- Testnet spec (`@testnet`-tagged, quarantined, retries 2): create petition → vouch A→B via direct address → sign petition → assert `has_signed` + `vouches_received` via rpc simulation readers. Uses the existing testnet account fixtures (`tests/.env.testnet` recipe).
- `adsum-pages.yml`: path-filtered `examples/adsum/**`, on push to main: npm ci (root), `npm run typecheck && npm test && npm run build` in `examples/adsum` (staging clients committed → no Rust), deploy `examples/adsum/dist` via `cloudflare/wrangler-action` `pages deploy` to project `adsum`. Also a manual `workflow_dispatch` trigger.
- README: what Adsum is, dev loop (`npm start` with `STELLAR_SCAFFOLD_ENV`), staging pins + refresh procedure (mirror status-message-dapp README's), deploy story, and the claim-payload protocol note pointing at both pinned fixtures (Rust + TS).

- [ ] **Step 1: testnet spec (model: example-dapp.testnet.spec.ts). Run once locally if `tests/.env.testnet` exists; otherwise verify it compiles + is quarantined (not matched by `--grep @fast`), and note the skip in the report.**
- [ ] **Step 2: workflow + README.** Validate workflow YAML (`npx yaml-lint` or a YAML parse in node). Do NOT enable the CF project here — first deploy happens when the workflow runs on main (or via `workflow_dispatch` after merge); note that the `adsum` Pages project must exist in CF (one-time dashboard/wrangler step for the operator).
- [ ] **Step 3: Commit** — `feat(adsum): testnet e2e, Cloudflare Pages workflow, README`

---

## Self-Review Notes (author-run)

- Spec coverage: all four pages + Debug route (Debug comes free in Task 1's copied pattern — VERIFY: keep `/debug` with contract-explorer over both shims; if the copied Debug page assumes design-system styles, strip to functional), QR vouching, pre-vouch invites incl. localStorage-only secrets + claims counters, anti-spoof rules, byte caps, sentinel guard, staging clients committed, CF Pages, both e2e tiers. Design direction embedded as binding constraints + per-task canvas notes.
- Deliberate scope notes: session-passkey/relayer in-page signing stays OUT (spec defers it); no indexer (simulation reads only); `extend_ttl`/`extend_signatures_ttl` keep-alives are NOT surfaced in v1 UI (ops concern; Debug page can invoke them).
- Type consistency: component props and lib signatures declared once in Interfaces blocks and reused by name across tasks 5-8; the fixture hex here matches `crates/integration-tests/tests/it/web_of_trust.rs` exactly.
- UI code in tasks 5-8 is deliberately contract-locked but visually open (design-freedom mandate); every UI task requires the frontend-design skill invocation — this is the sanctioned deviation from "complete code in every step" for pixel-level work, with behavior pinned by complete test code instead.
