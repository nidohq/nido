# Add Nido to a Stellar Wallets Kit dApp

This walkthrough assumes you already have a dApp wired to
[`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
— a `modules` array, a connect button, and a sign flow. Adding Nido is a small
diff to that setup plus a few smart-account realities to handle.

If you do **not** have the kit yet, start from its
[docs](https://github.com/Creit-Tech/Stellar-Wallets-Kit) and come back here.

## What you get

[`@nidohq/stellar-wallets-kit-module`](../packages/stellar-wallets-kit-module/README.md)
registers a **Nido passkey smart account** as a first-class wallet in the kit's
picker. Your dApp gets Nido alongside Freighter / xBull / Albedo / etc. with no
Nido-specific UI — the same `getAddress` / `signTransaction` calls you already
make.

One constraint to know before you start: **a Nido account is a Soroban smart
account (a C-address contract), not a classic keypair.** It signs Soroban
transactions, messages, and auth entries. It **cannot** be the source/signer of
a classic Stellar operation — there's nothing for a passkey to sign there.

## Step 1 — Install the module

```bash
npm install @nidohq/stellar-wallets-kit-module
```

(`@creit.tech/stellar-wallets-kit` is already a dependency of your dApp.)

## Step 2 — Register the module

Add `NidoModule` to the `modules` array you pass when initialising the kit:

```ts
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit';
import { NidoModule } from '@nidohq/stellar-wallets-kit-module';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

StellarWalletsKit.init({
  modules: [
    new NidoModule({
      base: import.meta.env.PUBLIC_NIDO_BASE ?? 'https://nido.fyi',
      networkPassphrase: TESTNET_PASSPHRASE,
    }),
    // ...your existing standard modules (Freighter, xBull, Albedo, ...)
  ],
});
```

> Using the older constructor-based kit API (`new StellarWalletsKit({...})`,
> `allowAllModules()`)? Put `new NidoModule({...})` in that same `modules` array
> — the registration is identical. The static `StellarWalletsKit.init(...)` shape
> above matches kit **2.2.x**.

### The `base` value

`base` is the **Nido deployment apex**. The module runs at *your* origin and
can't infer it, so you must supply it. Keep it configurable via env so dev and
prod differ without a code change:

| Environment            | `base` value                       |
| ---------------------- | ---------------------------------- |
| Hosted testnet wallet  | `https://nido.fyi`                 |
| Local wallet dev server| `http://localhost:4321`            |
| Custom deployment      | `https://your-nido-domain.example` |

```dotenv
PUBLIC_NIDO_BASE="https://nido.fyi"
```

## Step 3 — Connect

Your existing connect path works unchanged. When the user picks Nido, the module
opens `<base>/connect/` (the apex account picker), the user chooses one of the
smart accounts on that device, and you get a **C-address** back:

```ts
// Whichever you already use:
const { address } = await StellarWalletsKit.authModal();   // selector modal
// or
const { address } = await StellarWalletsKit.getAddress();  // after setWallet(NIDO_ID)
```

Two behaviors specific to Nido:

- **The picker reopens on every connect** (popup-always). The previously chosen
  address is passed as `previous` so the picker highlights it; a device with
  exactly one matching account auto-confirms without UI. This makes every
  reconnect a chance to switch accounts. Pass `skipRequestAccess: true` to read
  the cached address only (no popup; throws if empty).
- **The C-address is just an identifier** (non-secret). The module caches it in
  *your* origin's `localStorage`.

## Step 4 — Sign and submit

`signTransaction` opens `<account>.<base>/sign/`, runs the passkey ceremony
there (the WebAuthn `rpId` must match the account subdomain), and posts the
signed XDR back. **Your dApp submits it** as usual:

```ts
const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
  address,                          // the connected C-address
  networkPassphrase: TESTNET_PASSPHRASE,
});

// Submit signedTxXdr with your Stellar RPC client.
```

`signMessage` and `signAuthEntry` work the same way (popup + passkey).

**Soroban only.** `signTransaction` expects a Soroban transaction (a single
`InvokeHostFunction` op): it simulates to find the smart account's auth entry,
computes the OZ auth digest, gets a WebAuthn assertion, and injects the passkey
signature. A **classic** Stellar transaction is rejected with a clear error —
build a Soroban invocation instead.

## Step 5 — Handle "use a different account"

The sign ceremony is structurally bound to one account (the `rpId` is that
account's subdomain), so it can't switch in place. The sign page offers **"Use a
different account"**, which makes the sign call reject with an error whose `name`
is `ACCOUNT_SWITCH_REQUESTED` after clearing the cached address. Catch it,
re-connect, rebuild the transaction for the new account, and retry:

```ts
import { ACCOUNT_SWITCH_REQUESTED } from '@nidohq/stellar-wallets-kit-module';

try {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
    address,
    networkPassphrase: TESTNET_PASSPHRASE,
  });
  // submit signedTxXdr
} catch (err) {
  if (err instanceof Error && err.name === ACCOUNT_SWITCH_REQUESTED) {
    const { address: next } = await StellarWalletsKit.authModal();
    // rebuild the tx for `next`, then sign again
  } else {
    throw err;
  }
}
```

`ACCOUNT_SWITCH_REQUESTED` is also exported as the `AccountSwitchRequestedError`
class if you prefer `instanceof`.

## Gotchas

| Symptom | Cause / fix |
| --- | --- |
| Popup never opens | Connect and sign use a popup + `postMessage`. Allow popups for your dApp's origin. |
| "Passkeys unavailable" / `navigator.credentials` undefined | WebAuthn needs a secure context. Serve over HTTPS or `localhost`; plain `http://<hostname>` disables it. |
| Connect picker shows no accounts | Create a Nido account on that same device/browser profile first, then reconnect. |
| Balances 404 / don't load | A C-address is **not** a classic Horizon account — `/accounts/<C…>` 404s. Read native XLM as a Stellar Asset Contract balance over RPC; only classic G-addresses go through Horizon. |
| Classic tx fails to sign | Expected — build a Soroban transaction or auth entry. |
| Local subdomains don't resolve | Use `*.localhost` URLs (e.g. `<c-address>.localhost:4321`) and set `PUBLIC_NIDO_BASE="http://localhost:4321"`. |

## Full working example

[`examples/status-message-dapp`](../examples/status-message-dapp/README.md) is a
complete React + Vite dApp that registers Nido in the kit picker and signs a
Soroban status-message transaction. Files worth cribbing from:

- `src/util/wallet.ts` — kit init with `NidoModule`, connect/disconnect, and the
  `ACCOUNT_SWITCH_REQUESTED` handling shown above.
- `src/util/moduleOrder.ts` — the "Nido first" ordering helper (unit-tested).
- `src/providers/WalletProvider.tsx` — per-wallet behavior flags (popup-always,
  network detection) for a multi-wallet app.

See also the module's own [README](../packages/stellar-wallets-kit-module/README.md)
for the design rationale (transport, anti-redirect-abuse, kit interface version).
