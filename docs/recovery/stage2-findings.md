# Perch/Nido recovery — completion-mechanism comparison findings

**Status:** Design decision record. This document compares two ways to
complete a doc-hash-committed recovery attempt against the doc-only smart
account and records why Variant A (authorizing the existing `apply_doc`, no
smart-account code changes) was adopted — see `contracts/recovery-controller`
for where that decision is implemented, and the integration tests under
`crates/integration-tests/tests/it/recovery_stage2_*.rs` for the comparison
itself.

**Builds on:** the transition model in `docs/recovery/TRANSITION_SPEC.md`
(PR [#204](https://github.com/nidohq/nido/pull/204)). This document cites
that spec by section throughout.

## 1. What this experiment builds

A single new contract, `contracts/recovery-doc-completion` (crate
`nido-recovery-doc-completion`), implements a minimal doc-hash-committed
recovery attempt lifecycle (`enroll`/`initiate`/`cancel`, plus an OZ `Policy`
completion gate) against a **controlled test authenticator** — a designated
`authority: Address` requiring ordinary Soroban `require_auth()` — standing in
for guardian quorum or a verified ZK proof. A controlled test authenticator
isolates lifecycle behavior, but is not evidence that the production ZK flow
works. No circuits, no Merkle pool, no nullifiers — those belong to the
end-to-end experiment described in `docs/recovery/stage3-measurements.md`.

The controller's `Policy::enforce` (`contracts/recovery-doc-completion/src/lib.rs`)
accepts a completion call whose `fn_name` is EITHER `apply_doc` or
`complete_recovery`, with exactly one `Bytes` argument whose sha256 equals the
attempt's committed `target_doc_hash` — this single gate is what both variants
below share; they differ only in which smart-account entry point a completion
targets.

- **Variant A** — the controller's zero-signer `CallContract(self)` rule gates
  the account's EXISTING `apply_doc` (`contracts/smart-account/src/contract.rs:617-621`,
  unchanged). Zero smart-account code changes.
- **Variant B** — a NEW, dedicated `complete_recovery` entry point
  (`contracts/smart-account/src/contract.rs`, added for this comparison) that
  calls the exact same internal `crate::doc::apply` pipeline `apply_doc`
  uses — a shared private pipeline, with no exported raw mutator.

Both variants exercise **real account authorization**: the completing call is
driven through `env.set_auths` with a genuine `SorobanAuthorizationEntry`
selecting the recovery rule's `context_rule_id` (no `mock_all_auths` on the
completing call, mirroring `zk_recovery_completion.rs`'s own
`real_proof_completion_rotates_key_via_enforce` pattern) — so `__check_auth`,
`do_check_auth`, and `Policy::enforce` all run for real, and the document is
installed through the REAL perch doc-compiler (fetched on-chain bytes, same
fixtures `apply_doc.rs` uses).

## 2. Evidence table

Property numbers below refer to the numbered "Required properties" list in
`contracts/recovery-controller/src/lib.rs`, which this experiment's design
also targets. Every row is a passing test in `crates/integration-tests/tests/it/`.

| Property | Variant A test | Variant B test |
| --- | --- | --- |
| Exact target document becomes effective; `applied_doc_hash` accurate (property 4) | `recovery_stage2_variant_a::completion_installs_exact_target_document` | `recovery_stage2_variant_b::completion_installs_exact_target_document` |
| Single completion — repeat in same ledger refused (property 5) | `...variant_a::repeat_completion_in_same_ledger_is_refused` | `...variant_b::repeat_completion_in_same_ledger_is_refused` |
| Single completion — after expiry refused (property 5) | `...variant_a::completion_after_expiry_is_refused` | `...variant_b::completion_after_expiry_is_refused` |
| Before timelock elapses, refused | `...variant_a::completion_before_timelock_is_refused` | `...variant_b::completion_before_timelock_is_refused` |
| Failed compile/install leaves the attempt unspent, account unchanged (property 6, atomicity) | `...variant_a::failed_install_leaves_the_attempt_unspent` | `...variant_b::failed_install_leaves_the_attempt_unspent` |
| Wrong document (hash mismatch) rejected even with correct rule/timing (attempt integrity, property 2) | `...variant_a::wrong_document_is_rejected_by_enforce` | `...variant_b::wrong_document_is_rejected_by_enforce` |
| Ordinary admin/generic authorization cannot use the recovery-only authority | `...variant_a::ordinary_authorization_cannot_complete_even_the_exact_document` | `...variant_b::ordinary_authorization_with_no_attempt_is_refused`, `...variant_b::ordinary_authorization_cannot_complete_even_with_a_ready_matching_attempt` |

Controller-level unit tests (`contracts/recovery-doc-completion/src/lib.rs`,
`mod tests`) additionally cover: enrollment is one-shot and self-authed;
`initiate`/`cancel` require the enrolled authority's real auth; no silent
supersede of a live attempt (`docs/recovery/TRANSITION_SPEC.md` §8); an
expired attempt can be re-initiated; and the completion grant is single-use
by construction.

All 105 integration tests plus every existing crate's unit tests pass
unmodified (`just test`); `just check` (fmt + `clippy -D clippy::pedantic`)
is clean for every touched crate. No existing test, fixture, or behavior was
changed — both variants are purely additive.

## 3. Call-ordering analysis (the `CompletionGrant` problem)

Soroban resolves `__check_auth` — and therefore `Policy::enforce` — **before**
the entry point's body runs, at the point `require_auth()` is called (the
first line of both `apply_doc` and `complete_recovery`). The earlier
zk-recovery prototype's `add_context_rule` completion gate needed a
`CompletionGrant(account) = ledger_sequence` side channel purely to bridge
this gap: by the time the body's `has_pending()` check ran, `enforce` had
already deleted the very state that check was looking for. That fix has a
real cost: the grant is a **ledger-scoped boolean**, and the body's gate
(`has_pending() || completion_granted()`) doesn't care *which* context rule
authorized the call — so an ordinary admin-authorized `add_context_rule` call,
using the account's OWN signing rule (not the recovery rule at all), also
passes whenever a recovery happens to be pending or was just completed in the
same ledger.

**Variant A needs no such bridge, and no such gate.** `apply_doc`'s only
body-side check is `guard_no_pending` (`contract.rs:619`) — a **block-while-
pending** condition, the opposite polarity from "permit only when completing".
Because `enforce` deletes the attempt as part of authorizing the completing
call, by the time that SAME call's body runs, `has_pending()` already reads
`false` — so the guard simply does not fire, for exactly the one call that
legitimately needs to get through. No new storage, no flag, no window wider
than the single invocation that earned it. An ordinary admin-authorized
`apply_doc` call **using the account's own rule** is independently blocked by
the SAME guard while an attempt is genuinely live (`recovery_stage2_variant_a::
ordinary_authorization_cannot_complete_even_the_exact_document` proves this
holds even for the exact, correct target document) — and once an attempt is
gone (consumed by a real completion, or because none ever existed), an
ordinary `apply_doc` call is just ordinary admin activity, which is supposed
to work. There is no scenario in which "recovery happened recently" grants
capability to a call that didn't itself go through the recovery policy: the
binding is entirely in `enforce`'s own argument check, not in any state the
body has to interpret after the fact.

**Variant B cannot avoid the bridge, because it inverts the polarity.** A
dedicated, recovery-only entry point needs to permit *only* the completing
call — but by the time its body runs, `enforce` has already consumed the one
piece of state (`Pending`) that would let the body verify that itself. Unlike
`add_context_rule`'s general "any self-call, any new rule shape" surface —
exactly the kind of raw mutator this design avoids exposing — `complete_recovery`
only ever accepts a `doc_json: Bytes` and always routes it through the shared
validated pipeline (`crate::doc::apply`) — so the fix here is not "stop
exporting a raw mutator" (there never was one) but "make the hand-off itself
unforgeable". This experiment's `complete_recovery`
(`contracts/smart-account/src/contract.rs`) does that with a **value-bound,
single-use grant**: `enforce` writes `CompletionGrant(account) =
target_doc_hash` (not a boolean, not a ledger sequence) the instant it
consumes the attempt, and the body's very next action is
`take_completion_grant`, which reads-and-deletes it in one call. This closes
both failure modes of the original design at once:

- **Wrong document.** Even if some other call happened to also read a stale
  grant, it would only match one specific document — and since a fresh
  invocation's own `enforce` (if it ran at all) always writes the grant
  immediately before the body reads it, there is no cross-invocation window at
  all in practice (see below).
- **Wrong authorizer.** If the caller satisfies `require_auth()` via the
  account's OWN admin rule instead of the recovery rule, `enforce` never runs,
  no grant is ever written, and `take_completion_grant` returns `None` —
  proven by `ordinary_authorization_with_no_attempt_is_refused` (no attempt at
  all) and, more decisively,
  `ordinary_authorization_cannot_complete_even_with_a_ready_matching_attempt`
  (a live, READY, matching attempt exists, but the call's own auth didn't go
  through the policy that would have granted it).

Because Soroban executes one top-level operation's entire call tree — auth
resolution and body — before the next operation in a transaction begins, the
grant is written and consumed within a single, uninterruptible invocation
whenever it is written at all; there is no multi-operation race window to
defend against separately. The residual complexity Variant B carries relative
to Variant A is exactly this hand-off primitive — smaller and narrower than
the earlier prototype's ledger-flag (value-bound, single-read, one document),
but a piece of machinery Variant A does not need at all.

## 4. Recommendation

**Variant A (recovery authorizes the existing `apply_doc` operation) is the
recommended completion mechanism.** The preferred design is to make recovery
authorize the existing document-apply operation, falling back to a dedicated
recovery entry point that calls the same internal pipeline only if call
ordering or lifecycle makes the first option unsuitable. This experiment
found no such obstruction:

1. **Zero smart-account surface added.** Variant A required no new entry
   point, no new error codes, and no change to `apply_doc`/`doc.rs` at all —
   the existing `guard_no_pending` check already has the correct polarity for
   completion, for the call-ordering reason in §3. Variant B necessarily adds
   both a new entry point and a value-bound grant primitive to bridge the
   ordering gap — strictly more surface for the same net capability.
2. **No completion-grant class of bug is possible for Variant A.** Because
   there is no hand-off state at all, there is nothing for an unrelated
   authorization path to misread — the exact bug class documented above (§3)
   against the earlier prototype's `add_context_rule` gate cannot recur here
   by construction, not merely by a narrower, hardened version of the same
   primitive (which is what Variant B's grant is).
3. **Both variants are equally strong on document binding, atomicity, and
   timing** (§2's evidence table) — the two mechanisms differ only in the
   call-ordering handling in §3, not in what they ultimately authorize or how
   precisely they bind to the target document.
4. **Variant B remains a legitimate fallback**, proven safe in this
   experiment's tests, for any future case where the completion vehicle
   cannot reasonably be an already-existing general entry point (e.g. if a
   future doc-only surface has no single natural "apply a document" op to
   reuse, or the recovery result needs a distinct return shape/side effect
   from ordinary application). Its extra cost — the value-bound grant — is
   modest and well-understood, not a reason to avoid it if a future design
   genuinely needs a dedicated vehicle.

This recommendation is a design input for the next stage of work, not a
self-authorizing decision — see `docs/recovery/stage3-measurements.md` for
how it was carried forward into the end-to-end experiment.

## 5. Known simplifications (explicitly out of scope for this experiment)

- **Controlled test authenticator, not guardian/ZK evidence.** `initiate`/
  `cancel` require a single designated `authority` address's ordinary
  `require_auth()` — real Soroban authorization, but not a proof of anything
  beyond "this address signed". This isolates lifecycle behavior for this
  experiment; nothing about the production ZK flow can be inferred from it.
- **No cancellation-domain separation.** `cancel` reuses the SAME authority
  evidence as `initiate` rather than a distinct `action: "cancel"` commitment
  (see `docs/recovery/TRANSITION_SPEC.md` §4). A production implementation
  must not skip this — it exists specifically so a leaked initiation approval
  cannot double as a cancellation approval.
- **No baseline/replacement modeling, no configuration versioning, no
  pending-activity-policy parameterization.** This experiment attaches
  directly to a single account's live document via a bare `target_doc_hash`;
  it does not model lost-key vs. compromise targets, replaceable-role
  enrollment, or the pending-activity/policy-write-conflict gate (still
  open — see `docs/recovery/TRANSITION_SPEC.md` §10). Those are already
  specified in the transition spec and are concerns for the end-to-end
  experiment (`docs/recovery/stage3-measurements.md`) and beyond, not for
  this comparison.
- **One shared controller, two fn_names.** `enforce` accepts either
  `apply_doc` or `complete_recovery` on the SAME deployed instance, purely to
  avoid duplicating the (identical) attempt lifecycle and document-binding
  logic across two crates for this comparison. A production deployment would
  ship whichever ONE variant is chosen, not both.
