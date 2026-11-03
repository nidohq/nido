---
layout: ../../layouts/DocsLayout.astro
title: Fees and storage
description: What each step costs on testnet, who pays it, and why the first call with a new session costs more than the ones after it.
---

## Who pays

| Step | Paid by | Historical testnet measurement (October 2026) |
| --- | --- | --- |
| Create an account | Nido's relayer | About 1.4 XLM |
| Apply a first grant | Nido's relayer | About 4.5 XLM bid |
| Apply a later grant, with a cap | Nido's relayer | About 2.7 XLM bid |
| First call with a passkey session | Nido's relayer | About 0.565 XLM on October 23 |
| Later passkey session calls | Nido's relayer | About 0.035 XLM on October 23 |
| A call the account refuses | Nobody | Free: refused in simulation, nothing sent |
| Tokens your contract moves | The account | Whatever the call moves, counted against the cap |

1 XLM is 10,000,000 stroops. These are measurements from real testnet runs,
not quotes: fees on Stellar depend on network load and on how much the
transaction reads, writes and stores.

The template's [recorded testnet runs](https://github.com/nidohq/scaffold-template/blob/6f41265a4225703c057d6d04e07c3594a1a3972f/NIDO.md#verified-live-on-testnet)
also saw a first guess cost about 3.3 XLM, later guesses 0.2 XLM, and approval
44 XLM under surge pricing on October 24. Use these as dated observations,
not expected fees. They do not describe mainnet costs.

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

The current template signs with an app passkey and Nido's relayer pays the
fee for every submitted session call. The app passkey needs no funding.
These calls share the relayer's testnet budget with accounts and grants.

**Storage rent** can dominate a session call's cost. Soroban charges rent to
keep persistent storage entries alive, and a transaction that extends an
entry pays for the extension. Inclusion fees can also rise with network load.

An earlier walkthrough using the former delegated-key session flow measured
about **0.53 XLM** for its first call, almost all rent. That call extended six
persistent entries to about 30 days:

- on the account: two context rules, two policy entries and one signer entry,
  for the two rules a capped payment needs;
- on the spending-limit policy contract: the spending tracker for the account.

Later calls in that walkthrough cost about **0.034 XLM**, about 0.0325 XLM of
it rent. Each spend grew the spending tracker's history, making the entry
more expensive to keep alive. The remaining fee covered resources and
inclusion. The current passkey flow has different signer and policy entries;
this breakdown explains the earlier measurement, not its exact footprint.

Those numbers come from a session with two grants, one of them capped. Yours
will differ with the number of rules in the session and whether one is
capped.

Plan for this when you price an action:

- Storage rent can be large next to a small payment, even when the relayer
  sponsors it. Reusing approved rules avoids needless policy writes. Choose
  the shortest approval duration that works for the app.
- A call the account refuses, for example over the cap, is caught in
  simulation and costs nothing.
- Your contract's own storage is extra. The sample game stores nothing per
  guess; the only temporary entry a guess writes is the authorization nonce.

## Custom submission paths

An authorization signature does not choose the transaction's fee payer, so a
custom integration can submit authorized calls with a funded transaction
source. That is separate from the current template's relayer flow. Nido's
grant page does not hand a signed approval back to the app for self-submission;
that handoff is <span class="docs-tag">Not available yet</span>.
