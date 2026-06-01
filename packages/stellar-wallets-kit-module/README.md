# @g2c/stellar-wallets-kit-module

A [`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
module that registers a **g2c passkey smart account** as a first-class Stellar
wallet. With it, any dApp that already uses the kit's wallet picker gets g2c
alongside Freighter / Albedo / xBull / etc. — no g2c-specific code required.

## Install

```bash
npm install @g2c/stellar-wallets-kit-module @creit.tech/stellar-wallets-kit
```

## Usage

```ts
import { StellarWalletsKit, allowAllModules } from '@creit.tech/stellar-wallets-kit';
import { G2cModule } from '@g2c/stellar-wallets-kit-module';

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: [
    ...allowAllModules(),
    // `base` is the g2c deployment domain. The module runs at YOUR origin and
    // can't infer it, so it must be supplied. Use a scheme for local dev.
    new G2cModule({ base: 'g2c.example.xyz' }),
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

This module reuses g2c's established "wallet at `<account>.<base>`, dApp at
another origin, redirect + return" pattern (the same one the session-key
delegate flow uses).

- **`getAddress()`** opens the apex `/connect/` account picker in a popup. The
  user chooses one of the smart accounts registered on that device; the picker
  posts the **C-address back** (non-secret — it's just an identifier) and the
  module caches it in the **dApp origin's** `localStorage`. Subsequent calls
  return the cached address without re-prompting (pass `skipRequestAccess` to
  read-cache-only).
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
  A **classic** Stellar tx is rejected with a clear error — a g2c smart account
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
`disconnect`). `g2c` reports as a `HOT_WALLET`.
