---
layout: ../../layouts/DocsLayout.astro
title: Fees and storage
description: What each step costs on testnet, who pays it, and why the first call with a new session costs more than the ones after it.
---

## Who pays

| Step | Paid by | Measured on testnet (October 2026) |
| --- | --- | --- |
| Create an account | Nido's relayer | About 1.4 XLM |
| Apply a first grant | Nido's relayer | About 4.5 XLM bid |
| Apply a later grant, with a cap | Nido's relayer | About 2.7 XLM bid |
| First call with a new session | Your app's session key | About 0.53 XLM |
| Each later call | Your app's session key | About 0.034 XLM |
| A call the account refuses | Nobody | Free: refused in simulation, nothing sent |
| Tokens your contract moves | The account | Whatever the call moves, counted against the cap |

1 XLM is 10,000,000 stroops. These are measurements from real testnet runs,
not quotes: fees on Stellar depend on network load and on how much the
transaction reads, writes and stores.

## Account creation and grants

Nido's relayer pays for these out of a daily budget shared by everyone on
testnet. The budget counts each transaction's **fee bid**, the most it
offered to pay, not the fee it was charged in the end. That is why the grant
rows above say "bid".

A first grant costs more than later ones because it writes the account's
policy document for the first time.

If the shared budget is used up, the relayer refuses with
`FEE_LIMIT_EXCEEDED` and nothing is sent. See
[Troubleshooting](/docs/troubleshooting/#nido-says-it-couldnt-confirm-what-happened).

## Session calls

Your app's session key pays the fee for every call it makes, because Nido's
relayer can't submit session calls yet. On testnet, Friendbot funds the key
when the app makes it.

The fee on a session call is almost all **rent**. Soroban charges rent to keep
persistent storage entries alive, and a transaction that extends an entry pays
for the extension.

**The first call with a new session pays about 0.53 XLM**, of which about
0.531 XLM is rent. That first call extends six persistent entries to about 30
days:

- on the account: two context rules, two policy entries and one signer entry,
  for the two rules a capped payment needs;
- on the spending-limit policy contract: the spending tracker for the account.

**Later calls pay about 0.034 XLM**, of which about 0.0325 XLM is rent. Each
spend adds about 80 bytes to the spending tracker's persistent history, and a
larger entry costs more to keep alive. The rest of each fee, about 0.0016
XLM, is the resource and inclusion fee.

Those numbers come from a session with two grants, one of them capped. Yours
will differ with the number of rules in the session and whether one is
capped.

Plan for this when you price an action:

- A first action that costs 0.53 XLM in fees is large next to a small payment.
  The cost is per session, so a longer `duration` spreads it over more calls,
  at the price of a longer-lived key in the browser.
- A call the account refuses, for example over the cap, is caught in
  simulation and costs nothing.
- Your contract's own storage is extra. The sample game stores nothing per
  guess; the only temporary entry a guess writes is the authorization nonce.

## Self-submitting a grant

The passkey signs a grant and a nonce, not the fee payer, so any funded key can
submit an approved grant. Submitted by a session key instead of the relayer, an
uncapped grant was charged 0.26 XLM on testnet. The template is ready to do
this, but Nido's grant page doesn't hand back the signed approval yet: this is
<span class="docs-tag">Not available yet</span>.
