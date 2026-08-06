# Spike #161 — preauth-signer-only G executes unsigned Soroban SAC transfer (testnet)

Claim VALIDATED in both modes on 2026-08-06. `require_auth(G)` clears with a
zero-signature inner tx: classic preauth signer satisfies tx/op signature
checks, Soroban `sorobanCredentialsSourceAccount` trusts Core's account auth.

## Run 1 — mode=feebump (R pays fees, signs only the outer envelope)

- G: `GDZK37QFN5JJ7INR2DWN5WV5ORQLRD7Z4SPQJSIMK6WCHNKPNECLHY2R`
- R: `GAHRZ5A6PQOCEAT46FGFNM7Q4XGEGQIV3DRTWTSA23SIPGGP7PH2WMRV`
- Setup tx S (preAuthTx signer + masterWeight 0, one SetOptions):
  `68a2f4a1b902cb37ee9624b7f1f1d765f516e955db982822ab7281b57284f345`
  https://stellar.expert/explorer/testnet/tx/68a2f4a1b902cb37ee9624b7f1f1d765f516e955db982822ab7281b57284f345
- Negative test (classic 1 XLM payment signed with G's weight-0 master key):
  rejected at submission, `status=ERROR error=txBadAuth`, sequence NOT consumed.
- T inner hash: `66ef791571ffe690e50972616a0ea7f6bb421a307217fe372deb0cf3b7d033cb`
- Fee-bump (outer) hash, SUCCESS in ledger 4001933:
  `6eebe738f1516cb2f04185ec4022c2a65cd8915a705bef5eddf0e05079035db9`
  https://stellar.expert/explorer/testnet/tx/6eebe738f1516cb2f04185ec4022c2a65cd8915a705bef5eddf0e05079035db9
- Auth credential type from simulation: `sorobanCredentialsSourceAccount` (1 entry)
- Applied inner signature count: **0** (outer: 1, R's)
- Post: preauth signer auto-removed, master weight still 0 (account inert),
  R balance 10004.9986388 (+5 XLM minus outer fee), G 9994.9999900.

## Run 2 — mode=bare (T submitted directly, zero signatures anywhere)

- G: `GBNUN4RYKFZOQWGHMSFSYWRE5IAZJTCAEXXZDOVJK7T5I2MCBJT66DMA`
- R: `GA7EMOL4RIT26D7X6IYNV4U2NXJMJVZDNBD3LAMJDA4UONYVOM6WWPAH`
- Setup tx S:
  `afc55b85160e107ab224d0a1fd00589b72727a1fa6568971e893154507362c24`
  https://stellar.expert/explorer/testnet/tx/afc55b85160e107ab224d0a1fd00589b72727a1fa6568971e893154507362c24
- Negative test: rejected, `status=ERROR error=txBadAuth`, sequence NOT consumed.
- T hash (SUCCESS in ledger 4001939, G paid its own fee):
  `44d0ade0a3e73b7b5f0e7f41e0003cc58260ce2000d85e5565ddb602c7089bed`
  https://stellar.expert/explorer/testnet/tx/44d0ade0a3e73b7b5f0e7f41e0003cc58260ce2000d85e5565ddb602c7089bed
- Auth credential type: `sorobanCredentialsSourceAccount` (1 entry)
- Applied inner signature count: **0** — a true bearer transaction.
- Post: preauth signer auto-removed, master weight 0,
  R balance 10005.0000000 (+5 XLM exactly), G 9994.9986388.

## Repro

```sh
cd spikes/161-preauth-g
node spike.mjs --mode feebump   # or --mode bare
```

Per-run JSON in `run-feebump.json` / `run-bare.json`; merged in `results.json`.
