# Adsum — a petition + web-of-trust dApp (civic print culture)

A [stellar-scaffold](https://github.com/theahaco/scaffold-stellar) dApp
(React + Vite) demonstrating two independent Soroban contracts behind one
frontend: a public petition wall people sign on-chain, and a web-of-trust
graph people build by vouching for each other. The design direction is
"civic print culture" — broadsides, stamps, and letters, not dashboards; see
`docs/superpowers/specs/2026-07-08-petition-dapp-design.md` for the full
design spec and the Adsum dapp plan it was built from.

- **Petitions** (`petitions` contract): anyone posts a bill (title, body, an
  optional signature goal, an optional ledger-sequence deadline); anyone signs
  it once. No admin, no moderation, no delete.
- **Web of trust** (`web_of_trust` contract): anyone vouches for an address
  directly (typed in, or via a `/vouch?for=` link/QR), or mints a *letter of
  introduction* — a `pre_vouch` keyed by an invite secret's derived pubkey,
  redeemable by whoever holds the `/claim?k=` link, up to a claim limit and
  optional expiry. Vouches are one-directional and public
  (`vouches_given`/`vouches_received`).

Both contracts are read through direct RPC simulation calls
(`src/lib/petitions.ts` / `src/lib/trust.ts`) — there is no indexer.

## Contracts

Deployed to Stellar **testnet**, registered in the shared unverified registry
(`CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S`) alongside the rest
of the repo's contracts. Full deploy history/wasm hashes: `DEPLOYED.md`'s
"Adsum (petition dapp)" section.

| Contract | Testnet id | Registry name |
| --- | --- | --- |
| Petitions | `CAUPKCFWVRFRMZXKVMSSZPN6OURTTDS6TDKS6JGXR5XE3D2BEYGT2QJH` | `unverified/adsum-petitions` |
| Web of Trust | `CDI5YRC4K54QHJW63ONUQPZ6GOAU254GP43OWGCPK3QVPUKPIQIQGIFS` | `unverified/adsum-web-of-trust` |

Both are admin-less: re-deploying means a fresh contract instance plus a
registry repoint (see "Staging-pin refresh" below), never an in-place
upgrade.

## What's inside

| Path | Purpose |
| --- | --- |
| `contracts/petitions/`, `contracts/web-of-trust/` | The two Soroban contracts. Self-contained copies, not re-exports of anything at the repo root. |
| `environments.toml` | `development`/`testing` build + deploy from source (`client = true`); `staging`/`production` bind an already-deployed id (see "Staging-pin refresh"). |
| `packages/petitions/`, `packages/web_of_trust/` | Generated TS contract-client packages (npm workspace members). Only `src/` is committed — see the dev-loop gotcha below about building their `dist/`. |
| `src/contracts/{petitions,web_of_trust}.ts` | Thin `Client` instances pinned to the testnet ids above — the **committed staging clients** that let this example build with plain `npm ci && npm run build` (no Rust, no scaffold, no live deploy). |
| `src/lib/{petitions,trust}.ts` | The data layer pages import — `AssembledTransaction`/`Result` unwrapping, contract-error-code → variant-name mapping, byte caps. |
| `src/lib/claimPayload.ts` | Builds + ed25519-signs the `claim_vouch` payload (see "Claim-payload protocol" below). |
| `src/pages/{Home,Petition,Vouch,Claim,Trust}.tsx` | The five routes: the wall, a petition's proclamation page, the vouch landing, the claim landing, and the trust constellation. |
| `src/components/` | `Broadside`, `StampButton`, `InkProgress`, `SignatureWall`, `ConstellationGraph`, `QrPanel`, `LetterCard` — the civic-print visual system. |

## Prerequisites

- Node 20+. Install from the **repo root** (this example is an npm workspace
  member and consumes the local `@nidohq/*` packages plus its own two
  workspace packages):

  ```bash
  cd <repo-root> && npm install
  ```

## Dev loop

```bash
cd examples/adsum
cp .env.example .env   # first run only
npm start
```

`npm start` runs `stellar scaffold watch --build-clients` next to Vite.
Scaffold builds whichever contracts have `client = true` for the active
`STELLAR_SCAFFOLD_ENV`, deploys them, and (re)generates
`packages/{petitions,web_of_trust}` + `src/contracts/*.ts`. `STELLAR_SCAFFOLD_ENV`
(set in `.env`) selects the `environments.toml` block:

- `development` (default) — local network, auto-started container (needs Docker).
- `testing` — Stellar testnet, builds + deploys from source (needs a funded
  `testnet-user` identity: `stellar keys generate testnet-user --network testnet --fund`).
- `staging` — binds the already-deployed testnet ids above **by id**, no
  build/deploy. This is what the committed clients + the CF Pages / fast-lane
  e2e builds use.
- `production` — mainnet, bind by id (not yet configured — see the commented
  placeholders in `environments.toml`).

### Gotcha #1 — LOCAL `.env` + a `staging` client build crashes at import

`.env.example` defaults `PUBLIC_STELLAR_RPC_URL` to
`http://localhost:8000/rpc` (the local-network default). If you build under
`STELLAR_SCAFFOLD_ENV=staging` (or just run `npm run build`/`vitest` without
ever running `stellar scaffold` at all — exactly what CI and the Cloudflare
Pages deploy do) while `.env` is still on that LOCAL default, the app crashes
**before React even mounts**: the generated `Client` constructor
(`@stellar/stellar-sdk/contract`) builds its `rpc.Server` eagerly at module
scope, and an `http://` url with `allowHttp` unset throws synchronously
(`"Cannot connect to insecure Soroban RPC server if allowHttp isn't set"`).
The fix (already applied): `src/contracts/{petitions,web_of_trust}.ts` and
`src/lib/rpc.ts` derive `allowHttp` from the RPC url's own scheme
(`rpcUrl.startsWith('http://')`) instead of leaving it unset, so the SAME
build works whether `.env` points LOCAL or TESTNET. If you're pointing this
app at testnet, uncomment `.env.example`'s testnet block (or, for a
production-style build, set the four `PUBLIC_STELLAR_*` vars in the shell —
see the CF Pages workflow below).

### Gotcha #2 — `packages/petitions`/`packages/web_of_trust` need a build once

Those two packages' `dist/` is gitignored and **not** part of the root
`postinstall` (`npm run build:packages`, which only covers the repo-root
`@nidohq/*` packages). Under `development`/`testing` (`client = true`),
`npm start`'s scaffold codegen builds them for you. Under `staging` — i.e.
any plain `npm run build` / `npm test` / `npm run typecheck` without scaffold
ever running, which is exactly what CI and the Cloudflare Pages workflow do —
nothing rebuilds them automatically, and you'll see
`Cannot find module 'petitions'` / `'web_of_trust'`. Fix once per fresh
checkout:

```bash
npm run build -w petitions -w web_of_trust   # from the repo root
# or: cd examples/adsum && npm run install:contracts
```

(`.github/workflows/adsum-pages.yml` runs the first form as its own step, for
exactly this reason.)

## Staging-pin refresh procedure

Mirrors `examples/status-message-dapp`'s README, extended to two contracts
instead of one. To ship a new Petitions/Web-of-Trust deploy to the live demo:

```bash
# 1. Build the contract wasms (repo root).
just build-contracts

# 2. Deploy fresh instances + repoint the registry names (admin-less
#    contracts — this is always a fresh deploy, never an upgrade).
DEPLOY_SECRET=$(stellar keys show <alias>) just publish-adsum

# 3. Update the new ids in environments.toml's [staging.contracts], then
#    regenerate the committed clients against them.
STELLAR_SCAFFOLD_ENV=staging stellar scaffold build --build-clients

# 4. Commit the refreshed packages/{petitions,web_of_trust}/ (source) +
#    src/contracts/{petitions,web_of_trust}.ts.
```

**Staleness:** the committed clients are pinned to the ids in
`environments.toml`. If either contract is redeployed with an ABI change, the
live demo silently breaks until the clients are regenerated per above. Spot
drift with
`stellar contract info interface --network testnet --id <id>`. See
`DEPLOYED.md`'s "Re-deploying" section for why deploys go through
`scripts/deploy-adsum.mjs` (JS SDK) rather than `stellar contract deploy`
directly.

## Deploy

`.github/workflows/adsum-pages.yml` deploys `examples/adsum/dist` to
Cloudflare Pages on every push to `main` that touches `examples/adsum/**`
(plus a manual `workflow_dispatch`). It installs root deps, builds the two
contract-client workspace packages (Gotcha #2 above), builds the app with the
same TESTNET env block the fast-lane e2e CI job uses, runs
typecheck/vitest/lint as pre-deploy gates, then
`npx wrangler pages deploy examples/adsum/dist/ --project-name adsum --branch main`
— the same wrangler invocation pattern and `CLOUDFLARE_API_TOKEN`/
`CLOUDFLARE_ACCOUNT_ID` secrets `.github/workflows/deploy.yml` already uses
for the main frontend.

**One-time operator step:** the Cloudflare Pages project named `adsum` must
already exist before this workflow's first run — `wrangler pages deploy`
does not create one. Create it once via the CF dashboard, or
`npx wrangler pages project create adsum`.

## Tests

```bash
npm test          # vitest — component + lib unit tests
npm run typecheck # tsc -b --noEmit
npm run lint      # eslint .
npm run build     # tsc -b && vite build
```

**Fast-lane e2e** (`tests/e2e/ui/adsum.spec.ts`, `@fast`, chain-mocked RPC —
no wallet, no real chain): gated on `examples/adsum/dist` existing.
`playwright.config.ts` only adds the standalone `adsum-server.mjs` webServer
entry (port 4401) when the dist is present, and the spec itself
`test.skip()`s the same way, so a checkout that hasn't built this example
yet skips cleanly instead of failing the whole `@fast` lane.

**Testnet e2e** (`tests/e2e/testnet/adsum.testnet.spec.ts`, `@testnet`,
quarantined, real chain): creates a petition, vouches for a bystander address
via its direct address, signs the petition, then confirms `has_signed` /
`vouches_received` via rpc simulation reads — never assumes a pristine chain
(testnet already has demo data from the deploy above; the spec asserts on the
petition id its own create call returned, not id `0`). Run via
`just test-e2e-adsum-testnet` (mirrors `test-e2e-testnet`'s
`tests/.env.testnet` sourcing, scoped to this one spec file) — see that
spec's own doc comment for the exact env vars its build needs (notably
`PUBLIC_RELAYER_URL`, which `build-astro`/`test-e2e-testnet` don't set, and
`PUBLIC_NIDO_BASE` pointed at the local wallet server rather than the hosted
`nido.fyi`).

## The claim-payload protocol

`web_of_trust.claim_vouch` verifies an ed25519 signature over
`contract.to_xdr || "adsum:claim_vouch" || to.to_xdr` (the invite's derived
pubkey signs; `to` is the claimant, the tx source is whoever's actually
redeeming, never the pre-vouch's creator). This byte layout is a protocol
shared between the Rust contract and this app's TS builder — it is pinned by
a fixture test on **both** sides, and the two must never drift apart without
updating in lockstep:

- Rust: `crates/integration-tests/tests/it/web_of_trust.rs`'s
  `claim_payload_fixture` test (asserts the exact hex against a pinned
  contract id + claimant address).
- TypeScript: `src/lib/claimPayload.test.ts`, exercising
  `src/lib/claimPayload.ts`'s `buildClaimPayload`/`signClaim`.

If these ever disagree, claims built by this dApp fail on-chain
`ed25519_verify` with no other symptom — treat a failing pin on either side
as a stop-ship, not a test to loosen.
