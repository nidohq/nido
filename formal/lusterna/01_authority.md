# Nido G-account authority campaign

This is a Lusterna focus document, not evidence of implemented behavior. Read the committed `formal_SPEC.md` sections 1–4 and 8, and `SPEC.md` sections 3, 7 and 13 for requirements and trust boundaries.

Target the production pure Rust crate `crates/g-account-core`, proposed crate root `src/lib.rs`. Resolve actual functions from that crate. If it does not exist, report the missing target and stop; do not verify Perch's C-account recovery or create a substitute G kernel inside this run.

Active obligations: **G-01, G-02, G-03, G-04**. Use existing source as the account of actual behavior and preserve every discrepancy from these desired properties:

1. Authority sums registered weights over distinct key identities for each threshold. In MVP, U alone or S+R authorizes; B/S/R alone does not. Duplicate signatures cannot double-count a key.
2. Accepted MVP configurations have master B weight 0, U2/S1/R1, all thresholds 2, no extra signers, and distinct B/U/S/R/F. Unsupported protected mode and extra independent local keys are rejected. Valid supported configurations are accepted; always-refuse is insufficient.
3. Accepted replace-U, recover-U, replace-S and replace-R templates preserve the permanent G/AccountRef, replace exactly the declared signer, retain all unrelated authority fields and refuse unexpected operations/sources or invalid replacement keys. Rejections emit no signing effect.
4. Every accepted final configuration retains the intended daily/recovery coalition predicate, conditional on control and cooperation of surviving keys. Demonstrate the unrecoverable loss combinations explicitly.

Include actual key identity bytes, role assignments, AccountRef components, profile, master weight, complete signer map, thresholds, operation sources and mutation fields in `relevant_state` wherever read by these claims. Keys are not irrelevant metadata. Keep equality and duplicate handling faithful while excluding unrelated text formatting/serde. Do not drop modified fields needed for frame preservation.

Use real function/method `target_patterns` with `crate::` syntax, not module/type wildcards standing in for logic. Declare `anchor_functions` only for real measurements used by the properties, and prove their projections. Prefer direct extraction of the production pure crate; account for any copied bodies or edits against the pristine commit. Preserve deployed overflow behavior and checked arithmetic. Do not hand-edit generated target bodies or mock targets.

Require checked Aeneas WP properties over actual target execution, covering application success and refusal without treating Rust `Err` as an outer execution failure. Add positive witnesses, malformed/duplicate/overflow boundaries and trace/relational supporting lemmas as needed. No assumptions may simply assert the desired result. No target property may be hidden behind a new axiom.

Protected-profile coalition examples are non-production model witnesses only. An authority theorem is not Stellar envelope validation or bootstrap operation-order verification. Keep reserve, sequence, extra-signature and ledger semantics in separate H-01 tests.

Retain theorem-to-obligation mapping, source/extraction diffs, exact assumptions, harness verdict and uncovered requirements. An axiom-clean theorem about a handwritten model alone is not an implementation proof. Do not alter harness-owned checks. Report counterexamples rather than weakening requirements.
