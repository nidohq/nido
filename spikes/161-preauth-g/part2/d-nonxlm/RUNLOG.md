# Experiment D — non-XLM asset end-to-end, sponsored trustline + zero-dust teardown

**Verdict: VALIDATED on testnet, 2026-08-06 (single run, no retries needed).**
Repro: `node spike-d.mjs` (fresh keys per run). Machine output: `results.json`.
Progress log: `run1.log`.

## Accounts

| Role | Address |
|---|---|
| I (issuer, friendbot) | `GCI6MH3RDUQYAAZEXXD5FTKC4DXZHQYR3JKDUYGWFPMAHTG2E5XBZNL7` |
| R (relayer/sponsor, friendbot) | `GDNRFKSNYCQMSIORJNOXKI7CTSOKPX5JIK2B57LN2OWUXMEYHIUG5MLY` |
| G (burner, sponsored create, **never held any XLM**) | `GD7KTKF7PRWXELJ34EOZX2OMI4YZIZGSYDYCHWSIHQPF334OZRGLYWJ6` |
| SAC for NIDO:I | `CAHZOM3GA47BFDRMBIKDKB5HG2BMUXD4DLHK3EMWINTZTQKGT7ATN45T` |

SAC deployed via `stellar contract asset deploy --asset NIDO:GCI6… --source-account <R> --network testnet`
(CLI 27.0.0, tx `147ecf6f…`, fee 61,275 stroops). CLI-printed contract id **matched
the offline computation** `new Asset('NIDO', I).contractId(Networks.TESTNET)` byte-for-byte.

## Transactions (all in testnet ledgers 4003926–4003931)

| Step | Tx | Hash | Ledger | fee_charged |
|---|---|---|---|---|
| SAC deploy (CLI, source R) | soroban deploy | `147ecf6f…` | — | 61,275 |
| Creation: [Begin(G, src R), CreateAccount(G, **0 XLM**, src R), End(src G)] | signed R + G (checkSignatureNoAccount) | [`c91e51914fbfaf8c…`](https://stellar.expert/explorer/testnet/tx/c91e51914fbfaf8c2e47d579da47b4eed99c8c5157079e7362a6ac1d9149f157) | 4003926 | 300 |
| Provisioning S (seq n+1, src G): [Begin(G, src R), ChangeTrust NIDO max, SetOptions(preauth hash(T5) w1), SetOptions(preauth hash(T6) w1 + masterWeight 0), End] — signed G(live)+R, fee-bump R | outer [`e4152c0e…`](https://stellar.expert/explorer/testnet/tx/e4152c0e65f2436ddab8bf26a6c6d0bc3d1f018f1386c359474e29dee07a6574) / inner `a47bb65a…` | | 4003927 | 600 |
| Exchange sim: I pays 100 NIDO → G | [`76d5dac7…`](https://stellar.expert/explorer/testnet/tx/76d5dac7cf7dd3ade5e10b3b73cd48bc949336c7da994be2d6d2a1bbeb5a3fb6) | | 4003928 | 100 (paid by I) |
| **T5** (seq n+2): SAC `transfer(G → I, 100 NIDO)`, **built simulation-free**, 0 inner signatures, fee-bump R | outer [`0d8290a9…`](https://stellar.expert/explorer/testnet/tx/0d8290a95229cc68db183925a72f54611d83ce9657ca3b83429875436937de26) / inner `1c71a1f33f4c0768…` | | 4003929 | 41,441 (3.2M declared, rest refunded) |
| **T6** (seq n+3): [ChangeTrust NIDO limit 0, AccountMerge(G → R)] under ONE preauth signer, 0 inner signatures, fee-bump R | outer [`84afe9b3…`](https://stellar.expert/explorer/testnet/tx/84afe9b3aea18eddfb3d2df5cdef9d876fe973caf9cabd200d60e212ade0cc45) / inner `6130e403bdb92cc7…` | | 4003931 | 300 |

G's secret was discarded (keypair object replaced with public-only) immediately
after S confirmed; nothing after ledger 4003927 signs as G.

## Headline results

1. **Sponsored 0-XLM creation works** (CAP-0033): G created with
   `startingBalance: 0`, balance `0.0000000` for its entire life. After creation:
   G `num_sponsored=2`, R `num_sponsoring=2`.

2. **Simulation-free Soroban build works for an issued asset.** T5 had to be
   built before the trustline existed and before G held any NIDO — simulation
   was structurally impossible. Hand-built `SorobanTransactionData`:
   - readOnly: SAC instance key, issuer account key, G account key
   - readWrite: G's NIDO:I **trustline** ledger key only (burn-to-issuer writes
     no destination entry)
   - resources 4M instr / 50k diskRead / 5k write, resourceFee 1,000,000 declared
   - auth: single hand-built `SorobanAuthorizationEntry` with
     `sorobanCredentialsSourceAccount`, rootInvocation mirroring the op args.
   Applied cleanly on the first attempt; actual charge 41,441 stroops
   (fee-bump declared 3.2M; the excess was refunded to R, the outer fee source).

3. **Both preauth signers verified on-chain**: Horizon `preauth_tx` signer keys
   strkey-decode to exactly `hash(T5)` = `1c71a1f3…` and `hash(T6)` = `6130e403…`;
   master weight 0 after S. Peak state: G `subentry_count=3` (trustline + 2
   signers), `num_sponsored=5`, R `num_sponsoring=5` (2 account + 1 trustline +
   2 signers = 2.5 XLM of R's reserves locked).

4. **Bare submission from a 0-XLM fee source is impossible — exact code
   captured.** Both T5 and T6 submitted bare (zero signatures, no fee-bump)
   were rejected at validation with **`txInsufficientBalance`**. Crucially the
   rejection is pre-apply: sequence NOT consumed, preauth signer NOT burned
   (CAP-0028 removal only fires for txs that reach apply) — the same frozen
   XDR then succeeded at the same sequence inside a fee-bump. A zero-dust G
   makes fee-bump submission *mandatory*, not optional.

5. **T5 swept the trustline to exactly 0.** G NIDO `100.0000000 → 0.0000000`
   (unlike XLM, trustline balances have no reserve floor). Transfer to the
   issuer burned the tokens: Horizon `/assets` shows NIDO outstanding
   `amount: 0.0000000` after T5. T5's preauth signer auto-removed
   (G `subentry_count 3→2`, `num_sponsored 5→4`, R `num_sponsoring 5→4`).

6. **T6 (trustline removal + merge under ONE preauth signer) succeeded** with 0
   inner signatures. Op order is what makes it work: at apply, CAP-0028 first
   strips the hash(T6) signer (pre-ops), then op1 `ChangeTrust limit=0` deletes
   the now-zero-balance trustline (releasing its sponsorship), then op2
   `AccountMerge(G→R)` sees `numSubEntries == signers.size()` and succeeds.
   Note the contrast flagged for experiment A: even if a merge-only preauth tx
   were blocked by a lingering non-signer subentry, this multi-op shape removes
   the subentry in the same tx *before* the merge op executes.

7. **Zero-dust teardown accounting is exact.** After T6: G account gone
   (Horizon 404), R `num_sponsoring=0`, `num_sponsored=0` everywhere. Merged
   balance transferred: 0 XLM (G never had any). R's final balance
   `9999.9896084` = 10,000 − fees only:

   | fee payer R | stroops |
   |---|---|
   | SAC deploy | 61,275 |
   | creation tx | 300 |
   | S fee-bump | 600 |
   | T5 fee-bump (post-refund) | 41,441 |
   | T6 fee-bump | 300 |
   | **total** | **103,916 = 0.0103916 XLM** |

   All 5 sponsored base reserves (2.5 XLM at peak) returned to R with zero
   leakage; the only cost of the entire lifecycle is ~0.0104 XLM of fees, of
   which 61,275 stroops (the SAC deploy) is a one-time per-asset cost, not
   per-user.

## Failure/negative observations

- `txInsufficientBalance` on both bare submits (see 4) — the only rejections in
  the run; nothing failed on-chain.
- **SDK fee surprise (recon correction).** The stellar-base actually resolved by
  `@stellar/stellar-sdk` 15.1.0 is the **nested** copy at
  `node_modules/@stellar/stellar-sdk/node_modules/@stellar/stellar-base`
  (**15.0.0**), not the top-level 14.0.1 the recon digest inspected. Base 15's
  `TransactionBuilder.build()` (lib/transaction_builder.js:771) **automatically
  adds `sorobanData.resourceFee()`** to `baseFee × ops` — the `fee` option is
  inclusion-only. We passed `fee: '1000200'` (pre-adding the 1M resourceFee per
  the recon's advice), so the T5 envelope fee became 2,000,200 (double-counted;
  harmless — over-declared fee is refunded, only 41,441 charged). Likewise
  base 15's `buildFeeBumpTransaction` is Soroban-aware: inner inclusion rate =
  (innerFee − resourceFee) ÷ ops for the baseFee floor check, and outer fee =
  baseFee × (innerOps + 1) + resourceFee → 1,100,000 × 2 + 1,000,000 =
  3,200,000, exactly Horizon's outer `max_fee`. Production rule: pass
  inclusion-only fee and a modest fee-bump baseFee; do NOT pre-add resourceFee.

## Production notes

- The whole flow needs exactly two live G-key signatures (creation envelope +
  S envelope), both during the provisioning window; the key is inert afterward
  (master weight 0) and can be discarded.
- Fee-bump by R is mandatory for T5/T6 (zero-dust G ⇒ `txInsufficientBalance`
  bare). Frozen inner XDR remains a bearer capability — anyone can wrap it in
  their own fee-bump.
- Trustline must be created (sponsored) in S before any NIDO can arrive;
  ChangeTrust in T6 requires the balance to be exactly 0 — T5's full sweep
  guarantees that only if the exchange pays exactly the swept amount once.
  Multiple/partial deposits would leave dust that bricks T6
  (`CHANGE_TRUST_INVALID_LIMIT`) — same "exact-amount UX" constraint as XLM,
  now on the trustline side.
- Burn-to-issuer needed no destination trustline and no destination footprint
  entry. A G→C (smart account) sweep would instead need the SAC Balance
  ContractData key for the C-address in readWrite.
