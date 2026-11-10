# Nido G-account recovery campaign

This is a Lusterna focus document. Read committed `formal_SPEC.md` sections 3, 5 and 8–9, plus `SPEC.md` sections 5, 10 and 13. Target the implemented recovery/intent/signing transitions in production `crates/g-account-core`. If absent, report missing implementation and stop. Do not replace them with Perch C-account recovery or a proof-only model.

Active obligations: **R-01, R-02, R-03, R-04**, with the recovery portions of **A-01/A-02**. Reuse authority proofs only if their exact implementation and assumptions remain valid. The source determines actual behavior; report differences from these requirements:

1. Evidence binds complete tenant/network/kind/address, purpose/version, attempt, target U', relevant authority, policy digest, monotonic revision and expiry. Final approval binds exact transaction digest, S identity/role and immutable request. Reject every mismatched field, stale approval and mixed-attempt proof.
2. Initialized valid states preserve the lifecycle, immutable target and one active attempt. No signature authorization precedes required evidence, fresh facts, elapsed delay or exact approval. Cover timestamp/revision bounds and all refusal paths. Defaults are parameter values, not the only cases to prove.
3. Successful cancellation before the durable Ready-to-Signing boundary prevents later authorization for that attempt. After that boundary, cancellation cannot promise no signature. Prove both event orderings and stale-version rejection, connected to real single-operation properties.
4. Identical retries retain one logical immutable command. Conflicting content refuses. Provider response loss is Indeterminate; Refused needs evidence that no usable signature exists. Terminal/stale attempts cannot authorize new bytes. Reconciliation checks the actual request and ledger result. Recovery-session evidence does not authorize ordinary spending or arbitrary key selection.

Preserve every relevant identity, key, purpose, digest, revision, timestamp, lifecycle tag, immutable request field and uncertainty state in extraction. Keep authenticated evidence distinct from caller booleans. Do not erase tenant or network identity as framework metadata.

Model the durable authorization/outbox result separately from external signing. Provider dispatch may be retried for the same command; do not assert exactly-once HTTP execution or atomicity across the database, signer and ledger. Cryptography, trusted time/freshness, database CAS and restore reconciliation are explicit external assumptions with separate tests. Already released signatures cannot be recalled by a state flag.

Use real target functions, checked WP statements for execution and ordinary success/refusal values, plus justified relational/trace lemmas. Prove a valid initial state and all relevant event preservation, not just happy-path transition cases. Include accepted recovery witnesses to exclude an always-refuse implementation.

Required negative traces include cancel/finalize races, duplicate finalization, new digest under an old idempotency key, A-to-B-to-A state changes, stale restore, wrong target/network/operator approval, provider-signs/response-lost and delayed confirmation. Retain limitations and counterexamples as findings.

Keep the source baseline immutable in meaning; review all extraction edits. Do not weaken statements, mock targets or modify harness-owned gates. Record exact theorem/requirement coverage, assumptions, grounding, axiom verdicts and any remaining bridge or host-test gaps.
