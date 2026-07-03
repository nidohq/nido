# Channels plugin — perf instrumentation

Handler-boundary timing for the create-run perf harness (#121, relayer half).
Wraps the upstream `@openzeppelin/relayer-plugin-channels` handler in
[`index.ts`](./index.ts); the pure timing core is [`instrument.ts`](./instrument.ts).

## Why a status timeline (not per-phase spans)

The create submit is `skipWait=true`: the plugin **queues** the transaction and
returns `pending` at once. The expensive work — enforce re-sim, channel pick,
fee-bump, rpc submit, ledger-close confirm — runs in a **background job**,
invisible to any single handler call. A plain boundary wrap would therefore time
only the queue insert (submit) and each status read (getTransaction).

What *is* observable at the boundary is the transaction's **status** as it
advances across the browser's `getTransaction` polls. Recording the first time
each status is seen (persisted per-`transactionId` in the plugin kv) yields the
wall clock spent in each status band:

| band | ≈ what happens |
|------|----------------|
| `relayer.pending->submitted` | build + sign + channel pick + fee-bump + rpc submit |
| `relayer.submitted->confirmed` | ledger close (confirm poll) |

Coarse, but real and honest — and no fork of the upstream module.

## What it emits

For every transaction-bearing response, best-effort (wrapped in try/catch — it
can never alter the shape the relayer depends on or break the flow):

- **(a) correlated harvest** — a cumulative `phases: [{phase, durMs, ts}]` array
  attached to the `getTransaction` response the browser polls. The happy-path
  source; no log-scrape.
- **(b) monitoring-foundation log** — one structured line per newly-closed band:
  `{"evt":"channels.phase","txId":"…","phase":"relayer.pending->submitted","durMs":…,"ts":…}`
  to stdout (→ `fly logs`). The format a future relayer dashboard consumes.

kv key `perf:phases:<txId>`, TTL 1h (throwaway perf txs).

## Test

```bash
npx vitest run --root infra/relayer/plugins/channels   # pure core: foldStatus / phaseName
```

## Verify live (NOT yet done — needs a fly.io redeploy)

This code has **not** been run against a live relayer. To verify:

1. Redeploy the relayer (`infra/relayer`, fly.io) with this plugin.
2. Run the harness: `just perf-create` (#130).
3. Confirm `fly logs` shows `channels.phase` lines, and the polled
   `getTransaction` responses carry a `phases` array.

## Integration + follow-ups

- **Harness collector** (#130, `tests/support/perf/collect.ts`) must harvest the
  `phases` array off the `/relay` `getTransaction` response body and pass it to
  `buildTrace({ relayerPhases })` — the reporter already accepts it additively.
  Add `relayer.pending->submitted` / `relayer.submitted->confirmed` to the
  taxonomy in `schema.ts` for ordered placement.
- **Finer per-phase** (enforce re-sim vs channel pick vs fee-bump individually)
  is not boundary-observable under skipWait — it needs the upstream module's
  `submit.js` instrumented (a fork), deliberately out of scope here.
- **kv races**: concurrent polls for one txId may drop a transition timestamp
  (best-effort; no atomic update used). Acceptable for an investigation tool.
