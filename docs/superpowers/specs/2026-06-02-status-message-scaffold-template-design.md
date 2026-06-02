# Status Message scaffold template — design

**Date:** 2026-06-02
**Status:** Implemented — `examples/status-message-dapp/`

## Implementation notes / verification

- Generated with `stellar-scaffold init` (React + Vite); sample contracts removed,
  `status-message` vendored under `contracts/status-message` (typo fixed).
- Joined the **root npm workspace** (not `file:` links): passkey-sdk itself depends
  on the repo's `smart-account`/`multisig-policy` workspace packages and peers
  `@stellar/stellar-sdk@^15`, so only a shared install resolves the full tree
  (`@creit` kit v2.2.0 peer, `@noble/curves@2.2.0` for the passkey crypto, etc.).
- Kit v2.2.0 is a fully **static** API (`StellarWalletsKit.init`/`authModal`);
  `WalletNetwork` → `Networks`; `allowAllModules()` removed. `src/util/wallet.ts`
  and `WalletProvider.tsx` adapted accordingly (the scaffold default shipped v1.9.5).
- Verified: contract built + deployed to testnet
  (`CBXVJXHPSYORSAHPX4I6NYPQMDJWK2STQCE6JTIM7FNV4OZSIDJFGNDM`), client generated,
  `tsc` clean, `vitest` (2) green, `vite build` succeeds, and a browser smoke test
  shows the picker opening with **g2c listed first** ahead of the standard wallets
  (`docs/wallet-selector.png`).

## Goal

A fresh, self-contained [stellar-scaffold](https://github.com/theahaco/scaffold-stellar)
project (React + Vite, the scaffold default) at `examples/status-message-dapp/`
that demonstrates a third-party dApp which:

- offers the **wallet selector** (`@creit.tech/stellar-wallets-kit`) with the
  **g2c passkey smart account** (`@g2c/stellar-wallets-kit-module`) registered
  alongside the standard wallets (Freighter, xBull, Albedo, LOBSTR, Rabet, Hana), and
- reads/writes the on-chain **status message** of the connected account via the
  scaffold-generated TS contract client.

Serves three purposes at once: proves the wallet-kit-module integration
end-to-end, gives developers a copy-pasteable starter, and is a runnable testnet
demo for manual QA.

## Layout

```
examples/status-message-dapp/
  Cargo.toml                 # own cargo workspace, members = ["contracts/*"]
  contracts/status-message/  # self-contained COPY of the contract (deps pinned,
                             #   no workspace-inheritance to the g2c root)
  environments.toml          # development (local) + testing (testnet)
  package.json               # npm app; @g2c/* consumed via the repo npm workspace
  vite.config.ts, src/...    # scaffold React app
```

Two couplings, deliberately different:

- **npm: workspace-linked.** Consumes `@g2c/stellar-wallets-kit-module` and
  `@g2c/passkey-sdk` from this repo's npm workspace (the example dir is added to
  the root `workspaces`).
- **cargo: decoupled (vendored copy).** `contracts/status-message` inherits
  `workspace = true` deps from the g2c root and cannot cleanly belong to two
  cargo workspaces, so the example carries a small self-contained copy with deps
  pinned directly. The copy also lets us fix the `udpate_message` → `update_message`
  typo without touching the canonical contract or its existing deployment. The
  example README points back to the canonical source.

## Wallet selector (the one real piece of glue)

The scaffold default ships kit **v1.9.5** (`allowAllModules()` + `kit.openModal`).
The g2c module needs kit **v2.x**. This repo already solved v2 integration in
`packages/frontend/src/lib/walletConnect.ts` + `walletModules.ts`. So:

- bump the example to `@creit.tech/stellar-wallets-kit@^2.2.0`,
- rewrite `src/util/wallet.ts` to the v2 API (`StellarWalletsKit.init` /
  `authModal`), registering `standardModules()` **+ `new G2cModule({ base })`**,
  ported from the existing walletConnect pattern,
- keep the scaffold's `WalletProvider` / `ConnectAccount` / `WalletButton` React
  structure, adapting calls to the v2 surface,
- `base` (the g2c apex, `mysoroban.xyz`) is read from `PUBLIC_G2C_BASE`,
  defaulting to `https://mysoroban.xyz`.

## Contract build/deploy from source

`environments.toml` declares `status_message = { client = true }` (no
constructor). `npm start` runs `stellar scaffold watch --build-clients`, which
builds the vendored contract, deploys it (local for `development`, testnet for
`testing`), generates the TS client into `packages/` + `src/contracts/`. The
build sets `SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1` (soroban-sdk 26
requirement, mirroring the repo justfile).

## UI / data flow

`StatusMessage.tsx`, modeled on the scaffold's `GuessTheNumber.tsx`:

- **Read:** `get_message(author)` simulated (read-only) for the connected
  address (or a typed C/G-address) → renders the current message.
- **Write:** textarea → `update_message({ message, author })` →
  `signAndSend({ signTransaction })`. For a g2c account the kit routes signing
  through the passkey ceremony; for classic wallets it is a normal signature.

## Testing

- Unit: `wallet.test.ts` asserting the selector registers the g2c module
  alongside the standard set (mirrors existing `walletConnect.test.ts`),
  headless.
- Manual QA on testnet for the full passkey round-trip (documented in the app
  README) — the e2e flow needs a real WebAuthn ceremony.
