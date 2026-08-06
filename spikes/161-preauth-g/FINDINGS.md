# Spike: pre-auth-tx signer clears Soroban `require_auth(G)` (#161)

**Verdict: VALIDATED on testnet, 2026-08-06.** A classic account `G` with master
key weight 0 and a single pre-authorized-transaction signer `hash(T)` had `T` —
a Soroban `InvokeHostFunction` tx (native SAC `transfer(G, dest, 5 XLM)`, source
`G`, `SourceAccount` credentials) — succeed with **zero signatures on the inner
tx**, both fee-bump-wrapped and submitted completely bare. `require_auth(G)`
cleared purely via the pre-auth signer. The linchpin of the exchange-funded
non-custodial onboarding design in issue #161 holds.

Independently verified by three read-only passes against Horizon/RPC: envelope
XDR decode (inner signature vector empty, preauth strkey decodes to the exact
inner tx hash), account state (master weight 0 at apply time, preauth signer
auto-removed, exactly 3 txs ever on each `G`), and Soroban auth semantics
(single auth entry, credentials `sorobanCredentialsSourceAccount`, no
address-credential signature anywhere).

## On-chain evidence (testnet)

| Run | G | Setup tx S | Onboarding tx | Ledger |
|---|---|---|---|---|
| fee-bump | `GDZK37QF…LHY2R` | `68a2f4a1…4f345` | outer `6eebe738…5db9`, inner `66ef7915…33cb` | 4001932/33 |
| bare | `GBNUN4RY…66DMA` | `afc55b85…62c24` | `44d0ade0…89bed` (plain envelope, `signatures: []`) | 4001938/39 |

- `S` is one `SetOptions` op: `masterWeight → 0` **and** add signer
  `{preAuthTx: hash(T), weight: 1}` — atomic.
- Negative test: classic payment at `T`'s sequence, signed with `G`'s live
  master secret, rejected at submission with `txBadAuth`; sequence not
  consumed, `T` then succeeded at that same sequence. Leaked secret is inert.
- Bare run proves `T` is a true bearer tx: fully unsigned envelope accepted by
  RPC, `G` paid its own fee. No dependence on any submitter identity.
- After `T` applies: preauth signer auto-removed (CAP-0028), 0.5 XLM signer
  reserve released, master weight still 0, no signers with weight > 0 —
  account permanently inert. Exactly the desired terminal state.

Artifacts: `spike.mjs` (repro script, fresh keypairs per run), `results.json`,
`RUNLOG.md` (tx hashes + horizon links), per-run logs.

## Why it works

`SorobanCredentials::SourceAccount` defers authorization of the auth entry to
**classic transaction signature verification** of the tx source account. A
pre-auth-tx signer satisfies classic verification for the one tx whose hash it
matches — with zero live signatures. Simulation returns `SourceAccount`
credentials whenever the required authorizer equals the tx source (and the op
source is unset), so no separately-signed `SorobanAuthorizationEntry` is ever
needed.

## Constraints implementation must honor

1. **Hash freezing.** `hash(T)` covers `sorobanData` (footprint + resource
   fee), fee, sequence, and timebounds. Simulate + assemble **once**, persist
   the exact envelope XDR, submit those verbatim bytes. Re-simulating after
   installing the signer orphans it and bricks the account.
2. **Sequence choreography.** Build `T` at explicit seq `n+2` before building
   `S` at `n+1` (S embeds hash(T)); `S` must be confirmed before `T` is
   submitted — the preauth match is checked at validation.
3. **Strictly empty signature vector on `T`.** Attaching any signature (even
   `G`'s now-weight-0 one) triggers `txBAD_AUTH_EXTRA`.
4. **One-shot failure semantics.** CAP-0028 removes the preauth signer at
   apply **even if `T` fails** (trap, resource exhaustion, underfunded
   transfer) — a failed `T` burns the signer + sequence and the account is
   unrecoverable. Overprovision resources, use generous timebounds, keep the
   read footprint minimal so ledger drift can't invalidate it.
5. **Reserves.** `G` needs the 0.5 XLM subentry reserve for the signer
   (released on consumption) plus the 1 XLM base reserve, which a SAC
   `transfer` can never sweep — `X` must leave `G` ≥ minimum balance or `T`
   fails (and burns the signer, see 4). "Exact-amount" UX must account for
   this floor.
6. **Simulation before funding.** In the spike, `G` held friendbot XLM at
   simulate time. Production simulates `transfer(X)` **before** the exchange
   deposit exists, so record-mode simulation of an underfunded transfer will
   fail at the host-fn level. Options: build `sorobanData` deterministically
   (SDK 15's `TransactionBuilder.addSacTransferOperation` builds a SAC
   transfer without simulation), hand-build the footprint, or simulate against
   a briefly pre-funded decoy. **This is the main remaining engineering
   question for the relayer endpoint** — simulation itself notably does *not*
   check sequence or signatures, so a future-seq unsigned tx simulates fine.
7. **Destination must pre-exist.** SAC transfer creates no accounts; the
   C-address (deterministic, known from the passkey) is baked into the
   footprint. Non-XLM assets additionally need a sponsored trustline on `G`
   and a deployed SAC.
8. **Auth-type guard.** Production must assert every simulated auth entry is
   `sorobanCredentialsSourceAccount`; an address-credential entry would need a
   signature preauth cannot provide.
9. **Fee-bump details.** `buildFeeBumpTransaction` accepts an unsigned inner
   tx; sign only the outer envelope; poll the **outer** hash (the inner hash
   is a distinct tx id — Horizon indexes the inner only via the fee-bump
   join). Refundable-fee refunds go to the outer fee source (protocol-23
   behavior; the old misdirection bug is fixed).
10. **The frozen `T` XDR is a capability.** Anyone holding it can submit it
    (bearer). It can only ever do the one predefined transfer, but treat it as
    the user's onboarding capability: durable storage + the watcher, so
    liveness never depends on Nido alone.
11. **Relayer path.** Bare RPC submission bypasses the nido relayer allowlist
    entirely; if routed through `infra/relayer`, the native SAC `transfer`
    host function needs allowlisting.

## Extension: unlimited allowance so C can acquire later deposits to G

The fixed-amount constraint can be relaxed with the SAC's SEP-41 allowance
surface: `approve(G, C, i128::MAX, expiration_ledger)` + C pulling via
`transfer_from(C, G, C, amount)` (authorized by the passkey, or by a
policy signer for watcher-driven auto-sweep). `approve` requires
`require_auth(G)` but **no balance**, so it can run either during the
provisioning window with the live `G` secret (before discard) or inside the
composite pre-auth `T` (SourceAccount credentials cover both `require_auth(G)`
calls in one invocation tree). Result: the user can send any amount, multiple
times, and C sweeps at leisure — no exact-amount matching.

Bounds and caveats:

- **Not eternal.** `expiration_ledger` is mandatory; the allowance is a
  temporary storage entry capped by the network `max_entry_ttl`
  (~6 months on mainnet, ~3.1M ledgers — verify exact value in part two).
  Once `G` is inert, `require_auth(G)` is gone forever → no re-approve.
  A deposit after expiry is stranded permanently, so this is a
  *time-boxed deposit address*, not a forever-address.
- **Pre-auth ladder extends the window.** An account can hold up to 20
  signers: install multiple pre-auth signers at consecutive sequences, each
  the hash of a frozen re-`approve` tx submitted later (bearer; watcher fires
  one every ~5 months). Each frozen `expiration_ledger` must satisfy
  `exp − submit_ledger ≤ max_entry_ttl` at submission time, and sequences
  consume in order — timebound/seq choreography to validate. Years, not
  forever.
- **XLM floor.** `transfer_from` cannot sweep `G` below its minimum balance
  (1 XLM base + 0.5/subentry). Non-XLM trustline balances sweep to 0 but the
  trustline must exist from provisioning.
- **Trust surface unchanged.** Allowance runs only to C — the user's own
  passkey account; a leaked `G` secret remains inert.

## Deviations / open items vs. issue #161

- Spike used friendbot funding, not sponsored reserves. Sponsorship
  (`BeginSponsoringFutureReserves` around create + signer, reclaim in `T`)
  is standard classic machinery and wasn't the linchpin; still untested in
  this exact combination — cover it in the relayer-endpoint work.
- Spike transferred to a G-address, not a C-address, and did not exercise the
  factory deploy + genesis + transfer composite invocation. The auth question
  answered here is the same (`SourceAccount` credentials cover the rooted
  invocation tree), but the composite's simulation/footprint is bigger —
  validate when building the real `T`.
- Negative-test rejection (`txBadAuth`) is a submission-time result with no
  ledger trace; attested by the run logs + decoded `errorResult` XDR, corroborated
  by the on-chain weight-0 state.
