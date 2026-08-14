# Experiment A — production-shaped XLM flow, end-to-end (testnet, 2026-08-06)

**Outcome: SUCCESS on all 12 steps.** One amendment vs the plan (T1 fee-bumped, not
bare — see "Amendment" below), one empirical capture (bare T2 rejected with
`txInsufficientBalance`).

Script: `spike-a.mjs` (run: `run.log` stderr, `run.json` stdout, `results.json`).
Frozen bearer envelopes: `t1-frozen.xdr`, `t2-frozen.xdr`.

## Accounts (fresh keypairs, this run)

| Role | Address |
|---|---|
| R (relayer, friendbot) | `GCN5FQW6VXEUQT6UNEZRISNIZXFLD47E5ZMUKZEYJE44OCYCYR63QJ32` |
| W (watcher/spender, friendbot) | `GC2P2DIAY2LYQE4OEGZXEN4KXX76EPK2V3YPCIAS5RWCBQA7R7C5LQLB` |
| G (burner, sponsored, never friendbot) | `GAP2CZE6SLIUF323UXBLOLQS6QCHRZ733GBSB473IZRYA7EDX6BP7RNK` — **deleted at end** |
| C_dest (factory-deployed smart account) | `CBFZGJBHWKUZVW5HGMCVE7DAESXLGCGWI4GHFOES3SMX7EI4VUBTIUQF` |
| Factory (testnet v1) | `CBQKB6GYPO7P2CGDKN7KYLEFEBBN6FY5NXZJ7HNR43ZK2DDOU5N7NCV5` |
| Native SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

G starting sequence n = `17196903024295936`. Seq map: approve n+1, config S n+2,
T1 n+3, T2 n+4.

## Transactions

Horizon link base: `https://horizon-testnet.stellar.org/transactions/<hash>`
Explorer: `https://stellar.expert/explorer/testnet/tx/<hash>`

| Step | Tx | Hash | Ledger |
|---|---|---|---|
| 1 | Sponsored create G (Begin/Create 0 XLM/End, signed R+G) | `c1648e392c77a319f5d5ac2af1c53c8dbc43754f387a84830f13d164e63d8eea` | 4003966 |
| 2 | approve(G, W, 9e18, exp 7104366) — outer fee-bump R | `7867f11b7822bec40c0d6c48ddfb2de98529d079a6676e7dfade6f9c79dbc89d` | 4003968 |
| 2 | approve inner (source G, signed G, zero balance) | `06fd7170fef30187f76a8bb568dca9117fe8677524995c46e29e1abe4c8fa7c0` | — |
| 3 | Factory create_account(salt, P-256 key) by R | `310e916c67d47c797e1f29ef008975f5331e41fd68a168d555ed05b1a88aa0d6` | 4003969 |
| 6 | Config S (sponsored preauth×2 + master→0) — outer fee-bump R | `51a47c1bd684aeb49530e38aa3e83636919d7e2814553135915c5d58b4c38e1c` | 4003970 |
| 6 | Config S inner (signed G last-use + R) | `0c88c0e3170dd4ce1eca6bbc96e512467a960a20f17cd61b155b40ea8ab5df9e` | — |
| 7 | Negative test (payment @ n+3, discarded master sig) | rejected at submission, `txBadAuth`, no hash on chain | — |
| 8 | R → G payment exactly 25 XLM | `bdff2d92f10b880dfb9e26940116c7b309965862b1cdebf98867beefe6f6baec` | 4003972 |
| 9 | T1 outer fee-bump R (inner **0 signatures**) | `c72669fc9f870867953a28fdae8b320c4eff56130fdf1e6904bd682ac7cc65d1` | 4003974 |
| 9 | T1 inner (zero-simulation build, hash in preauth signer) | `01b72f2f484d3d51dbcdab398d1ef5c1b2816a7e56942494a2a4b7097a31ade4` | — |
| 10 | R → G stray payment 7 XLM | `65315556f12f36794dda568b7d2e1f4893c6219778676db4a95f71f6ff2802be` | 4003976 |
| 11 | W transfer_from(W, G, W, 7 XLM), signed W only | `099c492ca15cca17e727962a5766bdc4d6d68dd2992aeef1045247cd6e1bad17` | 4003977 |
| 12 | T2 bare attempt | rejected at submission: **`txInsufficientBalance`** (G=0), nothing consumed | — |
| 12 | T2 outer fee-bump R (inner 0 signatures, AccountMerge G→R) | `958fc3cef1e4236464753226581a3052b83a1acce0c7831d88f56371d6a4efec` | 4003979 |
| 12 | T2 inner | `4b68439be274e88f1c6e163c1c7e40ba0b49d16d96edee69cb7836af0ae17c9f` | — |

## Balance ledger (native XLM; C_dest in SAC stroops)

| Checkpoint | R | R sponsoring | W | G | G sponsored/sub | C_dest |
|---|---|---|---|---|---|---|
| after-create | 9999.9999700 | 2 | 10000.0000000 | 0.0000000 | 2 / 0 | — |
| after-config | 9999.9422332 | 4 | 10000.0000000 | 0.0000000 | 4 / 2 | 0 |
| after-25-deposit | 9974.9422232 | 4 | 10000.0000000 | 25.0000000 | 4 / 2 | 0 |
| after-T1 | 9974.9272060 | 3 | 10000.0000000 | **0.0000000** | 3 / 1 | **250000000** |
| after-sweep | 9967.9271960 | 3 | 10006.9981818 | 0.0000000 | 3 / 1 | 250000000 |
| after-T2-merge | 9967.9271760 | **0** | 10006.9981818 | **404 (deleted)** | — | 250000000 |

## Accounting (R, whole run)

- R start → end: 9999.9999700 → 9967.9271760, net **32.0727940 XLM**
- Of which transfers out (user funds): 32.0000000 (25 → C_dest, 7 → G → swept to W)
- **Of which fees: 0.0727940 XLM** (all fee-bump outer fees incl. Soroban resource
  fees net of protocol-23 refunds to the outer fee source)
- Sponsored reserves: fully released — R `num_sponsoring` 4 → 3 (T1 consumed its
  signer) → 0 (T2 consumed its signer pre-apply + merge released the 2-reserve
  account entry). **Zero dust: G no longer exists.**
- W netted +6.9981818 (7 XLM sweep minus its own transfer_from fee after refund).

## Headline results per sub-claim

1. **Sponsored 0-XLM creation** — works; G existed with own balance exactly 0,
   `num_sponsored` 2; G's envelope signature on the not-yet-existing account
   accepted (checkSignatureNoAccount path).
2. **Approve before funding** — SAC `approve` succeeded with G at 0 XLM balance;
   auth credential `sorobanCredentialsSourceAccount`; fee paid by R via
   fee-bump; expiration_ledger = current + maxEntryTtl − 10000 accepted.
3. **Factory** — live v1 factory deployed a real smart account first try
   (raw ECDH P-256 uncompressed pubkey); C_dest deterministic and returned.
4. **T1 with ZERO simulation** — hand-built footprint (`[SAC instance]` readOnly;
   `[G account, SAC Balance(C_dest)]` readWrite), resources 4M instr / 50k
   diskRead / 5k write, resourceFee 2,000,000 stroops declared, hand-built
   sourceAccount auth entry. No `simulateTransaction` call for T1 exists in the
   script. Applied successfully on-chain, inner signature count 0.
5. **Exact sweep** — C_dest credited exactly 250,000,000 stroops; G returned to
   **exactly 0.0000000** (fully-sponsored min balance is 0; SAC check is
   `new_balance >= min_balance`).
6. **Discarded secret inert** — payment at T1's sequence signed with G's master
   key (weight 0): `txBadAuth` at submission, sequence NOT consumed (still n+2).
7. **Allowance survives inertness** — after G was inert (master 0, no live
   signers), W's `transfer_from(W, G, W, 7 XLM)` succeeded signed by W only.
8. **Cleanup merge** — preauth AccountMerge did NOT trip over its own signer
   (CAP-0028 removal precedes op apply) nor over the remaining SAC allowance
   entry (contract data is not a G subentry); G deleted, Horizon 404; all
   sponsorships released to R.

## Amendment: T1 must be fee-bumped, bare is arithmetically impossible

The plan said "submit T1 bare". With R depositing **exactly** 25 XLM and T1
transferring **exactly** 25 XLM, a bare submission is guaranteed to fail:
`processFeeSeqNum` charges T1's fee (inclusion + declared resourceFee) to the
source G *before* operations apply, so the transfer would run against
25 − fee < 25 and fail — and CAP-0028 burns the preauth signer even on failure,
permanently stranding the deposit. Padding the deposit doesn't fix it either:
the refundable-fee refund returns to the fee source after apply, leaving
nondeterministic dust in the now-inert G. Part one already proved bare
submission of an unsigned preauth tx works when the source covers the fee; the
production shape for exact-amount sweeps is **fee-bump by R with a
zero-signature inner envelope** — which is what ran here (verified 0 inner
signatures at apply; refund went to R).

Corollary captured empirically for T2: bare submission from a 0-balance source
is rejected at submission with `txInsufficientBalance` — safely, before the
apply stage, so nothing is consumed and the same envelope then succeeded inside
a fee-bump.
