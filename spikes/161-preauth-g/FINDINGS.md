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
  temporary storage entry capped by the network `max_entry_ttl` —
  **3,110,400 ledgers ≈ 180 days at 5s, identical on testnet and mainnet**
  (fetched live from `ConfigSettingStateArchival`, 2026-08-06).
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

---

# Part two (2026-08-06): construction spike — ALL VALIDATED

Three testnet experiments (`part2/a-xlm`, `part2/c-composite`, `part2/d-nonxlm`),
each independently verified on-chain by an adversarial pass (envelope/meta XDR
decoded from Horizon + RPC, hashes recomputed, full account histories audited).
Every open item from part one is now answered. Artifacts: per-experiment
`spike-*.mjs`, `results.json`, `RUNLOG.md`, frozen tx XDR.

## A — production-shaped XLM flow, end to end

Sponsored 0-balance `G` (lived its whole life at exactly 0.0000000 XLM own
balance) → `approve(G, W, 9e18, now+maxTtl−margin)` **before any funding** →
preauth `T1` (SAC transfer to a real factory-deployed C) + preauth `T2`
(`AccountMerge(G→R)`) → master weight 0 → deposit → sweep → stray-deposit
allowance pull → merge. Ledgers 4003966–4003979.

- **Headline: `T1` built with ZERO simulation** and applied cleanly first try.
  Recipe (validated on-chain): footprint readOnly `[native SAC instance]`,
  readWrite `[G account key, SAC Balance(C_dest) contractData key]`; resources
  4M instructions / 50k disk-read / 5k write bytes; declared resourceFee 2M
  stroops (~150k consumed, excess refunded to the outer fee source). The
  part-one open question — freeze `hash(T)` before funds exist — is closed.
- **Fully-sponsored G sweeps to exactly 0.** Min balance is covered entirely
  by the sponsor, so the part-one "1 XLM unsweepable floor" does NOT apply to
  relayer-sponsored burners. Exact-amount `transfer(X)` leaves 0.0000000.
- **AMENDMENT — bare submission is dead for an exact-amount sweep.** The fee
  is charged to source `G` pre-apply, underfunding the transfer; the failed
  apply would burn the signer (CAP-0028). **Fee-bump by R is mandatory** for
  every preauth tx in this design. Safe failure mode confirmed: a bare tx from
  a 0-balance source rejects pre-apply with `txInsufficientBalance` — signer
  and sequence survive, the identical frozen XDR then succeeds fee-bumped.
- **Allowance survives inertness**: `transfer_from` by the spender succeeded
  after master weight 0 (the temp entry is contract data, not a `G` subentry).
- **Preauth `AccountMerge` cleanup works**: CAP-0028 strips the tx's own
  preauth signer *before* ops execute, so the merge sees no subentry; the
  residual allowance entry doesn't block it either. `G` ends as Horizon 404,
  all sponsorships released. **Zero dust; R's whole-lifecycle cost ≈ 0.073 XLM
  in fees**, reconciled to the stroop.
- Sequence choreography that worked: `n+1` approve (live sig) → `n+2` config S
  (both preauth signers sponsored, masterWeight→0 in the last SetOptions) →
  `n+3` T1 → `n+4` T2.

## C — composite invocation: deploy + fund under ONE preauth signer

Wrapper contract (1.3 KB wasm, sdk 27.0.5) calling
`factory.create_account(salt, key)` **and** SAC `transfer(G→C, X)` in one
invocation. Bare unsigned tx under a single preauth signer: C
(`CDTLVXJB…I2RQ`) did not exist before, exists and holds exactly X after —
ledger 4003924. Nested-transfer-only variant also validated (ledger 4003917).

- **Nested `require_auth(G)` clears under SourceAccount credentials at any
  depth.** The auth entry roots at the *sub-invocation* that called
  `require_auth` (the SAC transfer), not the wrapper root. Part one's guard
  (assert every entry is `sorobanCredentialsSourceAccount`) carries over
  unchanged.
- **`factory.create_account` contributes zero auth entries** (invoker-contract
  auth) — the composite's entire auth vector is the single transfer entry.
  Caveat: the live v1 factory does no genesis insert; re-verify the auth
  vector against a v2/genesis factory before production.
- **CRITICAL simulation gotcha**: default recording-mode simulation *rejects*
  nested `require_auth` (`Error(Auth, InvalidAction)`, "not tied to the root
  contract invocation"). Pass `authMode: 'record_allow_nonroot'` as the third
  argument to `rpc.Server.simulateTransaction` (SDK 15.1.0). Apply needs no
  special flag.
- Composite resourceFee ≈ 302k stroops vs ~24k for a plain transfer (~12×) —
  size the overprovision for the deploy, since a resource-exhausted `T` burns
  the signer.

## D — non-XLM asset, zero-dust lifecycle

`NIDO:I` issued asset: CLI SAC deploy (id matches
`new Asset('NIDO', I).contractId()` byte-for-byte) → sponsored 0-XLM `G` →
provisioning S (5 ops: sponsored trustline + two preauth signers + master 0,
one fee-bumped tx) → issuer pays 100 NIDO → preauth `T5` sweeps the trustline
to **exactly 0** (trustlines have no reserve floor) burning to issuer →
preauth `T6` = `[ChangeTrust limit 0, AccountMerge(G→R)]` **multi-op under one
preauth signer** → `G` gone, all 5 sponsorships released, fees reconcile to
the stroop (~104k stroops total incl. one-time SAC deploy). Ledgers
4003925–4003931, everything first-try.

- **`T5` was built simulation-free before the trustline existed** — footprint
  readOnly `[SAC instance, issuer account, G account]`, readWrite `[G's
  trustline key]`. Burn-to-issuer needs no destination entry; a G→C sweep adds
  the SAC `Balance(C)` key instead.
- **Multi-op teardown is the safe merge pattern**: op1 removes the trustline
  subentry before op2's merge executes. `ChangeTrust limit 0` requires balance
  exactly 0 — the exact-amount constraint moves to the trustline (or sweep
  residue via allowance first).
- Per-user marginal cost ≈ 42.6k stroops + 2.5 XLM of R reserves locked only
  for the account's lifetime, fully returned.

## Network config (fetched live, 2026-08-06)

`maxEntryTtl` = **3,110,400 ledgers (~180 days @5s) on BOTH testnet and
mainnet**. `minTemporaryTtl` 720 (testnet) / 17,280 (mainnet);
`minPersistentTtl` 120,960 / 2,073,600. Allowance windows and the re-approve
ladder cadence should be derived from these, not hardcoded.

## SDK 15.1.0 gotchas (will bite implementers)

- The package nests **stellar-base 15.0.0** (top-level 14.0.1 is a decoy).
  `TransactionBuilder.build()` **auto-adds** `sorobanData.resourceFee` to
  `baseFee × ops` — pass the inclusion fee only; pre-adding double-counts
  (experiment A did, harmlessly — declared fees are ceilings and the excess
  refunds to the outer fee source).
- `buildFeeBumpTransaction` is Soroban-aware: it floors `baseFee` against the
  inner *inclusion* rate and computes outer = `baseFee × (innerOps+1) +
  resourceFee`. Accepts an unsigned inner tx.

## Recommended production composition

All pieces are now individually proven; the clean assembly is a **three-rung
preauth ladder** (all fee-bumped by R):

1. `n+1` — `approve(G, C, MAX, now+maxTtl−margin)`, live `G` sig (before any
   funding; needs no balance).
2. `n+2` — config S: sponsored preauth signers for rungs 3–5, master → 0.
3. `n+3` — `create_account` deploy (simulable any time — needs no `G` funds)
   *or* fold into rung 4 as the composite (then simulate with
   `record_allow_nonroot` against a funded decoy, or hand-build the union
   footprint).
4. `n+4` — hand-built (zero-simulation) SAC `transfer(G → C, X)` — the
   validated A recipe.
5. `n+5` — teardown: `[ChangeTrust 0 if any] + AccountMerge(G→R)` after the
   allowance window closes, releasing every sponsored reserve. Zero dust.

Deposits beyond `X` are covered by the rung-1 allowance for ~180 days
(extendable with additional re-approve rungs). Remaining pre-implementation
items: v2/genesis factory auth-vector recheck, deposit watcher, relayer
endpoint plumbing, and the #161 acceptance-criteria UX.
