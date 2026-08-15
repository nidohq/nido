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
- `npm run build:preview` — relative base (`./`), used when nested under a subpath.

This example is hosted **alongside** `status-message-dapp` by the shared example
workflows — no per-example workflow:

- `.github/workflows/pages.yml` — the GitHub Pages home; this example lives at
  `/<repo>/perch-authz-console/` (status-message stays at the root).
- `.github/workflows/example-preview.yml` — the per-PR Cloudflare preview, which
  deploys both examples and comments both URLs.

Add another example by nesting its build in those two workflows the same way.

## Roadmap

The simulator is a faithful TS model. Next, behind the same call: run the real
`soroban-env` in the browser (wasmi) backed by
[rs-soroban-sdk#1657](https://github.com/stellar/rs-soroban-sdk/pull/1657)'s
local-storage cache — lazy testnet pulls, otherwise fully offline.
