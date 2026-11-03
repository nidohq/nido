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

1. Close Nido's popup to return to the app. If the browser opened Nido as a
   full page instead, use Back.
2. Press **Check again** on the template's gate. It reads the account's rules
   on chain and records a grant that landed.
3. If nothing landed, press **Ask Nido again**. It reuses the app's key. If
   the budget is used up, try again later.

Don't retry blindly from Nido's page. The account's installed rules are the
truth: see [Check what an account has approved](#check-what-an-account-has-approved).

### Making the app passkey seems to do nothing

The gate first asks the device to make a passkey for this app. Complete or
cancel that device prompt before trying again. Use `https://` or `localhost`,
not a local IP address. No Friendbot funding is needed for the app passkey.

### Two rules, one confirmation

Each contract the account authorizes needs a grant. The current template sends
grants sharing a duration together, so the sample shows **Approve with Nido
(2 rules, one confirmation)**. Making the app passkey is a separate device
ceremony, and each later call asks for that app passkey. If an older checkout
asks once per rule, update it to the template's passkey session flow.

### Nido asks to "spend without any cap" on a rule that can't spend

The template sends a grant without a cap as `limit=none`. Nido skips the tick
only if its explicit `functions` list names no token function, and shows
"No cap — allows no token functions". A request that omits `limit`, omits the
function list, or includes a token function still asks the owner to choose a
cap or accept uncapped spending. If the call moves tokens, cap the grant
whose `target` is the token and restrict its recipient with `to`.

### The owner cancelled

Nido returns `?delegation=cancelled`. The template keeps the app passkey
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

The call would go over the grant's spending cap. Nothing was sent and it cost
nothing. The template checks spending before prompting (`CapReachedError`),
and the account also enforces it in simulation (`#3221`). Use `isOverCap(error)`
to identify the refusal and `capReachedUntil` to display when the cap frees
up. A `day` cap is a rolling window of 17,280 ledgers, about 24 hours.
Re-approving the same rules preserves their spending record.

### Simulation says "authorization not tied to the root contract invocation"

Your contract moves the user's tokens without calling `user.require_auth()`
itself, so the token's check is the account's only authorization, and it isn't
at the root of the call. Call `user.require_auth()` first in the function, and
ask for one grant per contract.

### The session disappeared

The session metadata lives in your app origin's `localStorage`, and the
origin includes the port. A dev server that started on another port, a
different browser profile, or cleared site data has no session metadata,
even if the device still lists the passkey. Keep `PORT` fixed (the template
sets `strictPort`) and approve again on the new origin. Grants also end at
their expiry: 24 hours for the sample.

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
expiry. The template's **Forget it** deletes only this browser's session
metadata; the passkey may remain on the device and the rules stay on chain.
Making a new app passkey and approving it with the same labels replaces
those rules, so the old key no longer satisfies them.

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
