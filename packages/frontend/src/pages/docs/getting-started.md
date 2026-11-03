---
layout: ../../layouts/DocsLayout.astro
title: Getting started
description: Make an app from the Nido template, create a passkey account, approve a session once, and sign calls with the app's passkey, all on testnet.
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
> default `PORT=5173`. Session metadata lives in the browser storage of the
> app's origin, which includes the port, so two apps on the same port share
> session storage, and an app that moves to another port has no session.
> Set a different `PORT` in each app's `.env`, and open it at `localhost`,
> not `127.0.0.1`: passkeys need a hostname.

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

The sample game, Guess the Number, takes 1 XLM for each wrong guess. Its gate
explains the session and asks you to **Make a passkey for this app**.

1. Make the app's passkey when your device asks. This is separate from your
   Nido account's passkey. Its private key stays in the authenticator; the app
   stores only its public key, credential id and session metadata.
2. Press **Approve with Nido (2 rules, one confirmation)**. One popup shows
   both rules for 24 hours: `guess` on the game, without a cap, and `transfer`
   on XLM, capped at **2 XLM per day** and paying **only the game**. The
   template sends `limit=none` for `guess`, so no uncapped-spending checkbox
   is needed for that rule.
3. Review both rules and confirm once with your **Nido account's passkey**.
   Nido's relayer applies them together and closes the popup.
4. Back in the app, the game is playable. The app passkey needs no Friendbot
   funding: Nido's relayer pays the transaction fees.

There are two rules because the call authorizes both the game and XLM. They
share one approval. See [Request a session](/docs/sessions/) for the API.

## 5. Make a call with the app's passkey

Guess a number and answer your device's **app passkey** prompt. No Nido
approval page opens for each guess. The app signs the authorization and
Nido's relayer submits it. A wrong guess moves 1 XLM from your account to the
game and shows the transaction hash.

After two wrong guesses, the sample shows **Cap reached until ≈ …** and
disables Submit. It reads the spending record before requesting another
passkey signature; the account also enforces the cap during simulation.
A refused call sends nothing and costs nothing. Renewing the same rules
keeps their spending record, so re-approving does not reset a spent cap.

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
