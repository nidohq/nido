# Initial Nido G-account verification run: unverified

The setup and end-to-end campaign ran, but **0 of 41 campaign claims were
established**. All 41 remain dependent on `sorryAx`. This result provides no formal
assurance for G-01, G-02, G-03 or G-04, and no property was refuted.

The proof agent reached its $15 stage limit (reported charge $15.03136115) after
184 turns. Its unfinished edits did not compile. The unchanged harness restored
the last compiling commit, retained the equality-helper work, and correctly
reported the 41 still-open statements. A normal outer CLI exit did not override
that failure. `Helpers2.contains_key_spec` also remains a placeholder; retained
helper work is not completion of the campaign obligations.

## Evidence reviewed

- All 41 accepted statement fingerprints are stable; no weakened, removed or
  unaccounted statements. The final campaign spec is byte-for-byte the accepted
  statement baseline, with all campaign proof bodies still open.
- Zero implementation proofs on standard axioms, zero assumption-dependent
  campaign proofs, zero established abstract campaign lemmas, and no refutations.
- Both measurement anchors, authorization_weight and can_authorize, remain
  ungrounded because their execution bridges are unproved.
- No declared or illegitimate assumptions were added. The unused generated
  Option PartialEq axiom remains outside the six target dependency footprints.
  Do not whitelist it merely to make a future proof pass; any use needs explicit
  justification and a clearly conditional result.
- Candidate Rust and generated target bodies did not change during proving.
  The pinned runtime fixture, extraction review and checked-overflow gate passed.
  The final Lean build succeeds with proof placeholders; build success is not
  proof success.

## Cost and retained state

Conservative ledger: **$44.1328054 charged / $50 authorized**; no pending or unknown
reservations. **$5.8671946 remains authorized.** No credits were purchased and no
new allowance was assumed. The accounting deliberately retains full returned
resumed-session costs and is not a provider invoice.

Seed: `41a9ae899813d3dc54f686a4b28bcce3a8253326`.
Accepted statement commit: `520563eb6b743884f189446bf3eb94d6d08f5aaf`.
Final exported result: `dad952c775d29d12bc741329f92873ed2a960073`.
Result branch: `lusterna/nido-authority-20261110-01`.
All 31 numbered checkpoints, stage logs, review decisions and budget entries are
retained in the lean-agent `.state` directory. The harness stopped its container
normally after the report. Final review acknowledges this unsuccessful initial
outcome and releases the credential-holding worker to exit; it does not approve
any verification claim.

## Scope and next proof work

This campaign concerns the isolated candidate pure authority kernel only.
Recovery delays, Cedar policies, signer/fee APIs, custody-provider integration,
signature authenticity, passkey/browser behavior and Stellar ledger/XDR execution
remain outside its scope. The original Nido working tree was not changed by this
campaign. Nothing was pushed, merged or deployed.

A further proof campaign should reuse and dependency-check the retained equality
lemmas, then close contains_key membership and validate correctness before weight,
authorization, rotation and recovery compositions. Preserve the accepted statements
and report partial results explicitly. An initial run ending with unresolved proofs
is not evidence of a counterexample or of the architecture being safe.

## Saved artifacts

- [Kernel verdict](VERIFICATION_REPORT.md)
- [Machine-readable axiom report](axioms.json)
- [Full generated report](campaign-report.md)
- [Theorem-to-requirement map](coverage.md)

The generated narrative is subordinate to the kernel verdict and this supervisor
review. In particular, an unapproved axiom is not a routine workaround for a failed
proof gate. The saved visual includes this unverified outcome and actual costs.
