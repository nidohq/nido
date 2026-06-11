# Smart Accounts on Stellar — the Nido engineering series

A developer-facing blog series that doubles as documentation for how
[Nido](https://nido.fyi) (the **g2c** project) builds a **passkey wallet with no
seed phrase** on Stellar/Soroban — entirely on top of
[OpenZeppelin's `stellar-accounts`](https://github.com/OpenZeppelin/stellar-contracts)
smart-account standard.

The series goes from *the standard, explained* to *every byte of how we use it*.
Posts are code-forward and aimed at Soroban builders: concepts first, then the
real Rust and TypeScript that implements them. All code is pinned to
`stellar-accounts @ 637c53a` on **soroban-sdk 26**.

## Roadmap

| # | Post | Status | What it covers |
|---|------|--------|----------------|
| 1 | [Smart Accounts on Stellar: How OpenZeppelin's Standard Works](./01-stellar-smart-accounts-oz-standard.md) | ✅ Published | Soroban's `CustomAccountInterface` / `__check_auth`; the three-layer model — **signers, context rules, policies**; the `do_check_auth` algorithm and its security properties. |
| 2 | [How Nido Uses OpenZeppelin Smart Accounts](./02-how-g2c-uses-oz-smart-accounts.md) | ✅ Published | The three thin contracts, the single-transaction factory + deterministic addresses, and the browser SDK that turns a Face ID tap into a Soroban `AuthPayload`. Plus browserless passkey testing, scoped session keys, and recovery. |
| 3 | [Passkeys & On-Chain WebAuthn: a Byte-by-Byte Deep Dive](./03-passkeys-and-on-chain-webauthn.md) | ✅ Published | The WebAuthn assertion byte-by-byte: `authenticatorData` flags, `clientDataJSON`, the `sha256(authData ‖ sha256(clientData))` digest, secp256r1, the format translation (SPKI/COSE/DER → SEC1/compact), and why on-chain verification is trustless. |
| 4 | [Scoped Sessions & Custom Policies](./04-scoped-sessions-and-custom-policies.md) | ✅ Published | Scoped session keys, writing your own `Policy` (spending limits, allow-lists), composing policies on a rule, and the threshold-divergence footgun in practice. |
| 5 | [Social Recovery](./05-social-recovery.md) | ✅ Published | `Signer::Delegated` friends, the nested-auth flow, byte-identical digests across parties, and the `CallContract(self)` scope that lets friends rebuild you without robbing you. |

## How to read this

- **Start with Part 1** if you're new to Soroban smart accounts — Part 2 assumes
  the model (signers / context rules / policies / `AuthPayload`).
- Already shipped a Soroban contract and just want the integration? Skim Part 1's
  diagrams, then read **Part 2**.
- Every code excerpt cites its source file. To run it locally:
  ```bash
  just build-contracts && just test
  # a single passkey-auth test:
  cargo test -p g2c-integration-tests smart_account_check_auth_with_passkey
  ```

## Related repo docs

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — full technical architecture and data flows
- [`DEPLOYED.md`](../../DEPLOYED.md) — current testnet contract addresses
- [`README.md`](../../README.md) — project overview
- [OpenZeppelin Stellar smart-account docs](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account)
