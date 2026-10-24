# Mainnet demo switchover: placeholders to replace

Every value that's a deliberate stand-in for the mainnet conference demo
switchover — not yet deployed, or not yet real — is the literal string
`<PLACEHOLDER>` in its file, specifically so it's grep-able and impossible to
mistake for a real value:

```bash
grep -rn '<PLACEHOLDER>' --include="*.ts" --include="*.json" --include="*.astro" \
  --include="*.toml" infra/ | grep -v node_modules
```

Run that before the cutover and fill in every hit. As of this doc, that's:

- **`infra/relayer/fly.mainnet.toml`** — `FEE_LIMIT`, `FUNDER_TOPUP_STROOPS`.
  Not yet deployed; deploying this file unedited fails loud (the relayer
  errors on a non-numeric value) rather than silently going live with a
  testnet-sized limit on real money. Already tracked in
  `docs/RUNBOOKS.md`'s mainnet relayer deploy checklist, step 4.
- **`infra/demo-service/src/relayerKeys.ts`** — all four `mainnet` entries'
  `address` fields. `fetchXlmBalance` fails for these until replaced (caught,
  shown as "error fetching balance" on the demo-service's balance page, not
  a crash).

A few related things that aren't literal values to grep for, so they don't
fit the convention above but matter just as much:

- **The `manager` Turnkey signer** (from #315, once merged) —
  `infra/relayer/config/config.json`'s `manager-signer` entry and
  `infra/relayer/README.md`'s accounts table carry a locally-generated,
  never-funded keypair (already marked `PLACEHOLDER` in a comment there,
  not the literal-string convention, since it has to stay a validly-shaped
  address for the relayer to parse it). Needed on **testnet first** (to
  actually test #315) and again on mainnet. Also add a `manager` row to
  `relayerKeys.ts` once a real mainnet one exists, so the balance page can
  catch it running low on its own fee balance during the event.
- **`infra/relayer-redis/fly.mainnet.toml`** — an open decision, not a
  value: the no-password Redis choice is justified for testnet specifically
  ("testnet dev relayer"); re-examine whether that holds once this backs a
  mainnet relayer moving real money.
- **`.github/workflows/deploy-production.yml`**'s "Build frontend
  (production)" step — deliberately **not** marked `<PLACEHOLDER>`: it's
  live and functional today (real deploys of `nido.fyi`'s testnet-configured
  build go through it), so breaking its values would break that. The
  file's own comment already says what to flip when mainnet infra exists:
  `PUBLIC_STELLAR_NETWORK: mainnet`, a mainnet `PUBLIC_RELAYER_URL`/
  `PUBLIC_RELAYER_SIM_SOURCE`, and a real `PUBLIC_PERCH_DEPLOYMENT` manifest
  — all four together, deliberately, not before.
- **The factory's manager gate** (from #315) — `null` until
  `scripts/set-factory-manager.sh` is deliberately run; see that script's
  header and `infra/relayer/README.md`'s "Removing the Conference Demo
  Gate" for the full on *and* off lifecycle.
