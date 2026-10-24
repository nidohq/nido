---
layout: ../../layouts/DocsLayout.astro
title: Concepts
description: What a Nido account is, why your app needs a session to call your contract, what a grant allows, when it ends, and who pays for each step.
---

## Smart accounts and passkeys

A Nido account is a Soroban smart account: a contract at a C-address, built on
[Perch](https://github.com/stellar-registry/perch) and OpenZeppelin's
`stellar-accounts`. Its owner holds a passkey, a P-256 key that stays on their
device or in their password manager. The account checks the passkey's WebAuthn
signature on chain, through a verifier contract, so Nido's servers never see
or hold a key that can move funds.

What that means for your app:

- **The address is a contract.** Tools that expect a G-address can trip on it.
  A C-address can't be the source of a transaction or sign a classic Stellar
  operation; it authorizes Soroban contract calls. The template's
  `isSmartAccount(address)` tells the two apart, and `transactionSource(address)`
  leaves the source empty for a C-address so the generated client simulates
  with a placeholder source.
- **Your contract doesn't change.** It calls `user.require_auth()` and the
  account decides whether to authorize.
- **The passkey belongs to the account's own subdomain**,
  `<c-address>.test.nido.fyi`. That is why Nido's signing and grant pages open
  there, in a popup or a redirect, and not inside your app.
- **The owner can recover the account** if they lose the passkey, through
  friends they trust, a recovery kit, or both. See
  [How recovery works](/how-recovery-works/).

## Why the passkey popup can't call your contract

The passkey signs under the account's first rule, **admin**, and that rule only
covers calls on the account itself, such as a change to its policy. If your
app asks Nido's sign popup to authorize a
call into your contract, the account refuses it:

| Code | Meaning |
| --- | --- |
| `#3002` | No rule covers the call (one contract in the call) |
| `#3014` | A contract in the call has no rule (several contracts) |

So an app acts for a Nido account through a **session**.

## Sessions and delegated signers

A session is a rule in the account's policy that names a key your app holds.

1. Your app makes an ed25519 key (a classic G-address keypair) and has it
   funded so it can pay transaction fees. On testnet, Friendbot funds it.
2. The owner approves a rule on Nido's grant page with their passkey. The rule
   names that key as a **delegated signer** (CAP-0071): it may sign for the
   account, but only for the functions and contracts the rule lists, until it
   expires, and under its spending cap if it has one.
3. Your app signs later calls itself, inside the account's own authorization
   entry, and submits them with the key as the fee payer. The account checks
   the rule on every call.

The session key never holds the user's money. Every payment still comes out of
the account and counts against the cap. The trade-off is where the key lives:

- **In your app's origin, in the browser's `localStorage`.** Whoever can read
  your origin's storage can use the key, up to the cap and until expiry.
- **The origin includes the port.** A dev server that moves from port 5173 to
  5174 has no session there, and two apps on one port share one.
- **One key per account and origin.** Several gates in one app share it, and
  each asks only for the grants it lacks.

## Grants and spending caps

A grant is one rule the owner approves. In the template it looks like this:

```ts
const grants: Grant[] = [
  {
    target: guessTheNumber.options.contractId, // the one contract
    functions: ["guess"], // every function when omitted
    duration: "24h", // "24h" | "7d" | "30d"
    label: "guess", // the rule's name, at most 20 bytes
  },
  {
    target: xlmTokenId, // a capped grant names the token
    functions: ["transfer"],
    duration: "24h",
    limit: { amount: "2", period: "day" }, // "day" | "week" | "30d"
    label: "guess-xlm",
  },
]
```

The rules that follow from how the account checks a call:

- **One grant per contract the account authorizes in the call.** That is the
  root call plus every sub-call that needs the same account's authorization,
  such as a token `transfer` from the user. Guess the Number needs two: the
  game, and the XLM token it moves. To find yours, assert `env.auths()` in a
  unit test; each contract in that list is a grant.
- **Keep `require_auth()` at the root.** Call `user.require_auth()` in your
  contract's function before it moves the user's tokens. Relying on the token's
  own check instead makes the authorization non-root, and simulation refuses
  it: "authorization not tied to the root contract invocation".
- **A `limit` caps cumulative `transfer` amounts, and only on a grant whose
  `target` is that token.** A cap on any other contract doesn't limit what that
  contract moves. The period is a rolling window of ledgers: `day` is 17,280
  ledgers, about 24 hours at five seconds a ledger.
- **A grant without a cap needs the owner's explicit yes.** Nido's page asks
  them to tick "Let this key spend without any cap". For a contract that moves
  no money, or one whose own code limits amounts, that is expected; say so in
  your app's explanation, because the wording alone can read as if the app
  could spend anything. A grant sent with `limit=none` whose `functions` name
  no token function skips the tick.
- **The same label replaces the rule.** Asking again with an existing label
  changes or renews that rule in place.

Patterns that work:

- **An action that moves no money** (claim, vote, check in): one grant on your
  contract, no cap.
- **A capped payment** (tip, buy, a game stake): two grants, your contract plus
  the token with a `limit`.
- **Shared funds** (a group pot): your contract holds the money and pays out
  when enough members approve. Each member uses their own Nido account.
- **Limits for someone else** (an allowance): a cap limits a key, not the
  account's owner. Keep custody in a contract the limited person doesn't
  administer.
- **Time locks:** a rule's expiry stops a key; it doesn't delay a withdrawal.
  Put unlock dates in your contract.

## Expiry, renewal and revoking

Every grant ends at its expiry. The template offers `24h`, `7d` and `30d`, and
Nido turns them into a ledger number when the owner approves. When a grant
runs out, the account refuses the next call (`#3002` or `#3016`) and the
template's gate shows **Renew**, which asks for the same labels again.

Revoking a session before it expires is
<span class="docs-tag">Not available yet</span>. Plan as if every grant lasts
until its expiry, and pick the shortest duration that works for your app.
Nido's grant page also offers "Never (until revoked)"; the template leaves it
out on purpose, and so should you until revoking works.

The template's **Forget it** deletes this browser's copy of the session key.
The rule stays on chain until it expires. Approving again with the same labels
replaces the rules, and the old key stops working.

## The relayer, and who pays for what

Nido runs a relayer that pays the fees for the transactions Nido's pages
submit. It pays out of one daily budget shared by everyone on testnet, counted
by each transaction's fee bid rather than the fee it was finally charged.

| Step | Who pays the fee | How it's sent |
| --- | --- | --- |
| Create an account | Nido's relayer | Nido's account page |
| Apply a grant | Nido's relayer | Nido's grant page |
| A call your app makes with a session | Your app's session key | Your app, straight to the network |
| A call through Nido's sign popup | Nido's relayer | Nido submits it and returns the hash |
| Tokens your contract moves | The account | Counted against the grant's cap |

Session calls don't go through the relayer because it can't submit CAP-0071
authorization entries yet, so your session key needs XLM for fees. On
testnet, Friendbot provides it. [Fees and storage](/docs/fees/) has the
measured amounts, and [Troubleshooting](/docs/troubleshooting/#nido-says-it-couldnt-confirm-what-happened)
covers what happens when the relayer's budget runs out.

## Without the template

To add Nido to the wallet picker of an app you already have, use the
[Stellar Wallets Kit module](https://github.com/nidohq/nido/tree/main/packages/stellar-wallets-kit-module)
and the [integration guide](https://github.com/nidohq/nido/blob/main/docs/ADD-NIDO-TO-DAPP.md).
That gets you connect, and signing for calls on the account itself. When
Nido's popup signs a transaction, Nido submits it through its relayer and
returns the transaction hash, so your app must not broadcast it again.

For calls into your own contract you need the session flow, which today lives
only in the template's `app-lib/session.ts`. A published Nido SDK for it is
<span class="docs-tag">Not available yet</span>.
[Request a session](/docs/sessions/#nidos-grant-page-parameters) documents
the grant page's parameters if you build it yourself.
