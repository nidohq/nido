---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Make an app from the Nido template, create a passkey account, approve a session once, and make calls your app signs without a prompt, all on testnet.
---

## Before you start

You need:

- Node 22.12 or newer
- Rust, with the `wasm32v1-none` target (`rustup target add wasm32v1-none`)
- The [Stellar CLI](https://developers.stellar.org/docs/tools/cli/install-cli)
- A browser that supports passkeys, on `https://` or `localhost`

The template installs its own copy of Scaffold Stellar, so you don't need a
global one.

## 1. Make the app

```sh
stellar scaffold init --template nidohq/scaffold-template my-app
cd my-app
npm run tools:scaffold     # stellar-scaffold for this project, in .tools/ (seconds)
npm ci                     # npm 11 prints allow-scripts warnings; they are harmless
npm run doctor             # checks tools, testnet, keys and clients, and says how to fix what's missing
npm run clients:testnet    # a client for the shared Guess the Number deployment
npm run dev                # open the URL it prints
```

`npm run clients:testnet` creates a throwaway deployer key on its first run and
has Friendbot fund it. Keys and contract aliases stay in the project's
`.stellar-config/`, not in your global `~/.config/stellar`.

> **Run two apps? Give each its own port.** An app made with `init` keeps the
> default `PORT=5173`. Your app's session key lives in the browser storage of
> its origin, and the origin includes the port, so two apps on the same port
> share session storage, and an app that moves to another port has no session.
> Set a different `PORT` in each app's `.env`.

## 2. Create a Nido account

Open [test.nido.fyi](https://test.nido.fyi) in the **same browser** you'll use
for the app, choose **Get started**, then **Set up with your face**, and create
the passkey when your device asks. Nido reserves the account's C-address,
deploys the account through its relayer and funds it with 5 test XLM. It takes
under a minute.

You can also start from the app's Connect button, but creating the account
first avoids a confusing step: see the next section.

## 3. Connect from the app

In the app, press **Connect** and choose **Nido**. A popup on test.nido.fyi lists
the accounts on this device. Choosing one shares only its address; nothing is
signed. The app's header then shows the C-address and its XLM balance.

> **"Wallet connection was cancelled or failed."** If you press Connect before
> you have an account, the popup says "No accounts on this device. Create one
> first". Following that link creates the account inside the popup, and when
> you close it, the wallet picker reports a cancelled connection. Nothing went
> wrong: press **Connect** again and choose the new account.

## 4. Approve the session

The sample game, Guess the Number, takes 1 XLM for each wrong guess. Before
your account can play without prompts, its owner approves a session. The
app's gate explains what it asks for and shows **Approve with Nido (2
confirmations)**.

1. Press it. The app shows "Preparing a key for this app…" while it makes a new
   session key and has Friendbot fund it, so the key can pay fees. This can
   take ten seconds or so. Press once.
2. The app sends you to Nido's grant page for the first rule: the key may call
   `guess` on the game contract, for 24 hours, with no spending cap. Nido makes
   you tick **"Let this key spend without any cap"** for any rule without a
   cap. This rule can only call `guess`, and the XLM it moves is limited by the
   second rule. Confirm with your passkey (confirmation 1 of 2).
3. Nido applies the rule through its relayer and sends you to the second grant
   page: the key may call `transfer` on the XLM token contract, up to **2 XLM
   per day**. Confirm (2 of 2).
4. Back in the app: "This app holds a session key for your account, approved
   until …", and the game is playable.

There are two confirmations because the game's calls need a rule for each
contract they authorize: the game itself, and the XLM token it moves. The
template asks Nido for one grant per request. Nido's grant page can take
several grants with one confirmation (see
[Request a session](/docs/sessions/#nidos-grant-page-parameters)), but the
template doesn't ask that way yet.

## 5. Make calls without prompts

Guess a number. The app signs the call with its session key and submits it, so
no popup opens. A wrong guess moves 1 XLM from your account and shows the
transaction hash.

The third wrong guess in a day is refused. Your account checks the 2 XLM cap
while the call is simulated, before anything is sent, so the refused guess
costs nothing, and the app says why:

> That's the 2 XLM a day you let this game spend, so your account stopped this
> guess before anything was sent. It cost nothing.

That refusal is the account enforcing the rule you approved. The app can't get
around it, and nobody holding the session key can either.

## 6. Use your own contract

The template's `NIDO.md` walks through it. In short:

1. Write the contract in `contracts/<name>`. In each function a user calls,
   `user.require_auth()` comes first.
2. Find its grants: assert `env.auths()` in a unit test. Each contract in that
   list needs one grant (see [Concepts](/docs/concepts/#grants-and-spending-caps)).
3. List it in `scaffold.yml` under `contracts:`.
4. `npm run deploy:testnet` deploys it, pins the new contract ID under
   `testnet:` and writes its client.
5. Call it from React with `submitCall`, inside a `SessionGate` that asks for
   those grants. [Request a session](/docs/sessions/) shows the pattern.

From a checkout of the template, `npm run new-app -- ../my-app --blank` starts
an app with a one-function starter contract in place of the sample, its own
package name, deployer identity and dev-server port.

## Next

- [Concepts](/docs/concepts/) explains what you just approved.
- [Fees and storage](/docs/fees/) explains what each step cost.
- [Troubleshooting](/docs/troubleshooting/) covers what can go wrong on the way.
