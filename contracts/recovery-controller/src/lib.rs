#![no_std]
#![allow(dead_code)]

//! Stage 3 of the staged Perch/Nido recovery plan
//! (`firstmate/data/perch-zk-recovery-scout-p5/follow-up.md` §8): a SHARED
//! recovery controller implementing guardian-only, ZK-only, and combined
//! evidence paths against the SAME proposal model
//! (`docs/recovery/TRANSITION_SPEC.md`, Stage 1), completing via Variant A
//! (`docs/recovery/stage2-findings.md`, Stage 2's evidence-based
//! recommendation — no blocker recorded in that document, adopted per the
//! captain's Stage 3 authorization).
//!
//! # Architecture (follow-up.md §5.2)
//!
//! One deployed `RecoveryController` instance is shared across every
//! enrolled account (mirrors `nido-zk-recovery`'s and
//! `nido-recovery-doc-completion`'s pattern). `contract.rs` holds the full
//! lifecycle: `enroll` -> `begin_attempt` -> {`submit_guardian_approval`,
//! `submit_zk_proof`} -> (promoted) -> `Policy::enforce` (completion, via
//! the account's existing `apply_doc`) | `submit_guardian_cancel` /
//! `submit_zk_cancel` (own action domain, follow-up.md §2.2). `zk.rs` is the
//! ZK-verifier adapter: it cross-calls an enrolled `nido-zk-recovery`
//! Merkle pool (root membership) and an enrolled `nido-recovery-verifier`
//! (constructorless `UltraHonk` verifier, `contracts/recovery-verifier`)
//! instance, recomputing the circuit's `auth_hash` on-chain via
//! `zk::compute_doc_auth_hash` — a SELF-CONTAINED Poseidon2 reconstruction
//! (deliberately NOT a `nido-zk-recovery` library dependency; see `zk.rs`'s
//! module doc comment for why: that crate's own `hash::compute_auth_hash`
//! binds a different, deprecated-for-Stage-3 field list, and this circuit
//! — `circuits/zk_recovery_doc`, isolated from `circuits/zk_recovery` — has
//! its own VK/witness shape). The guardian-quorum adapter has no
//! separate module: it is the `submit_guardian_*`/`GuardianSet` logic
//! directly in `contract.rs`, since it needs no cross-contract calls at all
//! (follow-up.md §5.2's HARD requirement: `GuardianOnly` enrollment must not
//! require ANY ZK machinery — enforced at `enroll`, see that fn's doc).
//!
//! `Combined` mode checks BOTH factors against the SAME frozen
//! `ProposalCommitment` before promoting an attempt out of
//! `CollectingEvidence` (`contract.rs::initiation_satisfied`) — there is no
//! path where satisfying one factor alone promotes a `Combined` attempt.
//!
//! # Required properties (follow-up.md §6) — where each is enforced
//!
//! 1. **Enrollment authority** — `enroll` is self-authed and one-shot; no
//!    `reconfigure` path exists (see "Known limits" below), so there is no
//!    downgrade path to guard at all.
//! 2. **Attempt integrity** — `ProposalCommitment` is frozen once at
//!    `begin_attempt` and never mutated; `submit_zk_proof`/`_cancel`
//!    recompute `auth_hash` from the attempt's OWN frozen commitment fields,
//!    never a caller-supplied hash.
//! 3. **Mode integrity** — `mode_has_guardians`/`mode_has_zk` +
//!    `initiation_satisfied`/`cancel_satisfied`; a factor the mode doesn't
//!    require can't be submitted at all (`Error::ModeMismatch`), and a
//!    factor the mode DOES require is never bypassed by the other factor
//!    alone in `Combined` (both are checked with `&&`, not `||`).
//! 4. **Completion integrity** — `Policy::enforce`'s sha256 doc-hash gate
//!    (same mechanism Stage 2 proved for Variant A).
//! 5. **Single completion** — `enforce` deletes... marks `Completed`
//!    in-place; a second completion attempt finds `state != AuthorizedPending`
//!    and fails `NoPending`, in the SAME transaction/ledger or after expiry
//!    alike (state-keyed, not ledger-flag-keyed — direct fix for
//!    follow-up.md §3.1's original-spike gap).
//! 6. **Atomicity** — Soroban's own transaction atomicity: `enforce`'s state
//!    mutation and `crate::doc::apply`'s document install happen inside ONE
//!    top-level operation; a failed doc compile/install reverts the WHOLE
//!    operation including `enforce`'s consumption (proven for Variant A
//!    already in Stage 2's `failed_install_leaves_the_attempt_unspent`
//!    test — this experiment's own `it/recovery_stage3_*.rs` re-proves it
//!    for the mode-dispatching controller).
//! 7. **Compromise postcondition** — `begin_attempt` requires
//!    `action == Compromise` to target EXACTLY `config.baseline_doc_hash`
//!    (`Error::BaselineMismatch` otherwise); the CLIENT constructs
//!    baseline+replacements (never live-doc+replacements) for the target
//!    document evidence providers review before approving — see "Known
//!    limits" for the on-chain trust boundary this implies.
//! 8. **Cancellation integrity** — `submit_guardian_cancel`/`submit_zk_cancel`
//!    use `CancelTally` (separate storage from initiation's
//!    `Attempt::guardian_approvals`/`zk_verified`) and, for ZK, an
//!    `auth_hash` binding `action = Cancel` — cryptographically distinct
//!    from an initiation proof. No entry point accepts bare admin/account
//!    authorization for cancellation at all.
//! 9. **Configuration consistency** — no `reconfigure` path exists (Known
//!    limits); the only "configuration change" possible is enrollment
//!    itself, which is one-shot.
//! 10. **Continued recoverability** — `RevokedCredentials` is permanent,
//!     checked at every `begin_attempt`; nullifiers are released (not
//!     spent) on cancellation/supersede-of-stale-attempt, spent permanently
//!     only on completion.
//! 11. **Isolation and restoration** — every storage key is
//!     account-scoped except the GLOBAL `Nullifier` key space (deliberately
//!     global — a ZK nullifier's whole point is cross-attempt,
//!     cross-account uniqueness).
//!
//! Retained: the account's existing ordinary-admin survival check (no
//! recovery-only accounts) — this experiment adds no code to the smart
//! account at all (Variant A), so that invariant is untouched by
//! construction.
//!
//! # Known limits (explicit, per the brief's "document every limit"
//! directive — none of these are silent gaps)
//!
//! - **No `reconfigure` entry point.** Enrollment is one-shot and
//!   permanent; baseline updates, guardian-set rotation, mode/profile
//!   changes, and verifier upgrades all require a FRESH account (or a
//!   production implementation adding a properly-gated reconfigure path per
//!   follow-up.md §2.1/§4.3 — Protected-profile changes need admin PLUS the
//!   current recovery condition, using this same evidence machinery against
//!   an `action = Reconfigure` commitment domain, which this experiment does
//!   not implement).
//! - **`policyWriteConflictPolicy` (Stage 1 spec) is not a separate axis.**
//!   Only `pending_activity_policy` (`Freeze`/`Continue`) exists, applied to
//!   the ONE guard hook that exists on the account (`apply_doc`'s
//!   `guard_no_pending`). Stage 1's `invalidate-attempt` behavior (allow an
//!   ordinary doc write through but invalidate a conflicting `LostKey`
//!   attempt's stale source snapshot) is not implemented.
//! - **`replaced_credential_ids` is client-declared, not on-chain-verified
//!   against the target document.** This contract only ever checks
//!   `sha256(doc) == target_doc_hash`; it has no doc-parsing access of its
//!   own. `RevokedCredentials` bookkeeping (property 10) and the
//!   `REVOKED_CREDENTIAL_REVIVED` check at `begin_attempt` are therefore
//!   enforced over the DECLARATION, not the document's actual content — a
//!   client that declares no replacements while installing a document that
//!   both adds and removes different credentials would not be caught by
//!   this contract. The real guarantee is `target_doc_hash` exactness
//!   (property 4/7); document CONTENT correctness (does the target really
//!   equal baseline+replacements, does it really omit the attacker's
//!   planted signer) depends on evidence providers reviewing the
//!   target-document preview (client/SDK responsibility) before approving —
//!   exactly the trust boundary Stage 2's Variant A already has for its
//!   single-authority evidence.
//! - **No "ordinary execution" freeze**, only the doc-write + rule-mutation
//!   guard. `has_pending` (this contract) is cross-called by the account's
//!   `guard_no_pending` (`contracts/smart-account/src/contract.rs`), which
//!   gates `apply_doc` AND `remove_signer`/`remove_context_rule`/
//!   `remove_policy`/`update_context_rule_valid_until` — but NOT
//!   `execute()` (`contracts/smart-account/src/contract.rs::execute`, the
//!   arbitrary-contract-call entry point: bare `require_auth` +
//!   `invoke_contract`, no guard at all, confirmed by reading it directly).
//!   Stage 1's §7 axis also covers this broader "ordinary execution during
//!   pending recovery" surface; closing it needs a NEW guard hook on
//!   `execute()`, a smart-account code change out of scope for Variant A
//!   ("zero smart-account changes").
//! - **Pre-existing risk, NOT introduced by this experiment, NOT closed by
//!   it either: `add_context_rule`'s own "completion window" check**
//!   (`contracts/smart-account/src/contract.rs::add_context_rule`, predates
//!   Stage 2/3) admits ANY ordinarily-admin-authorized call — not just a
//!   doc-hash-bound completion — to install an ARBITRARY new `ContextRule`
//!   (any signers, any policies) whenever a cross-called controller's
//!   `has_pending()` reports `true`. This contract's `has_pending`
//!   (`Freeze` policy + a live attempt) makes that condition true exactly
//!   like Stage 2's `nido-recovery-doc-completion::has_pending` already
//!   does — so during a `Freeze`-policy account's pending recovery, an
//!   ordinary admin signature (not the recovery rule) can still call
//!   `add_context_rule` directly and install unrelated authority. Variant
//!   A's own binding (the sha256 doc-hash gate in `Policy::enforce`) only
//!   constrains completions that go THROUGH `apply_doc`; it does nothing to
//!   close this SEPARATE vehicle, which follow-up.md §3.1 already
//!   identifies as the exact class of gap the original spike's
//!   `CompletionGrant` boolean created. This is inherited, shared
//!   infrastructure risk (any `has_pending`-reporting controller has it,
//!   including Stage 2's), not something Stage 3 makes worse — but it is
//!   also not fixed here: doing so needs either a smart-account change to
//!   `add_context_rule` (out of scope) or every controller's `has_pending`
//!   to somehow distinguish "why" it is being asked, which the current
//!   `bool`-only view cannot express.
//! - **`PendingActivityPolicy::Restrict` is unimplemented by design** (see
//!   `types.rs`) — `enroll` refuses it. This is the "no default" property
//!   made concrete: `Freeze`/`Continue` are both real, both chosen
//!   explicitly; `Restrict` exists in the type but is refused everywhere.
//! - **Guardian evidence has no timeout-driven bypass** (satisfies the
//!   follow-up.md §2.2 HARD requirement directly — there is no code path
//!   that promotes an attempt without the required approvals/proof simply
//!   because time has passed; an under-evidenced attempt just expires
//!   unpromoted).
//! - **`enroll` does not, and cannot, wire the account to this controller.**
//!   `enroll` only writes `Key::Config(account)` in THIS contract's own
//!   storage. For that configuration to matter at all, the ACCOUNT's own
//!   `recovery_controller` field (`contracts/smart-account`) must
//!   separately equal this controller's address — set once at account
//!   construction, or afterward via the account's own
//!   `enroll_zk_recovery`. `enroll` cannot establish that itself: it is a
//!   cross-call arriving FROM the account (or an equivalent caller), with
//!   no `require_auth`-clean way to reach back and mutate the caller's own
//!   wiring field as a side effect. A caller that enrolls against a
//!   controller the account was never wired to (or was wired to a
//!   DIFFERENT, earlier controller) gets a config that is stored but
//!   inert — nothing ever cross-calls `has_pending`/`Policy::enforce` on
//!   it. This is exactly the bug a captain live-test caught on a real
//!   testnet account (wired to an earlier, unrelated recovery pool; this
//!   controller's `enroll` silently "succeeded" and did nothing). Fixed at
//!   the SDK/UI layer, not here: `packages/passkey-sdk/src/recoveryStage3/
//!   accountWiring.ts`'s `checkAccountWiring` must be called — and must
//!   report `'wired-to-target'` — before `enroll` is ever submitted; the
//!   experimental page (`recover-v3`) now enforces this both as a disabled
//!   button and as a defensive re-check inside the click handler itself.
//!   There remains no contract-level enforcement that `enroll` matches the
//!   account's actual wiring — a production implementation would need
//!   either the account to pass proof of its own `recovery_controller`
//!   value into `enroll`, or `enroll` itself to become account-authorized
//!   and cross-call the account to verify wiring atomically.
//! - **Recovery configuration is NOT embedded in the account's Perch
//!   policy document**, despite follow-up.md §5.5 asking for "a reviewable
//!   configuration ... with an accurate commitment." Investigated and
//!   confirmed unreachable, not merely unimplemented: (1) `@stellar-
//!   registry/perch`'s `policyDocSchema` is Zod `.strict()` — no top-level
//!   extension fields, so a `recovery` key cannot simply be added to the
//!   doc shape client-side; (2) the schema DOES have a `self-authenticating`
//!   principal shape that could plausibly carry an arbitrary policy
//!   address, but nido's own lowering
//!   (`packages/passkey-sdk/src/policyDoc/lower.ts::lowerRule`)
//!   unconditionally throws for it (`"self-authenticating rules need a
//!   policy-call op not in program v1"`) — never reaches the wire; (3) the
//!   decisive blocker: the REAL doc compiler is not nido code at all — it
//!   is a separately deployed, version-pinned `perch-doc-compiler` Soroban
//!   contract that `contracts/smart-account/src/doc.rs::apply` cross-calls.
//!   Its wire-level `CompiledRule` type (`doc.rs`) has exactly six fields —
//!   `cap`, `install` (hardwired to the fixed interpreter's own policy-
//!   install program), `name`, `scope`, `signers`, `valid_until` — with NO
//!   field capable of carrying an arbitrary policy contract address, let
//!   alone a `RecoveryConfig`. `doc.rs`'s own `DOC_RIDS` comment states
//!   plainly that rules installed via `apply_doc` never include the
//!   recovery rule. Embedding recovery configuration in the doc would
//!   require changing that EXTERNAL, pinned dependency's wire protocol —
//!   out of scope for an experiment working against nido's own crates only.
//!   Addressed instead with an equivalent, independently verifiable
//!   substitute: `RecoveryController::config_hash(account) ->
//!   Option<BytesN<32>>`, `sha256(xdr(RecoveryConfig))` using Soroban's own
//!   `ToXdr` (deterministic canonical serialization) — a real, on-chain,
//!   recomputable commitment to the FULL enrolled configuration, reviewable
//!   the same way `applied_doc_hash` is, just not literally inside the
//!   doc's own JSON. `packages/passkey-sdk/src/recoveryStage3/reads.ts::
//!   readConfigHash` and the `recover-v3` Status panel surface it.

pub mod contract;
pub mod types;
pub mod zk;

pub use contract::{RecoveryController, RecoveryControllerClient, RecoveryInstallParams};
