# Create-run perf harness

Measures the **full account-creation lifecycle** driven by the real Chromium
virtual authenticator (real WebAuthn ceremony) against **real testnet**, and
emits a per-phase `% of total` table aggregated over N runs so "what is taking
the longest" falls out. Tracks issue #121.

It is an **investigation tool, not a CI gate** — it never fails on slowness,
only on a broken create flow or absent timing data.

## Run it

```bash
just perf-create        # 5 runs (default)
just perf-create 10     # 10 runs
```

Builds the frontend, then runs `account-create-perf.testnet.spec.ts` under the
`testnet-chromium` project. Account creation goes through the Channels relayer,
so the build needs `PUBLIC_RELAYER_URL` / `PUBLIC_RELAYER_SIM_SOURCE`; the recipe
bakes in the canonical testnet values (same as `deploy.yml` /
`infra/relayer/README.md`), so it works out of the box — the create flow
self-funds via friendbot, no bank secret required. Override either var (or add
`NIDO_TEST_BANK_SECRET`) via `tests/.env.testnet`. First run downloads Chromium
if missing (`npx playwright install chromium`).

Output: a markdown table on the console + `perf-results/<ISO-ts>-create.json`
(raw per-run traces + aggregate; gitignored). Each run drives the real reserve
flow (`/new-account/?setup=1&salt=<random>` → reserve → subdomain → register)
with a fresh random salt, minting a throwaway testnet account; they are not
cleaned up.

## How it correlates — one trace per create-run

Always-on `performance.mark()` seams in real app code emit
`nido:perf:<phase>:start|end` pairs (they double as future RUM telemetry). The
collector harvests them after the flow settles; the reporter stitches start/end
pairs into spans, aggregates median/min/max/p95 across runs, and renders the
table. Spans are correlated across the browser/relayer boundary by
`transactionId` (carried on the relayer marks' `detail`).

```
create-run (wall clock)
├─ webauthn.create     new-account/index.astro  (real CDP ceremony)
├─ factory.simulate    new-account/index.astro
├─ assemble.extract    new-account/index.astro
├─ relayer.submit      passkey-sdk/src/relayer.ts   ← correlated by transactionId
├─ poll.confirm        passkey-sdk/src/relayer.ts   ← the ~82s ceiling
└─ funding.drain       new-account/index.astro
```

## Files

| File | Role |
|------|------|
| `schema.ts` | Phase taxonomy + types. Naming (`PERF_PREFIX`, `markName`, `parseMarkName`) is imported from the SDK's `perf.ts` — one source of truth shared with the app seams. |
| `report.ts` | Pure: `stitch` → `buildTrace` → `aggregate` → `toMarkdownTable`. Unit-tested. |
| `collect.ts` | Browser collection: harvest marks (`collectPerfMarks`), pull the txId (`txIdFromMarks`, pure), CDP `/relay` network timings (`startRelayCapture`). |
| `artifacts.ts` | Bundle + write `perf-results/*.json`. |
| `cdpFixture.ts` | `cdpTest` / `newCdpRunCtx`: real virtual authenticator, **no** `navigator.credentials` shim. Chromium-only. |
| `../../e2e/testnet/account-create-perf.testnet.spec.ts` | The N-run perf spec. |

The app-side timing seams live in `packages/passkey-sdk/src/perf.ts` (`perfMark`,
the shared naming) and the seam call sites: `new-account/index.astro`,
`passkey-sdk/src/relayer.ts`, `primaryPasskeySigner.ts` (signing-flow
`webauthn.get`).

## Status / follow-ups

This is the **foundation tier**. Relayer-side phases (`relayer.enforce`,
`relayer.channel`, `relayer.feebump`, `relayer.rpc.*`) are defined in the
taxonomy but not yet emitted — they need the Channels plugin instrumented
(handler-boundary wrap) + a fly.io redeploy, surfacing a phase array on the
`getTransaction` payload. The collector and reporter already accept them
(`buildTrace({ relayerPhases })`), so wiring is additive.

A committed reference trace under `docs/` is intentionally **not** fabricated —
capture one with `just perf-create` against live testnet and commit the
resulting `perf-results/*.json` (de-gitignored for that one file) once the
relayer phases are present.
