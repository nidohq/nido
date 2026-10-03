# Nido

**Passkey-native smart accounts for Stellar.**

Nido is an open-source account abstraction stack for Stellar: a browser wallet,
Soroban smart contracts, and developer tooling that help users move from
classic Stellar G-addresses to passkey-secured smart accounts (C-addresses).

The goal is simple: make a Stellar smart account feel like a modern app login.
Users create or recover an account with a passkey, dApps can request signatures
through standard wallet flows, and every passkey authorization is verified
on-chain.

> The hosted wallet currently targets Stellar testnet. Do not use it for real
> funds.

## Highlights

- **Passkey-secured C-addresses:** WebAuthn/P-256 signatures are verified by
  Soroban contracts, not by a custodial backend.
- **Smart-account onboarding:** The factory contract deploys a Perch smart
  account at an address fixed by a random setup key, with the user's passkey
  as its admin.
- **Nido wallet app:** An Astro frontend for account creation, account
  management, sending, transaction signing, recovery, and scoped delegation.
- **Developer SDK:** TypeScript helpers for WebAuthn parsing, smart-account
  authorization hashes, signature injection, deployment, recovery, and session
  key workflows.
- **Wallet selector integration:** A Stellar Wallets Kit module lets dApps add
  Nido next to Freighter, xBull, Albedo, and other Stellar wallets.
- **Policy-ready accounts:** Recovery, session keys, spending limits, name
  registry support, and example dApp integrations are included in the repo.

## Live Links

| Link | Purpose |
| --- | --- |
| [nido.fyi](https://nido.fyi) | Hosted testnet wallet |
| [Architecture](./ARCHITECTURE.md) | Detailed system design, data flows, and security model |
| [Deployments](./DEPLOYED.md) | Current testnet contract addresses |
| [Audit scope](./docs/AUDIT_SCOPE.md) | Start of the audit package: scope, threat model, invariants, runbooks |

## How It Works

1. **Create an account:** The wallet makes a random setup key that fixes the
   account's C-address.
2. **Create a passkey:** The browser runs a WebAuthn ceremony on the account's
   own subdomain and extracts the user's P-256 public key.
3. **Deploy:** The factory deploys a [Perch](https://github.com/stellar-registry/perch)
   smart account whose admin is the passkey, and the testnet funding moves in.
4. **Set up recovery:** Friends, a recovery kit (a zero-knowledge proof), or
   both, declared in the account's policy document and installed with one
   `apply_doc`.
5. **Sign with intent:** dApps request signatures through Nido, the Stellar
   Wallets Kit module, or direct handoff URLs.
6. **Verify on-chain:** The account checks the passkey through the WebAuthn
   verifier contract during `__check_auth`, then applies its rules and
   policies before the transaction executes.

This keeps private key material out of the app, binds passkeys to account
subdomains, and gives each account an extensible policy layer for recovery and
limited-scope signing.

## What's Included

| Area | Path | Description |
| --- | --- | --- |
| Wallet frontend | `packages/frontend/` | Astro app for Nido account creation, signing, sending, security, and activity views |
| Passkey SDK | `packages/passkey-sdk/` | WebAuthn, Soroban auth, deployment, storage, policy, recovery, and session-key helpers |
| Wallets Kit module | `packages/stellar-wallets-kit-module/` | `@creit.tech/stellar-wallets-kit` module for dApp wallet selectors |
| Contract bindings | `packages/contract-bindings/` | Generated TypeScript clients for the Soroban contracts |
| Smart contracts | `contracts/` | Factory, name registry, status message, and pre-Perch policy contracts |
| Perch | `vendor/perch/` | Submodule: the account, WebAuthn verifier, recovery controller, ZK pool and adapter, doc compiler, and the testnet deployment manifest Nido builds on |
| Integration tests | `crates/integration-tests/` | Cross-contract Rust tests with synthetic WebAuthn assertions |
| End-to-end tests | `tests/` | Browser, support, and testnet test harnesses |
| Example dApp | `examples/status-message-dapp/` | React/Vite dApp showing wallet selector integration |

## Smart Contracts

| Contract | Purpose |
| --- | --- |
| Factory | Deploys Perch accounts with a passkey admin at deterministic C-addresses |
| Name Registry | Human-readable account name registry |
| Multisig, Spending Limit, Pre-auth Sweep policies | Pre-Perch OZ policies; a Perch document can't attach them |
| Status Message | Small demo contract used by the example dApp |
| Perch account (`vendor/perch`) | The user's account: one policy document, `apply_doc`, seven-day upgrades |
| Perch WebAuthn verifier (`vendor/perch`) | P-256/WebAuthn verifier every passkey names; no admin |
| Perch recovery, ZK pool, ZK adapter (`vendor/perch`) | Guardian, ZK, or combined recovery under the `Loss` or `Protected` profile |

Accounts build on
[OpenZeppelin Stellar Contracts](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account)
through Perch, and Soroban's native authorization model.

## Quick Start

### Prerequisites

- Node.js 20+
- Rust and Cargo
- [`just`](https://github.com/casey/just)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
  and `jq` (for `just perch-infra`)
- `stellar-scaffold` for scaffold-based contract workflows

Fetch the Perch submodule and its build inputs, then install dependencies from
the repo root:

```bash
git submodule update --init
just perch-infra
npm install
```

[docs/RUNBOOKS.md](./docs/RUNBOOKS.md) §1 has the full build and test
sequence, including regenerating the real proof fixtures.

### Common Commands

```bash
just dev              # Build the SDK, then run the Nido frontend locally
just build-astro      # Build the Astro frontend
just build-ts         # Build the passkey SDK
just build-contracts  # Build and optimize Soroban contracts
just test             # Run Rust workspace tests
just check            # cargo fmt --check + clippy
just fmt              # Format Rust code
```

Package-level checks are also available through npm workspaces:

```bash
npm run build -w packages/passkey-sdk
npm test -w packages/passkey-sdk
npm run build -w packages/stellar-wallets-kit-module
npm test -w packages/stellar-wallets-kit-module
npm run test -w packages/frontend
```

## Run the Example dApp

The status-message example demonstrates a third-party dApp connecting through
the Stellar Wallets Kit picker with Nido listed as a wallet option.

```bash
cd examples/status-message-dapp
cp .env.example .env
npm start
```

See [examples/status-message-dapp/README.md](./examples/status-message-dapp/README.md)
for local network, testnet, and GitHub Pages deployment details.

## Security Model

- **No custody:** The wallet does not hold a server-side signing key.
- **On-chain passkey verification:** WebAuthn assertions are checked by the
  verifier contract during Soroban authorization.
- **Per-account origin binding:** Account subdomains scope WebAuthn RP IDs so a
  passkey for one account cannot approve another account.
- **Ephemeral testnet funding:** On testnet, a throwaway G-address funded by
  Friendbot moves its balance into the new account, then is discarded.
- **Policy enforcement:** The account compiles its policy document into
  context rules on chain; rules, caps, and recovery are enforced by the
  account and Perch's policies.
- **Recovery without a custodian:** Friends approve from their own accounts
  and a recovery kit proves knowledge of a secret; a recovery waits out a
  delay the owner can use to cancel it.

For deeper implementation details, read [ARCHITECTURE.md](./ARCHITECTURE.md).

## Documentation

- [Architecture](./ARCHITECTURE.md)
- [Current deployments](./DEPLOYED.md)
- Audit package: [scope](./docs/AUDIT_SCOPE.md), [threat model](./docs/THREAT_MODEL.md),
  [security invariants](./docs/SECURITY_INVARIANTS.md), [supply chain](./docs/SUPPLY_CHAIN.md),
  [runbooks](./docs/RUNBOOKS.md), [mainnet readiness](./docs/MAINNET_READINESS.md)
- [Perch recovery specification](./vendor/perch/docs/recovery/spec.md)
- [SCF application notes](./docs/APPLICATION.md)
- [SCF requirements](./docs/REQUIREMENTS.md)
- [Status Message dApp guide](./examples/status-message-dapp/README.md)
- [Wallets Kit module guide](./packages/stellar-wallets-kit-module/README.md)

## License

Apache-2.0
