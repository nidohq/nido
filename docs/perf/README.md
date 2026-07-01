# Create-run perf — reference traces

Committed reference output from the create-run perf harness (`just perf-create`,
see [`tests/support/perf/README.md`](../../tests/support/perf/README.md)). These
are real testnet runs driven by the CDP virtual authenticator — a baseline to
compare future runs against.

## 2026-07-01 — [`2026-07-01-create-reference.json`](./2026-07-01-create-reference.json)

4 successful runs (1 of 5 dropped to real-chain flakiness). Total median **18.54s**.

| phase | where | median | % of total |
| --- | --- | --- | --- |
| poll.confirm | browser | 9.52s | **51.4%** |
| relayer.submit | browser | 5.13s | 27.7% |
| funding.drain | browser | 3.45s | 18.6% |
| factory.simulate | browser | 91ms | 0.5% |
| webauthn.create | browser | 6ms | 0.0% |
| assemble.extract | browser | 3ms | 0.0% |

**Takeaway:** the relayer round-trip (`relayer.submit` + `poll.confirm`) is
**~79%** of the wall clock; the browser-local phases (webauthn ceremony, factory
simulate, XDR assemble) are negligible. The relayer is where to optimize — its
internal breakdown (enforce re-sim vs channel pick vs fee-bump vs confirm) needs
the server-side status-timeline phases (see the relayer instrumentation PR), not
yet folded into these traces.

Phases overlap (funding drains concurrently with the deploy poll), so the
percentages intentionally do not sum to 100 — the table answers "what takes the
longest", not "where did the wall clock go".
