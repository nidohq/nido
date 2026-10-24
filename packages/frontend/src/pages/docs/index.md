---
layout: ../../layouts/DocsLayout.astro
title: Build with Nido
description: Nido gives the people using your Stellar app a smart account they unlock with a passkey. These pages explain how your app works with that account, for developers and for the AI coding agents working with them.
---

## What Nido is, for an app

A Nido account is a Soroban smart account: a contract with a C-address, not a
classic G-address keypair. Its owner unlocks it with a passkey (Face ID, Touch
ID, a security key), so there is no seed phrase and no browser extension.
Nido's relayer pays to create the account, and a new testnet account arrives
with 5 test XLM.

Your contract doesn't need to know any of this. It calls
`user.require_auth()` as usual, and the account decides whether to authorize.

The one thing that changes for your app is how it gets a signature. Nido's
passkey popup only signs calls on the account itself. To call your contract,
the owner approves a **session** once: a rule that lets a key your app holds
call the functions you name, on the contracts you name, until an expiry, and
optionally under a spending cap. After that your app signs those calls itself,
with no prompts, and the account checks every call against the rule.

> Nido runs on Stellar **testnet** only. Use throwaway testnet keys, never
> mainnet or a key a person holds.

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
  and a first call that needs no prompt.
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
- **Session calls through Nido's relayer.** The relayer can't submit them yet,
  so your app's session key pays the fees for its own calls.
- **Mainnet.** Hosted Nido is testnet only.

## Source

- Nido: [github.com/nidohq/nido](https://github.com/nidohq/nido)
- The app template:
  [github.com/nidohq/scaffold-template](https://github.com/nidohq/scaffold-template),
  with `NIDO.md` (for people) and `AGENTS.md` (for coding agents)
- Perch, the policy layer Nido accounts enforce:
  [github.com/stellar-registry/perch](https://github.com/stellar-registry/perch)
