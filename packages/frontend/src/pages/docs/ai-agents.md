---
layout: ../../layouts/DocsLayout.astro
title: For AI coding agents
description: What a coding agent building on Nido needs to know, how to check its work against testnet rather than mocks, and where to get these docs as plain text.
---

## Plain-text entry points

- [`/docs/llms.txt`](/docs/llms.txt): an index of these pages with one line
  each.
- [`/docs/llms-full.txt`](/docs/llms-full.txt): every page in one Markdown
  file. Load this instead of crawling the HTML.
- In an app made from the template: `AGENTS.md` at the repo root states the
  same rules for the template's code, and `NIDO.md` explains them for people.
  The template's tests check that the two agree on commands and the call
  pattern.

Paths in these files are on the host you fetched them from:
`https://test.nido.fyi` for testnet.

## The rules

- **The tutorial and template use testnet.** Use throwaway testnet accounts
  for these examples. Nido's mainnet deployment is separate; do not point
  the template's testnet contracts, RPC or funding flow at it.
- **The passkey popup can't call your contract.** It signs under the account's
  admin rule, which covers only calls on the account itself; a call into
  another contract is refused with `#3002` (one contract) or `#3014` (several).
  Use a session.
- **One `Grant` per contract the account authorizes in the call**: the root
  call plus every sub-call that needs the same account's authorization, such
  as a token `transfer`. Derive the list by asserting `env.auths()` in a unit
  test.
- **`user.require_auth()` at the root** of every function a user calls, before
  it moves the user's tokens. Otherwise simulation refuses with "authorization
  not tied to the root contract invocation".
- **`limit` caps cumulative `transfer` amounts, only on a grant whose `target`
  is that token** (`xlmTokenId` for XLM). The template sends uncapped grants
  as `limit=none`; Nido skips the checkbox when the explicit `functions`
  list names no token function. Use **`to`** on a transfer-only grant to
  restrict the recipient; otherwise it can pay any address up to the cap.
- **The template sends grants together**, using `pubkey=` and
  `grant.<i>.<field>` for one confirmation. Give a gate's grants the same
  duration, with at most 8 in a request
  ([parameters](/docs/sessions/#nidos-grant-page-parameters)).
- **`label` is at most 20 bytes**, and asking again with the same label
  replaces that rule. **`duration`** is `24h`, `7d` or `30d`.
- **The session signer is the app's passkey.** Its private key stays in the
  authenticator; `localStorage` holds the public key, credential id and
  session metadata. Each call asks the device to sign, and Nido's relayer
  submits it and pays the fee. Keep `PORT` fixed and use `localhost`, not an
  IP address, for local passkeys. Keep `credential_id` out of grant URLs.
- **Check the cap before prompting.** Use `CapReachedError` and
  `capReachedUntil` to explain a spent cap and disable the action until it
  frees up. Renewing the same rules preserves the spending record.
- **A cap limits a key, not the account's owner**, and **expiry stops a key, it
  doesn't delay a withdrawal**. For allowances, custody or time locks, put the
  money and the rule in your contract.
- **Build contracts through Scaffold** (`npm run deploy:testnet`). A plain
  `stellar contract build` bakes the local network's XLM contract into the
  wasm, which fails on testnet with `Error(Context, InvalidAction)`.
- **Call `submitCall` before any other `await`** in a click handler, so Nido's
  popup keeps the user's gesture.

## Commands and their side effects

| Command | Deploys | Spends or writes keys |
| --- | --- | --- |
| `npm run tools:scaffold` | No | No |
| `npm run doctor` (`-- --json` for a machine-readable report) | No | No, reads only |
| `npm run clients:testnet` | No | Creates the deployer key and has Friendbot fund it, on first run |
| `npm run deploy:testnet` | Yes | The deployer pays the fees |
| `npm run dev` | No | Creates the deployer on first run |
| `npm run test-browser` | No | Saves throwaway passkeys in `target/` |

Keys and contract aliases live in the project's `.stellar-config/`, not the
global `~/.config/stellar`, so several apps on one machine don't share
identities.

## Check work against testnet, not mocks

`npm run test:e2e` runs the real app with Nido's pages and the RPC mocked. It
proves the app's side of each exchange, not that the chain accepts it.

For the real flow without a person, `npm run test-browser` starts a throwaway
Chrome whose tabs and popups all have a virtual passkey, and writes the
connection settings for a browser driver to `target/test-browser.env`. Create
the account at [test.nido.fyi](https://test.nido.fyi) in that browser. Some
things to expect while driving it:

- The wallet picker's buttons have no accessible names. Find the Nido entry by
  its text.
- The app re-renders while a session loads. If your driver uses element
  references, take a fresh snapshot right before each click.
- Nido's popup closes itself after an approval. That is the end of the flow,
  not an error.

A run is done when you can show:

1. the account's C-address, the contract ID and the network;
2. the transaction hashes of real calls, with balances before and after;
3. the account's `installed_rules` showing the grants;
4. a refusal, and whether it came from simulation (free, nothing sent) or from
   a submitted transaction.

```sh
npm run stellar -- contract invoke --id <C-address> --network testnet --send=no -- installed_rules
```

## When Nido's relayer refuses

Account creation, grants and session calls go through Nido's relayer, out of one daily budget
shared by everyone on testnet. Nido's signing page shows the same "couldn't
confirm" message for a 429 `FEE_LIMIT_EXCEEDED` (nothing sent), a 503
`POOL_CAPACITY` (nothing sent) and a 504 (may have landed). Don't loop on
retries: read `installed_rules`, then use the gate's **Check again** or **Ask
Nido again**. The full table is in
[Troubleshooting](/docs/troubleshooting/#nido-says-it-couldnt-confirm-what-happened).

## Not available yet

Don't design around these; they don't exist yet:

- revoking a session (grants end at their expiry);
- Nido's grant page answering `?delegation=error&code=…` or
  `?delegation=signed&payload=…` (it sends only `ok` and `cancelled`);
- a published Nido SDK for the session flow (it lives in the template's
  `app-lib/session.ts`);
- a mainnet walkthrough in these guides.
