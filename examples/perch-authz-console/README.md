# perch × Nido — Authorization Console

A dApp that **logs in a local-key Nido smart account** (no passkey), visualizes
its perch authorization policy, simulates `__check_auth` locally, and lets you
build more complex policies — including a **post-quantum ML-DSA** signer.

Everything is real and local: the account C-address, the signatures, the perch
`doc_hash`, and the allow/deny verdicts all come from
[`@nidohq/testkit`](../../packages/testkit) (nidohq/nido#188). No network, no
contracts deployed.

## Run it

```sh
npm install                 # from the repo root (workspaces)
npm run dev -w perch-authz-console
```

## What it shows

- **Wallet login including Nido** — a `NidoLocalModule` implementing the
  `@creit.tech/stellar-wallets-kit` `ModuleInterface`, so Nido is a wallet any
  kit dApp can connect — here with a **local key** instead of a passkey.
- **Every verifier** — one signer each for **secp256r1** (the real
  `webauthn-verifier`, driven by a local P-256 key), **ed25519**, and
  **ML-DSA-65** (post-quantum). The last two, and perch on-chain, are simulated
  ahead of their contracts (ML-DSA groundwork: nido#143).
- **Reachable calls** — what each key can actually do, derived from the policy.
- **Simulate `__check_auth`** — pick a call + signers → Kleene verdict + trace.
- **Build a policy** — add rules (scope, functions, arg predicates, spend cap);
  the `doc_hash` updates live.
- **Attenuate** — narrow a rule with the fail-closed subset check
  (`reachable(child) ⊆ reachable(parent)`); widening is refused.

## Verify (browser snapshots)

```sh
npx playwright install chromium
npm run test:e2e -w perch-authz-console   # drives the full flow, writes artifacts/*.png
```

## Deploy

- `npm run build` — local/apex build (base `/`).
- `npm run build:pages` — GitHub Pages project build (`--base=/<repo>/`).
- `npm run build:preview` — relative base (`./`), for per-PR subpath previews.

A per-PR GitHub Pages preview workflow is at
`.github/workflows/perch-authz-preview.yml`. It deploys to the `gh-pages` branch
under `pr-preview/pr-<N>/`; enabling it requires the repo's Pages source to
serve that branch (see the workflow header).

## Roadmap

The simulator is a faithful TS model. Next, behind the same call: run the real
`soroban-env` in the browser (wasmi) backed by
[rs-soroban-sdk#1657](https://github.com/stellar/rs-soroban-sdk/pull/1657)'s
local-storage cache — lazy testnet pulls, otherwise fully offline.
