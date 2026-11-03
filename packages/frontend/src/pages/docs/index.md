---
layout: ../../layouts/DocsLayout.astro
title: Build with Nido
description: Nido gives the people using your Stellar app a smart account they unlock with a passkey. These pages explain how your app works with that account, for developers and for the AI coding agents working with them.
---

## What Nido is, for an app

A Nido account is a Soroban smart account: a contract with a C-address, not a
classic G-address keypair. Its owner unlocks it with a passkey (Face ID, Touch
ID, a security key), so there is no seed phrase and no browser extension.
Nido's relayer pays to create the account. In this testnet tutorial, a new
account arrives with 5 test XLM.

Your contract doesn't need to know any of this. It calls
`user.require_auth()` as usual, and the account decides whether to authorize.

The one thing that changes for your app is how it gets a signature. Nido's
passkey popup only signs calls on the account itself. To call your contract,
the owner approves a **session** once: rules that let your app's own passkey
call the functions you name, on the contracts you name, until an expiry, and
optionally under a spending cap. After that the device asks for the app's
passkey on each call, and the account checks every call against the rules.
Nido's relayer submits the call and pays its fee.

> These guides and the app template use Stellar **testnet**, at
> [test.nido.fyi](https://test.nido.fyi). Nido also has a mainnet deployment at
> [nido.fyi](https://nido.fyi); the tutorial's funding, contracts and fee
> measurements are for testnet. Use throwaway testnet accounts for the examples.

## Start here

The fastest working path is the
[Nido app template](https://github.com/nidohq/scaffold-template), a
[Scaffold Stellar](https://github.com/stellar-scaffold/cli) React app with Nido
in the wallet picker and the session flow already built:

```sh
stellar scaffold init --template nidohq/scaffold-template my-app
```

Then follow [Getting started](/docs/getting-started/). Today the template is
the only published path from a Nido account into your own contract, because
the session flow lives in its `app-lib/session.ts` rather than in a Nido SDK.

## The pages

- [Getting started](/docs/getting-started/): from `init` to a passkey account
  and a first call signed with your app's passkey.
- [Concepts](/docs/concepts/): smart accounts and passkeys, sessions, grants and
  spending caps, expiry, and who pays for what.
- [Request a session](/docs/sessions/): grants with limits, what the owner sees
  on Nido's pages, and how to handle a refusal.
- [Fees and storage](/docs/fees/): measured costs for accounts, grants and
  session calls.
- [Troubleshooting](/docs/troubleshooting/): known pitfalls and what to do
  about each.
- [For AI agents](/docs/ai-agents/): the rules in short form, how to check work
  against testnet, and the plain-text versions of these pages.

## What isn't available yet

These pages describe what works today. Some things you might expect are not
built yet, and the pages say so where they come up:

- **Revoking a session.** A grant lasts until its expiry.
- **A published Nido SDK for sessions.** The flow lives in the template's
  `app-lib/session.ts`.
- **A mainnet walkthrough.** These guides use the template's testnet setup.

## Source

- Nido: [github.com/nidohq/nido](https://github.com/nidohq/nido)
- The app template:
  [github.com/nidohq/scaffold-template](https://github.com/nidohq/scaffold-template),
  with `NIDO.md` (for people) and `AGENTS.md` (for coding agents)
- The session flow described here matches the template's
  [passkey-session update](https://github.com/nidohq/scaffold-template/commit/6f41265a4225703c057d6d04e07c3594a1a3972f):
  one approval for the grants, an app passkey prompt per call, and relayer-paid fees.
- Perch, the policy layer Nido accounts enforce:
  [github.com/stellar-registry/perch](https://github.com/stellar-registry/perch)
