---
layout: ../../layouts/DocsLayout.astro
title: Request a session
description: Ask a Nido account for the grants your app needs, with limits, explain them to the owner, and turn every refusal into a sentence a person can act on.
---

## The call site

Everything below comes from the template's `@stellar-scaffold/app-lib`
(`app-lib/` in your app), except `SessionGate`, which is a React component in
`app/src/components/`, and your contract's generated client.

```tsx
import {
  describe,
  isOverCap,
  submitCall,
  xlmTokenId,
  type Grant,
} from "@stellar-scaffold/app-lib"
import { myContract } from "@stellar-scaffold/app-lib/clients"
import { useState } from "react"
import { useWallet } from "../hooks/useWallet"
import { SessionGate } from "./SessionGate"

// Your contract's error codes as words (or your generated client's `Errors`)
const errors = { 1: "Sold out", 2: "Already bought" }
const dailyCap = 2
// One grant per contract the call authorizes for the user
const grants: Grant[] = [
  {
    target: myContract.options.contractId,
    functions: ["buy"],
    duration: "24h",
    label: "my-app",
  },
  {
    target: xlmTokenId,
    functions: ["transfer"],
    duration: "24h",
    limit: { amount: String(dailyCap), period: "day" },
    to: myContract.options.contractId,
    label: "my-app-xlm",
  },
]

export const Buy = () => {
  const { address } = useWallet()
  const [message, setMessage] = useState<string>()
  const onClick = async () => {
    if (!address) return
    try {
      // No await before submitCall: Nido's popup needs the click's gesture
      const { result, hash } = await submitCall(address, (publicKey) =>
        myContract.buy({ user: address }, { publicKey }),
      )
      setMessage(`Done: ${String(result)} in ${hash}`)
    } catch (error) {
      setMessage(
        isOverCap(error)
          ? `That's the ${dailyCap} XLM a day you allowed. Nothing was sent.`
          : describe(error, errors),
      )
    }
  }
  return (
    <SessionGate
      grants={grants}
      explain={
        <p>
          Approve this app once and it can buy for you for 24 hours,
          spending at most {dailyCap} XLM a day, only to this contract.
          Your device asks for the app's passkey on each purchase. Nido
          shows both rules and you confirm them once: the first allows
          only <code>buy</code>; the second caps and restricts the XLM.
        </p>
      }
    >
      <button onClick={() => void onClick()}>Buy</button>
      {message && <p>{message}</p>}
    </SessionGate>
  )
}
```

`submitCall(address, build)` builds the call with a transaction source a
C-address can use, then submits it the right way for the connected wallet:

- a classic G-address wallet signs and sends it;
- a Nido account with an approved session: the device signs with the app's
  passkey (one prompt), and Nido's relayer submits it (`submitWithSession`);
- a Nido account without one: Nido's sign popup, which only covers calls on the
  account itself, so a call into your contract is refused (`#3002` or `#3014`).

It resolves `{ result, hash }` once the transaction is confirmed. The parts are
exported too (`reserveSigningPopup`, `transactionSource`, `submitContract`) if
you need your own flow.

Calls take several seconds. Pass `{ onStage: setStage }` as `submitCall`'s
third argument to show preparation, passkey, sending and confirmation progress
with the template's `Pending` component, and disable the action while it runs.

## What SessionGate shows

`SessionGate` compares the `grants` you pass with what the account has approved
for this app's passkey: target, functions, cap, recipient and expiry. It shows its children to
classic wallets right away, and to a Nido account once its approvals cover
`grants`. Until then it shows one of:

| State | What the owner sees |
| --- | --- |
| No app passkey yet | Your `explain` text and **Make a passkey for this app** |
| Passkey made, grants needed | **Approve with Nido (N rules, one confirmation)** |
| A grant changed (new target, function or cap) | "This needs more than you approved for this app so far." and **Approve** |
| A grant expired | "This app's approval expired." and **Renew with Nido** |
| Making the passkey | "Waiting for your passkey: your device makes one for this app…" |
| Sent to Nido, no answer recorded | **Check again**, **Ask Nido again**, **Start over** |

N is the number of grants still missing. The template sends grants with the
same duration together, in one popup and one passkey confirmation (at most
8 per request). Use a shared duration for a gate's grants; grants with a
different duration wait for a later request. With
`actionsOnly`, the children stay visible and only their buttons and inputs
wait for approval.

Several gates in one app share one passkey. Each asks only for the grants it lacks.
A redeployed contract gets a new ID, so a gate whose grant targets it asks
again.

## Write the explanation

The owner reads your `explain` text before Nido's pages, and Nido's pages show
the rule's terms, not your app's reasons. Say:

- what the app will do (the functions, in plain words);
- for how long (the `duration`);
- the most it can spend, what one action costs, and whom it may pay (`to`);
- that each call asks for the app's passkey;
- why one rule has no cap, if one doesn't. The template sends it as
  [`limit=none`](#nidos-grant-page-parameters): Nido skips the checkbox when
  the grant names no token function. Other uncapped grants ask the owner
  to choose a cap or accept uncapped spending explicitly.

## What the owner sees on Nido

The app sends the owner to
`https://<account>.test.nido.fyi/security/delegate-doc/`. For each grant in the
request, that page shows:

- the contract and the app's key;
- the functions the key may call;
- the expiry, which the owner can change;
- the spending cap in XLM ("Up to 2 XLM per day"), prefilled from your
  `limit`, or the "no cap" checkbox; a `limit=none` grant that names no token
  function reads "No cap — allows no token functions" instead;
- for a grant that may call `transfer`, whom it pays: the one `to` address, or
  "Any address";
- what changes in the account's policy document, and the document itself.

**Review & continue** opens Nido's signing page, the owner confirms with their
passkey, and Nido's relayer applies the change. Then Nido hands `?delegation=ok`
back to your app (see [the return](#nidos-grant-page-parameters) below).
**Cancel** returns `?delegation=cancelled`: the template keeps the app passkey
and anything already approved, and the gate asks again
next time.

Nido's grant page can take up to 8 grants in one request and install them all
with one passkey confirmation. The template uses this for its two-grant sample.

## When the account says no

The account checks every session call against its rules while the call is
simulated, before your app sends anything. A refused call costs nothing.
`describe(error, contractErrors)` turns each refusal into a sentence:

| Code | Cause | `describe` says |
| --- | --- | --- |
| `#3221` | The call would go over a grant's cap | "Your account refused: this would go over the spending cap you gave this app." |
| `#3002`, `#3016` | No rule covers the call, or it expired | "…no approved rule covers this call for this app (it may have expired)." |
| `#3014` | The call touches a contract the app has no rule for | "…the call touches a contract the app has no rule for." |
| `FEE_LIMIT_EXCEEDED` | Nido's relayer budget is used up | "Nido's free transaction budget is used up for now, so nothing was sent." |
| `POOL_CAPACITY` | Nido's relayer is busy | "Nido's relayer is busy, so nothing was sent. Try again in a minute." |
| `Error(Contract, #n)` | Your contract's own error | "The contract refused: " plus the text from `contractErrors` |

Pass a table of your contract's error codes as `contractErrors` (your
generated client's `Errors` table, or your own) so they read as words. Use `isOverCap(error)` when you want to name the cap and
say when it resets, as in the example above; it recognises `#3221` before and
after `describe` has turned it into a sentence.

The template also reads spending records before asking the device to sign.
`CapReachedError` carries an `until` time, and `capReachedUntil` lets a screen
disable its action and show when the cap frees up. On-chain simulation still
enforces the cap; a browser precheck does not replace it.

`#3014` on a call that should be covered usually means a missing grant: a
sub-call, such as the token `transfer`, needs a grant of its own. The template
also stops before sending when no rule for this key covers a contract in the
call, and names the contract.

## When an approval doesn't land

Applying a grant goes through Nido's relayer, which can refuse or time out (see
[Troubleshooting](/docs/troubleshooting/#nido-says-it-couldnt-confirm-what-happened)).
The account's installed rules are the truth, so the template recovers from the
app:

1. The owner goes back to the app. The gate says Nido hasn't confirmed the
   grant yet.
2. **Check again** reads the account's `installed_rules` and records any grant
   that landed, with its real expiry.
3. If nothing landed, **Ask Nido again** reuses the same app passkey. If the
   relayer budget is used up, wait and try later.

The template can record `?delegation=error&code=…`, but Nido's grant page sends
only `ok` and `cancelled` today. A structured grant error return is
<span class="docs-tag">Not available yet</span>. Session-call relayer errors
already reach `describe` in the app.

## Nido's grant page parameters

If you build the session flow yourself instead of using the template, this is
the request Nido's grant page takes. Open
`https://<account>.test.nido.fyi/security/delegate-doc/` with the account's
C-address in lower case as the subdomain, and these query parameters.

Every request names one key, one duration and one return trip:

| Parameter | Required | Value |
| --- | --- | --- |
| `origin` | Yes | Your app's origin (`https://…` or `http://localhost:…`) |
| `return` | Yes | Where to send the owner back; must be on `origin` |
| `signer` | One of the two | A delegated key your app holds: its address (`G…` or `C…`) |
| `pubkey` | One of the two | Your app's passkey: the 65-byte SEC1 uncompressed P-256 public key, in hex (`04…`, no `0x`). A `credential_id` parameter rejects the request; keep the credential ID in your app |
| `duration` | No | `24h`, `7d`, `30d` or `none`; `30d` when absent. Every grant shares it |

Each grant is one rule, with these fields:

| Field | Required | Value |
| --- | --- | --- |
| `target` | Yes | The contract (`C…`) the key may call |
| `functions` | No | Comma-separated function names; every function when absent |
| `limit` | No | A cap on `transfer` amounts in decimal XLM, or `none` |
| `limit_period` | No | `day`, `week` or `30d`, only with a decimal `limit`; `day` when absent |
| `to` | No | The only address (`G…` or `C…`) the grant's `transfer` may pay; only when `functions` is exactly `transfer`. Without it, a transfer grant can pay any address, up to its cap |
| `label` | See below | The rule's name. The same name replaces that rule |

For one grant, pass the fields as plain parameters (`target=…&functions=…`);
`label` defaults to `session`. For several, pass each as `grant.<i>.<field>`,
numbered from 0 with no gaps, at most 8 grants. Each then needs its own
`label`, and the plain grant fields may not appear alongside. Nido installs
them all in one policy-document update (one `apply_doc`), with one passkey
confirmation.

Without `limit`, the owner chooses between a cap and ticking "Let this key
spend without any cap". `limit=none` declares the rule uncapped and skips
that tick, but only when the grant lists its `functions` and none of them is a
token function (`transfer`, `transfer_from`, `approve`, `burn`, `burn_from`,
`mint`, `clawback`, `set_authorized`, `set_admin`). Any other `limit=none`
grant is shown as one without `limit`.

A game whose `guess` moves a 1 XLM stake from the player, approved with one
confirmation:

```text
?origin=https://game.example&return=https://game.example/play
&pubkey=04…&duration=24h
&grant.0.label=guess&grant.0.target=CGAME…&grant.0.functions=guess
&grant.0.limit=none
&grant.1.label=guess-xlm&grant.1.target=CXLM…&grant.1.functions=transfer
&grant.1.limit=2&grant.1.limit_period=day&grant.1.to=CGAME…
```

A malformed value of a known parameter (`duration`, `signer` or `pubkey`, or a
grant's `target`, `limit`, `limit_period` or `to`), or an unknown
`grant.<i>.<field>` key, rejects the whole request, so a bad cap can't turn
into an uncapped grant. Any other unknown parameter is ignored: a typo such as
`limit_peroid=week` is dropped and the default (`day`) applies. Avoid `duration=none`: revoking is not
available yet, so such a rule would never end.

The answer is `?delegation=ok` or `?delegation=cancelled`. Opened as a popup,
the page (and the signing page after it) posts
`{ source: "nido-wallet", search: "?delegation=ok" }` to the opener, targeting
your `origin`, and closes. Opened as a page, it redirects to the return URL
with that query added. Treat `ok` as "the page finished", and read the
account's `installed_rules` to see what landed.

The template uses `pubkey`, keeps the credential id locally for WebAuthn, and
omits `credential_id` from the request. For later calls, it reads the
installed rules and policy document, selects rules for the contracts and
functions being authorized, and signs the account's authorization digest with
the app passkey. It reads `capabilities().auth_digest` to choose the digest
scheme (`addr_oz_v1` or the older `oz_rule_ids`). The WebAuthn assertion and
rule ids go into an ordinary authorization entry, which is simulated before
the app hands it to Nido's relayer. The template's `submitWithSession` in
`app-lib/session.ts` is the complete example.

`signer=` is a separate delegated-key path. A CAP-0071 `AddressWithDelegates`
entry needs delegated signatures and a compatible submission path; do not
substitute it for the template's passkey flow.
