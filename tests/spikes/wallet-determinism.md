# Wallet-determinism spike matrix (M2 "wallet" recovery de-risk)

Status: **synthetic crypto path PROVEN** (see `sep53-verify.mjs` and
`wallet-determinism-check.mjs --self-test`). **Live wallet rows below are
UNVERIFIED and require a human with the relevant browser extensions
installed** — this cannot be automated or completed by an agent/CI.

This is the M4 update of the M0 spike: it now targets the ACTUAL wallet
enrollment flow shipped in `packages/frontend/src/pages/new-account/
index.astro` (the `$enrollWalletBtn` handler), not just the underlying
math. The checklist below tells a human tester exactly what to click and
what to paste into the new helper script.

## IMPORTANT — a gap in the app, not just in this test

As of this writing, the app's wallet-enrollment code path (`new-account/
index.astro`, around the `$enrollWalletBtn` click handler) signs the M2
message **once**:

```js
const { signedMessage } = await StellarWalletsKit.signMessage(
  m2Message(contractId, NETWORK_PASSPHRASE),
  { address: session.walletAddress, networkPassphrase: NETWORK_PASSPHRASE },
);
const sig64 = base64ToBytes(signedMessage);
enrollSecret = deriveSecretM2(sig64, contractId, NETWORK_PASSPHRASE);
```

It does **not** currently sign twice, byte-compare, or locally SEP-53-verify
the signature before committing to `enrollSecret` — i.e. the "enrollment-time
safety check that refuses M2 on a nondeterministic/non-SEP-53 wallet and
offers the seed-method (M1) fallback" does not exist in the app yet. This
matrix (and `wallet-determinism-check.mjs`) is written as if that check
exists, because it SHOULD — the results below are exactly what that check
would need to compute — but until it's implemented, **an enrollment through a
nondeterministic wallet would currently succeed silently and produce an
unrecoverable account** (the stored commitment would only ever match a
secret derived from that one signature; a real recovery later, needing a
fresh signature from the same wallet, would get a different (non-matching)
`sig64` and therefore the wrong secret).

**Action for whoever picks this up next:** wire the double-sign +
byte-compare + SEP-53-verify check (this file's Step 2 below, and
`wallet-determinism-check.mjs`'s `checkSignatures()`) into
`$enrollWalletBtn`'s handler itself, refusing the wallet method and falling
back to the seed-word (M1) path on any failure. Until then, treat every
`enrollMethod === "wallet"` account created against a FAIL-verdict wallet
(see table below) as **at risk of being permanently unrecoverable** via M2.

## Why this matters

The "M2 wallet" recovery method derives an account-recovery secret
(`deriveSecretM2`, in `packages/passkey-sdk/src/zkRecovery/derivation.ts`)
from a wallet's ed25519 signature over a fixed message
(`m2Message(account, networkPassphrase)`, same file). This only works if,
for a given wallet + key:

1. The wallet's `signMessage` call is **deterministic**: signing the exact
   same message twice with the exact same key returns byte-identical
   signatures (this is what RFC 8032 ed25519 guarantees *in principle*, but
   wallet extensions can break it — e.g. by adding a nonce/salt, prompting a
   PIN each time on a hardware signer, or wrapping the message differently
   between calls). The **entire** M2 method depends on this: enrollment
   derives `enrollSecret` from ONE signature; a real recovery later derives
   the secret again from a FRESH signature and needs it to match the
   commitment made at enrollment time.
2. The signature **verifies under the SEP-53 preimage**
   (`sha256("Stellar Signed Message:\n" || message)`) against the public key
   encoded in the wallet's own G-address. If a wallet uses a different
   preimage / wrapping scheme, verification against the standard SEP-53
   preimage will fail even though the wallet itself is internally consistent.

`tests/spikes/sep53-verify.mjs` proves the math (SEP-53 preimage + ed25519
sign/verify + StrKey G-address round-trip) is correct and deterministic using
a synthetic, locally generated ed25519 keypair — no browser or wallet
extension involved. `tests/spikes/wallet-determinism-check.mjs` extends that
into a paste-in checker that also reproduces `deriveSecretM2` from the real,
built `@nidohq/passkey-sdk`. Neither proves that any given browser wallet
extension actually returns a deterministic, SEP-53-compatible signature —
that requires a human to run the procedure below against each real wallet,
through the app's own wallet-connect path.

## The exact fixed message (byte-exact, from `derivation.ts::m2Message`)

Verbatim, UTF-8 encoded, `\n` = `0x0A` line separator, **no trailing
newline** — this is what the tester should see the wallet display/confirm
when it prompts to sign:

```
nido-recovery-v1
account: <C-address>
network: <network passphrase>
purpose: derive this nido account's recovery secret
warning: only sign this inside the official nido enrollment or recovery flow
```

Where `<C-address>` is the nido smart account's contract address (`C...`)
— the test account used for this ceremony — and `<network passphrase>` is
the Stellar network passphrase being used, e.g. `Test SDF Network ;
September 2015` for testnet (use testnet for this whole matrix; there is no
reason to risk a mainnet key on an unverified wallet).

If what the wallet shows you to sign does **not** match this text exactly
(extra wrapping, different line endings, a prefix/suffix the wallet adds),
note it in the "Notes" column even if the signature still verifies — it's a
sign the wallet may not be strictly SEP-53-compliant.

## The SEP-53 preimage

```
sha256(utf8("Stellar Signed Message:\n") || utf8(message))
```

This 32-byte digest is what the wallet's `signMessage` implementation
actually signs with ed25519 (per SEP-53). `sep53Preimage(msg)` in
`sep53-verify.mjs` computes this exact value; `wallet-determinism-check.mjs`
reuses it internally via `verifySep53`.

## Procedure to test a real wallet (human required)

This cannot be run by an agent — it requires a real browser session with the
wallet extension installed, unlocked, and holding (or able to generate) a
Stellar keypair, exercised through the **app's actual UI**, not a scratch
script, so the result reflects exactly what a real user's enrollment would
do.

### Step 0 — get a test account and the helper ready

1. Deploy (or reuse) a disposable testnet Nido smart account to get a real
   `C...` address to substitute into the message above. (Any testnet
   account works — this ceremony never submits a transaction, it only signs
   a message; you do not need to actually enroll this account for real.)
2. From the repo root, sanity-check the helper before trusting it:
   ```
   node tests/spikes/wallet-determinism-check.mjs --self-test
   ```
   This must print `SELF-TEST PASSED` (exit code 0) — it proves the checker's
   own byte-compare / SEP-53-verify / `deriveSecretM2`-reproduction logic is
   correct, including a negative control that deliberately corrupts one
   signature byte and confirms every assertion correctly flips to FAIL. If
   this fails, stop — do not trust results from a broken checker.

### Step 1 — sign through the real app, twice

1. Open the Nido frontend's account-creation flow (`new-account`) in a
   browser with the target wallet extension installed and unlocked — OR, if
   testing against an already-created account, use whatever surface in the
   app re-invokes the same `StellarWalletsKit.signMessage(m2Message(...))`
   call (the "add a wallet-based backup" / re-enroll path, if present; the
   `new-account` "Back yourself up with a wallet" step is the primary one as
   of M4 Task 3).
2. Click through to the wallet-enrollment option; connect the target wallet
   when the picker (`initWalletKit`/`connectWallet`, `walletConnect.ts`)
   opens. Note the wallet's **G-address** shown/returned (`session.
   walletAddress`) and the **wallet's own version number** (from the
   extension's UI, e.g. "Freighter v5.x").
3. **Record whether the wallet returns a signature at all** — some wallets
   do not implement `signMessage` and will throw/reject; that alone is a
   verdict of FAIL ("no signMessage support") for the "Returns signature?"
   column, and there's nothing further to test for that wallet.
4. If it signs: capture the exact base64 string the app received (temporarily
   add a `console.log(signedMessage)` right after the `StellarWalletsKit.
   signMessage(...)` call in `new-account/index.astro`, or use the browser's
   devtools to inspect it — **do not commit that debug log**; revert it
   before finishing). This is `sig1`.
5. Reload the page (fresh session) and repeat the exact same steps — same
   wallet, same account, same message — to get `sig2`. Prefer testing after
   fully closing/reopening the extension (not just the tab) at least once,
   since some wallets are only deterministic within a single unlock session.

### Step 2 — check the two signatures

```
node tests/spikes/wallet-determinism-check.mjs \
  --account <the C-address you used> \
  --gaddress <the wallet's G-address> \
  --sig1 <base64 sig from the first sign> \
  --sig2 <base64 sig from the second sign> \
  --network testnet
```

This checks, independently of the app:
- **Double-sign identical?** `sig1 === sig2`, byte-for-byte.
- **SEP-53 verify?** Each signature independently verifies under the SEP-53
  preimage of the exact message above, against the wallet's own G-address —
  re-derived from scratch, not trusting the wallet's own claim of validity.
- **`deriveSecretM2` reproduces the same secret?** Feeds each signature
  through the REAL, built `@nidohq/passkey-sdk`'s `deriveSecretM2` (the exact
  function the app calls) and confirms both signatures yield the identical
  `Fr` secret — the property that actually matters for recoverability.

Exit code `0` = every assertion passed. Exit code `1` = something failed —
read which specific assertion(s) failed in the printed table before
concluding a verdict (e.g. a SEP-53-verify failure with a byte-identical
double-sign points at a non-standard preimage, not nondeterminism — see the
Handoff section).

### Step 3 — record the verdict

Fill in one row of the table below per wallet: wallet name + **version**,
pass/fail on each of the three assertions, and any notes (e.g. "wallet wraps
the message differently — verify fails despite deterministic signing", or
"requires a Ledger; PIN-confirmed signs may differ — test explicitly").

**Verdict = PASS** only if the wallet (a) returns a signature, (b) is
byte-identical across repeated signs, and (c) verifies under the standard
SEP-53 preimage against its own G-address, for at least two independent
double-sign rounds (ideally including one across a full lock/reopen cycle).

## Results table

All rows are **UNVERIFIED — needs human with extension** until someone
actually runs the procedure above, through the real app, against each
wallet, and fills in real results (including the wallet's version). The
"expected" column below is a prior/hypothesis based on how each wallet is
known to be implemented, not a measured result — do not treat it as a pass.

| Wallet | Version | Returns signature? | Double-sign identical? | SEP-53 verify? | Verdict | Notes / expected |
|---|---|---|---|---|---|---|
| Freighter | UNVERIFIED | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | Expected: deterministic ed25519 signMessage, SEP-53-compliant. Expected verdict: PASS. |
| xBull | UNVERIFIED | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | Expected: deterministic ed25519 signMessage, SEP-53-compliant. Expected verdict: PASS. |
| Albedo | UNVERIFIED | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | Expected: may wrap/format the message differently before signing (web-based signer, historically inconsistent with SEP-53 preimage in some flows). Expect possible verify failure against the raw SEP-53 preimage even if internally deterministic — needs explicit check of Albedo's actual signing payload. Also `walletConnect.ts` flags Albedo as popup-always (`kind: 'popup-always'`) — confirm the popup flow doesn't itself introduce a wrapping difference. |
| LOBSTR | UNVERIFIED | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | No strong prior; mobile/extension bridge behavior unconfirmed. `walletConnect.ts` notes LOBSTR only supports a single account — make sure the right one is active before signing. |
| Hana | UNVERIFIED | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | No strong prior; confirm signMessage support exists at all. |
| Rabet | UNVERIFIED | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED — needs human with extension | UNVERIFIED | No strong prior; confirm signMessage support exists at all. |

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

- [ ] Wire the double-sign + byte-compare + SEP-53-verify safety check into
      `new-account/index.astro`'s `$enrollWalletBtn` handler itself (see the
      "IMPORTANT" section above) — refuse the wallet method and fall back to
      the seed-word (M1) path on any failure. This is a real app gap, not
      just a test gap.
- [ ] A human with Freighter, xBull, Albedo, LOBSTR, Hana, and Rabet
      installed (and, ideally, a Ledger device paired to one of the
      software wallets) must run the procedure above, through the real app,
      and fill in the table (wallet name + **version** + pass/fail per
      assertion).
- [ ] If any wallet fails the SEP-53-verify step but is otherwise
      deterministic, investigate whether it's using a non-standard preimage
      (e.g. no `"Stellar Signed Message:\n"` prefix, different hashing, or
      transaction-envelope wrapping instead of SEP-53) and whether that can
      be special-cased.
- [ ] If any wallet is nondeterministic across repeated signs, it is not a
      viable signer for the M2 recovery method as currently designed; that
      wallet (or wallet class, e.g. "Ledger-backed") should be excluded from
      the M2 recovery path (both in the safety check above AND in the
      wallet-picker's UI) and flagged in the product-facing wallet support
      matrix.
