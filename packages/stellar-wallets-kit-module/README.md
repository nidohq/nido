# @nidohq/stellar-wallets-kit-module

A [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
module that registers a **Nido passkey smart account** as a first-class Stellar
wallet. With it, any dApp that already uses the kit's wallet picker gets Nido
alongside Freighter / Albedo / xBull / etc. with no Nido-specific code required.

> **New here?** For a step-by-step integration walkthrough, see
> [docs/ADD-NIDO-TO-DAPP.md](../../docs/ADD-NIDO-TO-DAPP.md). The reference below
> covers the API surface.

## Install

```bash
npm install @nidohq/stellar-wallets-kit-module @creit.tech/stellar-wallets-kit
```

## Usage

```ts
import { StellarWalletsKit, allowAllModules } from '@creit.tech/stellar-wallets-kit';
import { NidoModule } from '@nidohq/stellar-wallets-kit-module';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [
    ...allowAllModules(),
    // `base` is the Nido deployment domain. The module runs at YOUR origin and
    // can't infer it, so it must be supplied. Use a scheme for local dev.
    new NidoModule({ base: 'nido.example.xyz' }),
  ],
});

// getAddress → opens the apex /connect/ picker, caches the chosen C-address
const { address } = await kit.getAddress();

// signTransaction → opens <address>.<base>/sign/, runs the passkey ceremony
const { signedTxXdr } = await kit.signTransaction(xdr, {
  networkPassphrase: 'Test SDF Network ; September 2015',
});
```

## How it works (design decisions)

This module uses Nido's "wallet at `<account>.<base>`, dApp at
another origin, redirect + return" pattern (the same one the session-key
delegate flow uses).

- **`getAddress()`** opens the apex `/connect/` account picker in a popup. The
  user chooses one of the smart accounts registered on that device; the picker
  posts the **C-address back** (non-secret — it's just an identifier) and the
  module caches it in the **dApp origin's** `localStorage`. The picker opens on
  **every** `getAddress()` call — the previously connected address is passed as
  `previous` so the picker highlights it, and devices with exactly one account
  (matching `previous`) auto-confirm without showing UI. This makes every
  reconnect a chance to switch accounts instead of silently re-binding to the
  first one ever picked. Pass `skipRequestAccess: true` to read the cache only
  (no popup; throws if empty). The SEP-43 `path` param is accepted but unused —
  there's no derivation path to select.
- **`signTransaction` / `signMessage` / `signAuthEntry`** open
  `<account>.<base>/sign/` in a popup and run the **primary-passkey ceremony**
  there (WebAuthn `rpId` must match the account subdomain, so the ceremony has
  to run at that origin). The signed artifact is posted back.
- **Round-trip transport: popup + `postMessage`.** The kit's methods are
  Promises that must *resolve with a value*, which a full-page redirect can't
  do (it tears down the calling page). So the wallet pages post their result
  back to the opener and self-close. A full-page-redirect fallback
  (`redirectTopLevel` + the `parse*Return` helpers) is exported for callers
  that can re-read on navigation.
- **Switching accounts.** The sign ceremony is structurally bound to one
  account (the WebAuthn `rpId` is that account's subdomain), so it can never
  switch in place. The sign page instead offers **"Use a different account"**,
  which makes the sign method reject with an error whose `name` is
  `ACCOUNT_SWITCH_REQUESTED` (exported, also as the `AccountSwitchRequestedError`
  class) after clearing the cached address. Catch it to re-run connect and
  rebuild the transaction for the newly picked account:

  ```ts
  import { ACCOUNT_SWITCH_REQUESTED } from '@nidohq/stellar-wallets-kit-module';

  try {
    await kit.signTransaction(xdr, opts);
  } catch (e) {
    if (e instanceof Error && e.name === ACCOUNT_SWITCH_REQUESTED) {
      const { address } = await kit.getAddress(); // user picks another account
      // rebuild the tx for `address`, then retry signTransaction
    } else throw e;
  }
  ```

  Alternatively (or additionally), a dApp can offer switching at connect time
  by calling `kit.disconnect()` before re-connecting (the Authline pattern) —
  with this module that's optional, since the picker reopens on every connect
  anyway.
- **Anti-redirect-abuse.** Every handover URL carries the dApp `origin` and a
  same-origin `return` URL; the wallet pages refuse to post results to any
  other origin, and `postMessage` is targeted + origin-checked on receipt.
- **Authorisation surface = confirm-every-signing.** Matching the wallet's
  current paranoia, each sign shows a confirmation page. Persistent per-dApp
  grants are out of scope (a later session-key extension).
- **Soroban vs classic txs.** `signTransaction` handles a Soroban tx (single
  `InvokeHostFunction` op): it simulates to find the smart account's auth
  entry, computes the OZ v0.7 auth digest, gets a WebAuthn assertion, and
  injects the passkey signature, returning the signed XDR (the dApp submits).
  A **classic** Stellar tx is rejected with a clear error: a Nido smart account
  is a contract (C-address) and can't be the source/signer of a classic
  operation, so there's nothing for the passkey to sign there.

## Module split

The pure, unit-tested logic lives in `urls.ts` (handover URL construction) and
`handover.ts` (return parsing + the address cache). The browser-only redirect
glue (`redirect.ts`) and the `ModuleInterface` implementation (`module.ts`) are
kept thin on top of it.

## Kit interface version

Implemented against `@creit.tech/stellar-wallets-kit` **2.2.0**'s
`ModuleInterface` (`moduleType`, `productId/Name/Url/Icon`, `isAvailable`,
`getAddress`, `signTransaction`, `signMessage`, `signAuthEntry`, `getNetwork`,
`disconnect`). Nido reports as a `HOT_WALLET`.
