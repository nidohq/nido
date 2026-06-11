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
- **Classic-to-smart-account onboarding:** The factory contract deterministically
  deploys a smart account from a funded G-address and installs the user's
  passkey as the first signer.
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

## How It Works

1. **Create an account:** The wallet reserves a deterministic C-address for a
   funding G-address.
2. **Create a passkey:** The browser runs a WebAuthn ceremony and extracts the
   user's P-256 public key.
3. **Deploy atomically:** The factory deploys a Soroban smart account, installs
   the passkey signer, and moves funds into the new account.
4. **Sign with intent:** dApps request signatures through Nido, the Stellar
   Wallets Kit module, or direct handoff URLs.
5. **Verify on-chain:** The smart account calls the WebAuthn verifier contract
   during `__check_auth`, then applies context rules and policy checks before
   the transaction executes.

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
| Smart contracts | `contracts/` | Factory, smart account, WebAuthn verifier, name registry, status message, and policy contracts |
| Integration tests | `crates/integration-tests/` | Cross-contract Rust tests with synthetic WebAuthn assertions |
| End-to-end tests | `tests/` | Browser, support, and testnet test harnesses |
| Example dApp | `examples/status-message-dapp/` | React/Vite dApp showing wallet selector integration |

## Smart Contracts

| Contract | Purpose |
| --- | --- |
| Factory | Deploys smart accounts, resolves shared policy/verifier contracts, and computes deterministic C-addresses |
| Smart Account | OpenZeppelin-based account contract with passkey auth, execution entry point, context rules, and policy enforcement |
| WebAuthn Verifier | Stateless P-256/WebAuthn verifier shared by smart accounts |
| Name Registry | Human-readable account name registry |
| Multisig Policy | Threshold-based recovery and delegated policy support |
| Spending Limit Policy | Scoped spending-limit policy for smart-account calls |
| Status Message | Small demo contract used by the example dApp |

All account contracts build on
[OpenZeppelin Stellar Contracts](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account)
and Soroban's native authorization model.

## Quick Start

### Prerequisites

- Node.js 20+
- Rust and Cargo
- [`just`](https://github.com/casey/just)
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli)
- `stellar-scaffold` for scaffold-based contract workflows

Install dependencies from the repo root:

```bash
npm install
```

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
- **Ephemeral G-address funding:** The onboarding G-key is used to fund and
  deploy the smart account, then discarded.
- **Policy enforcement:** Context rules, recovery policies, session keys, and
  spending limits are enforced by the smart account and policy contracts.

For deeper implementation details, read [ARCHITECTURE.md](./ARCHITECTURE.md).

## Documentation

- [Architecture](./ARCHITECTURE.md)
- [Current deployments](./DEPLOYED.md)
- [SCF application notes](./docs/APPLICATION.md)
- [SCF requirements](./docs/REQUIREMENTS.md)
- [Status Message dApp guide](./examples/status-message-dapp/README.md)
- [Wallets Kit module guide](./packages/stellar-wallets-kit-module/README.md)

## License

Apache-2.0
