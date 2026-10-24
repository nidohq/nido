---
layout: ../../layouts/DocsLayout.astro
title: Troubleshooting
description: Known pitfalls when building a first app on Nido, what causes each one, and what to do.
---

## Connecting

### The wallet picker says "Wallet connection was cancelled or failed."

You pressed Connect before you had a Nido account, followed "Create one first"
in the popup, created the account there, and closed the popup. The wallet
picker reports the closed popup as a cancelled connection. Nothing went wrong:
press **Connect** again and choose the new account. To avoid it, create the
account at [test.nido.fyi](https://test.nido.fyi) first, in the same browser.

### Nido says "No accounts on this device"

Nido's connect popup lists the accounts created or opened in this browser.
Create one, or open the account you have in this browser first. A passkey
works only in browsers that support passkeys, on `https://` or `localhost`,
and not inside in-app browsers such as a social app's link viewer.

### Account creation says "Too many transactions queued"

Nido's relayer was busy (`POOL_CAPACITY`), and nothing was sent. Wait a minute
and try again. Keep the page open until it says your Nido is ready.

## Approving a session

### Nido says it couldn't confirm what happened

Applying a grant goes through Nido's relayer. When the relayer refuses or
times out, Nido's signing page currently shows the same message for every
case: "We couldn't confirm what happened to this transaction on-chain… retrying
could pay twice". The cases differ:

| What happened | Relayer answer | Did the grant land? |
| --- | --- | --- |
| The shared daily budget is used up | 429 `FEE_LIMIT_EXCEEDED` | No |
| The relayer is busy | 503 `POOL_CAPACITY` | No |
| The relayer timed out after submitting | 504 | Sometimes |

What to do:

1. Go back to the app with the browser's Back button.
2. Press **Check again** on the template's gate. It reads the account's rules
   on chain and records a grant that landed.
3. If nothing landed, press **Ask Nido again**. It reuses the app's key. If
   the budget is used up, try again later.

Don't retry blindly from Nido's page. The account's installed rules are the
truth: see [Check what an account has approved](#check-what-an-account-has-approved).

### Approve with Nido seems to do nothing

The first approval makes a session key and waits for Friendbot to fund it,
which can take ten seconds or more. The template shows "Preparing a key for
this app…" meanwhile. Press once; pressing again doesn't help.

### One Approve, two passkey confirmations

Expected when your call touches two contracts, such as your contract and the
XLM token. Each contract needs a grant, and the template asks Nido for one
grant per request, so the owner confirms once per grant. The template's button
says how many: "Approve with Nido (2 confirmations)". Nido's grant page can
take several grants with one confirmation if you build the request yourself
(see [Request a session](/docs/sessions/#nidos-grant-page-parameters)).

### Nido asks to "spend without any cap" on a rule that can't spend

Nido asks the owner to tick this for every grant without a `limit`, including
a grant on a contract that moves no money. The rule still allows only the
functions it lists, on the one contract it names. Say so in your gate's
explanation, so the owner isn't surprised by the wording. If the call moves
tokens, put the cap on a grant whose `target` is the token. A request you
build yourself can send `limit=none` on a grant whose `functions` name no
token function; Nido then skips the tick and shows "No cap — allows no token
functions".

### The owner cancelled

Nido sends them back with `?delegation=cancelled`. The template keeps the key
and anything already approved, and the gate asks again.

## Making calls

### `#3002` or `#3014` through Nido's popup

Nido's passkey popup can't authorize a call into your contract: the passkey's
rule covers only calls on the account itself. Ask for a session and call
through `submitCall` inside a `SessionGate`. See [Concepts](/docs/concepts/#why-the-passkey-popup-cant-call-your-contract).

### `#3014` with an approved session

The call touches a contract the session has no grant for, often a token
`transfer` your contract makes from the user. Add a grant for that contract.
Assert `env.auths()` in a unit test to list every contract a call needs.

### `#3002` or `#3016` with an approved session

The rule expired, or the session doesn't cover this function. The template's
gate shows **Renew** when a grant has expired. A redeployed contract has a new
ID, so the old grant no longer covers it, and the gate asks again.

### `#3221`, over the cap

The call would go over the grant's spending cap. The account refused it in
simulation: nothing was sent and it cost nothing. Use `isOverCap(error)` to say
which cap stopped it and when it resets. A `day` cap is a rolling window of
17,280 ledgers, about 24 hours.

### Simulation says "authorization not tied to the root contract invocation"

Your contract moves the user's tokens without calling `user.require_auth()`
itself, so the token's check is the account's only authorization, and it isn't
at the root of the call. Call `user.require_auth()` first in the function, and
ask for one grant per contract.

### The session disappeared

The session key lives in your app origin's `localStorage`, and the origin
includes the port. A dev server that started on another port, a different
browser profile, or cleared site data has no session. Keep `PORT` fixed (the
template sets `strictPort`) and approve again on the new origin. Grants also
end at their expiry: 24 hours for the sample.

### Nido's popup was blocked

Browsers allow a popup only during a click. Building a call simulates it over
the network first, which loses the click. Call `submitCall` before any other
`await` in the handler; it reserves the popup up front.

### A transaction hash came back from Nido's popup

If you use Nido's wallet module directly: when Nido's popup signs a
transaction, Nido submits it through its relayer and returns the hash. Don't
broadcast it again.

### Revoking a session

<span class="docs-tag">Not available yet</span>. A grant lasts until its
expiry. The template's **Forget it** deletes only this browser's copy of the
key; the rule stays on chain until it expires. Approving again with the same
labels replaces the rules, and the old key stops working.

## Building and deploying

### `Error(Context, InvalidAction)` after deploying

The contract was built with a plain `stellar contract build`, which compiles
for the local network: `stellar_registry::import_asset!("xlm")` bakes that
network's XLM contract into the wasm. Build through Scaffold
(`npm run deploy:testnet`). To recover, run
`cargo clean -p <crate> --target wasm32v1-none --release` and deploy again.

### Scaffold compiles but writes no clients

Older `stellar-scaffold` releases ignore the template's `scaffold.yml` without
an error. Run `npm run tools:scaffold` for the tested version, and
`npm run doctor` to check.

### Harmless warnings

- `npm warn allow-scripts` during `npm ci`: nothing in the template needs those
  install scripts.
- "An identity with the name … already exists": Scaffold checks for the
  deployer on every build.

## Check what an account has approved

The account's rules are the source of truth. From the template:

```sh
npm run stellar -- contract invoke --id <C-address> --network testnet --send=no -- installed_rules
```

The owner can also open their account at `https://<account>.test.nido.fyi`,
where the Policy page shows the policy document and every rule in it.
