# Nido G-account signing, policy and budget campaign

This is a Lusterna focus document. Read committed `formal_SPEC.md` sections 3, 6 and 8–9, plus `SPEC.md` sections 9 and 11–13. Target the implemented pure signing-role, policy-composition and fee-budget logic in `crates/g-account-core`. Resolve the actual functions; if absent, report missing implementation and stop.

Active obligations: **A-01, A-02, P-01, B-01, B-02**. Report actual source behavior and discrepancies from these requirements without silently narrowing them:

1. Fee requests emit only the bound F command; recovery emits only bound S. Preserve tenant, AccountRef, treasury, registry mapping, role, purpose, network, expected key, digest and request identity. Caller-selected provider handles and unsupported daily co-sign actions refuse.
2. Signing authorization and accepted provider response refer to the exact immutable reviewed request. Wrong role/key/network/digest refuses. Real XDR/hash/crypto/provider normalization is external unless actually included as a target; do not turn equality of input digests into an end-to-end byte-signing proof.
3. Policy composition requires every required layer to be present and allow without errors, plus valid inputs and kernel acceptance. For fixed authenticated facts, tightening one layer cannot widen acceptance. Cedar's evaluator and authentication are separate adapter boundaries.
4. Reserve maximum signed fee liability before F authorization. Across all admitted transitions, charged fees in the relevant window plus outstanding liability remain within its allowance. Check arithmetic and reject limit reductions below committed exposure. Consistent settlement replaces reserved maximum by actual fee; inconsistent evidence must not free capacity.
5. Identical retries reuse reservations; conflicting contents refuse. Unknown outcomes retain exposure. Cancellation/timeout does not release possibly signed envelopes. Release requires chain evidence of settlement or impossibility of future execution. Rollover retains outstanding liabilities and accounts for delayed/repeated settlement without double charging or erasing exposure.

Include every quantity and identity used by the invariant in `relevant_state`: maximum liability, fee amount, window, allowance, reservation records/status, settled charges, immutable request, uncertainty and evidence tags. Retain key/tenant/network bytes and fixed-width checked arithmetic. Projected totals need a proof against actual summation/getter functions if the claims use those measurements.

Require defined extracted execution with checked single-call properties covering accepted/refused outcomes, positive witnesses and arithmetic boundaries. Add relational monotonicity and inductive budget conservation as justified helpers grounded in those calls. Include initialization, reserve, retry, settlement, expiry, limit changes and rollover; omitting an event invalidates a whole-trace invariant.

Do not prove database atomicity, provider integrity or cryptographic verification by assuming a high-level `authorized` boolean. State precise trusted-fact boundaries and retain required adapter tests: reservation races, cross-tenant key lookup, provider response loss, wrong signatures, stale restore, delayed settlement and window changes.

Use faithful production extraction, preserve its deployed arithmetic profile, and report source edits/assumptions. No mock targets, hidden axioms, altered proof gates or weakened requirements. The final evidence must map required IDs to actual executed target theorems and distinguish clean, conditional, refuted, missing and unresolved results.
