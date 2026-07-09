# Wallet-determinism spike matrix (M2 "wallet" recovery de-risk)

Status: **synthetic crypto path PROVEN** (see `sep53-verify.mjs`). **Live wallet
rows below are UNVERIFIED and require a human with the relevant browser
extensions installed** — this cannot be automated or completed by an agent.

## Why this matters

The "M2 wallet" recovery method derives an account-recovery secret from a
wallet's ed25519 signature over a fixed message. This only works if, for a
given wallet + key:

1. The wallet's `signMessage` call is **deterministic**: signing the exact
   same message twice with the exact same key returns byte-identical
   signatures (this is what RFC 8032 ed25519 guarantees *in principle*, but
   wallet extensions can break it — e.g. by adding a nonce/salt, prompting a
   PIN each time on a hardware signer, or wrapping the message differently
   between calls).
2. The signature **verifies under the SEP-53 preimage**
   (`sha256("Stellar Signed Message:\n" || message)`) against the public key
   encoded in the wallet's own G-address. If a wallet uses a different
   preimage / wrapping scheme, verification against the standard SEP-53
   preimage will fail even though the wallet itself is internally consistent.

`tests/spikes/sep53-verify.mjs` proves the math (SEP-53 preimage + ed25519
sign/verify + StrKey G-address round-trip) is correct and deterministic using
a synthetic, locally generated ed25519 keypair — no browser or wallet
extension involved. It does **not** prove that any given browser wallet
extension actually returns a deterministic, SEP-53-compatible signature. That
requires a human to run the procedure below against each real wallet.

## The exact fixed message (design spec §2.1)

Verbatim, UTF-8 encoded, `\n` = `0x0A` line separator, **no trailing
newline**:

```
nido-recovery-v1
account: <C-address>
network: <network passphrase>
purpose: derive this nido account's recovery secret
warning: only sign this inside the official nido enrollment or recovery flow
```

Where `<C-address>` is the nido smart account's contract address (`C...`)
and `<network passphrase>` is the Stellar network passphrase being used
(e.g. `Test SDF Network ; September 2015` for testnet, or
`Public Global Stellar Network ; September 2015` for mainnet).

## The SEP-53 preimage

```
sha256(utf8("Stellar Signed Message:\n") || utf8(message))
```

This 32-byte digest is what the wallet's `signMessage` implementation
actually signs with ed25519 (per SEP-53). `sep53Preimage(msg)` in
`sep53-verify.mjs` computes this exact value.

## Procedure to test a real wallet (human required)

This cannot be run by an agent — it requires a real browser session with the
wallet extension installed, unlocked, and holding (or able to generate) a
Stellar keypair. Use `StellarWalletsKit` (already a dependency of the
frontend) to talk to each wallet uniformly.

1. **Set up.** In a scratch page/script with `@creit.tech/stellar-wallets-kit`
   (or whatever the repo's actual SWK import is), connect the target wallet
   and note the account's `G...` address.
2. **Build the exact fixed message** from the template above, substituting
   a real (or realistic placeholder) `C...` address and the network
   passphrase you're testing against.
3. **Sign it once:**
   ```js
   const { signedTxXdr, signerAddress } = await kit.signMessage(message, {
     address: gAddress,
   });
   ```
   (Confirm the actual SWK API shape for `signMessage` at the time of testing
   — some versions return `{ signedMessage }` as base64, not
   `signedTxXdr`/`signerAddress`; check the installed
   `@creit.tech/stellar-wallets-kit` version's types.) Record whether the
   wallet **returns a signature at all** — some wallets do not implement
   `signMessage` and will throw/reject.
4. **Sign it again**, same message, same account, same session (and ideally
   also after locking/reopening the extension, since some wallets are only
   deterministic within a session).
5. **Compare the two raw signature byte strings for exact equality.** This is
   the "double-sign-identical?" column.
6. **Verify under SEP-53** using this repo's helper:
   ```js
   import { verifySep53 } from './sep53-verify.mjs';
   const ok = verifySep53(gAddress, message, sigBytes); // must be true
   ```
   If the wallet returns base64/hex, decode to raw bytes first. If the
   wallet wraps or re-hashes the message differently than SEP-53 (known
   concern for some wallets — see Albedo note below), this step will fail
   even though the wallet's own internal verification would pass; note that
   distinction in the verdict.
7. **Record the verdict**: PASS only if the wallet (a) returns a signature,
   (b) is byte-identical across repeated signs, and (c) verifies under the
   standard SEP-53 preimage against its own G-address.

## Results table

All rows are **UNVERIFIED — needs human with extension** until someone
actually runs the procedure above against each wallet and fills in real
results. The "expected" column below is a prior/hypothesis based on how each
wallet is known to be implemented, not a measured result — do not treat it as
a pass.

| Wallet  | Returns signature? | Double-sign identical? | SEP-53 verify? | Verdict | Notes / expected |
|---------|---------------------|-------------------------|-----------------|---------|-------------------|
| Freighter | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | Expected: deterministic ed25519 signMessage, SEP-53-compliant. Expected verdict: PASS. |
| xBull | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | Expected: deterministic ed25519 signMessage, SEP-53-compliant. Expected verdict: PASS. |
| Albedo | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | Expected: may wrap/format the message differently before signing (web-based signer, historically inconsistent with SEP-53 preimage in some flows). Expect possible verify failure against the raw SEP-53 preimage even if internally deterministic — needs explicit check of Albedo's actual signing payload. |
| Lobstr | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | No strong prior; mobile/extension bridge behavior unconfirmed. |
| Rabet | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | No strong prior; confirm signMessage support exists at all. |
| Hana | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | No strong prior; confirm signMessage support exists at all. |

Additional expected case to check when a hardware-backed account is
available: **Ledger-backed accounts (via Freighter/xBull/etc. using a Ledger
device as the signer) are likely NONDETERMINISTIC** for this purpose —
Ledger's ed25519 implementation, PIN/confirmation flow, or an
intermediating deterministic-nonce scheme may not guarantee byte-identical
signatures across two separate physical confirmations the way a pure
software RFC 8032 signer does. If M2 recovery needs to support
hardware-wallet-backed accounts, this must be explicitly tested and is a
likely candidate for **not** being supported by the M2 method (or requiring
a fallback / different derivation that doesn't depend on repeat-signature
determinism).

## Handoff

- [ ] A human with Freighter, xBull, Albedo, Lobstr, Rabet, and Hana
      installed (and, ideally, a Ledger device paired to one of the
      software wallets) must run the procedure above and fill in the table.
- [ ] If any wallet fails the SEP-53-verify step but is otherwise
      deterministic, investigate whether it's using a non-standard preimage
      (e.g. no `"Stellar Signed Message:\n"` prefix, different hashing, or
      transaction-envelope wrapping instead of SEP-53) and whether that can
      be special-cased.
  - [ ] If any wallet is nondeterministic across repeated signs, it is not a
      viable signer for the M2 recovery method as currently designed; that
      wallet (or wallet class, e.g. "Ledger-backed") should be excluded from
      the M2 recovery path and flagged in the product-facing wallet support
      matrix.
