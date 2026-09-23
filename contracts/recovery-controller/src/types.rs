//! Storage types, error codes, and events for the shared recovery
//! controller (see `docs/recovery/TRANSITION_SPEC.md` for the fuller
//! lifecycle this crate implements a variant of).
//!
//! One controller instance is shared across accounts (mirrors
//! `nido-zk-recovery`'s and `nido-recovery-doc-completion`'s pattern);
//! per-account state is keyed by `Address` throughout.

use soroban_sdk::{contracterror, contractevent, contracttype, Address, Bytes, BytesN, Vec};

/// Which evidence factor(s) an account's recovery requires. `GuardianOnly`
/// is a HARD requirement: it must not require ANY ZK machinery — no secret,
/// no Merkle witness, no proof. Enforced at `enroll` (see `lib.rs`), not
/// just documented here.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthMode {
    GuardianOnly,
    ZkOnly,
    Combined,
}

/// Routine recovery-CONFIGURATION change authority: `Loss` needs only the
/// account's own auth to `reconfigure`; `Protected` additionally needs the
/// currently-enrolled factor's evidence (see `contract.rs::reconfigure` and
/// the crate doc comment's "Known limits"). Retained on `RecoveryConfig`
/// because it is part of the account's reviewable commitment.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Profile {
    Loss,
    Protected,
}

/// Which target-document construction rule an attempt uses (see
/// `docs/recovery/TRANSITION_SPEC.md`). Encoded as the circuit/commitment's
/// numeric `action` too — see `lib.rs::action_code`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RecoveryAction {
    LostKey,
    Compromise,
}

/// The action tag baked into a `ProposalCommitment` and, for ZK evidence,
/// into the circuit's `auth_hash` (via
/// `nido_zk_recovery::hash::compute_auth_hash`'s `action` parameter) — this
/// is cancellation-domain separation: a `Cancel` commitment is structurally
/// and cryptographically distinct from the `LostKey`/`Compromise` commitment
/// it targets, so initiation evidence can never double as cancellation
/// evidence.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitmentAction {
    LostKey,
    Compromise,
    Cancel,
}

/// Deliberately deferred, NO default. Mirrors
/// `TRANSITION_SPEC.md`'s three-way `pendingActivityPolicy` enum exactly
/// (including the symbolic, deliberately-unimplemented third branch) so the
/// "no default" property is a real, testable refusal rather than a type that
/// simply omits the unresolved option. `Freeze`/`Continue` are real and
/// tested; `Restrict` is accepted by the TYPE but REJECTED by `enroll`
/// (`Error::UnresolvedPolicyBranch`) — an account can be offered the choice
/// and see it explicitly refused, exactly like
/// `packages/recovery-spec/src/model.ts`'s `restrict`/`other` branches
/// throwing `UNRESOLVED_POLICY_BRANCH` with no `default:` case. See the
/// crate doc comment's "Known limits" for what `TRANSITION_SPEC.md`'s
/// separate `policyWriteConflictPolicy` axis (`invalidate-attempt` vs
/// `block`) would add on top of this — not implemented here.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PendingActivityPolicy {
    /// Ordinary `apply_doc` calls are blocked (`has_pending` reports `true`)
    /// while a live attempt exists for the account, exactly like
    /// `nido-recovery-doc-completion`'s `Freeze` behavior.
    Freeze,
    /// Ordinary `apply_doc` calls are NEVER blocked by a live attempt
    /// (`has_pending` always reports `false`) — a compromised admin can keep
    /// rewriting the document until a recovery actually completes. This is
    /// an accepted risk; choosing it is an explicit, informed choice made at
    /// enrollment, not a default.
    Continue,
    /// Symbolic placeholder for a capability-scoped restriction that "can
    /// preserve essential activity while limiting specific risks".
    /// Unimplemented, deliberately — `enroll` refuses this value with
    /// `Error::UnresolvedPolicyBranch` rather than silently treating it as
    /// `Freeze` or `Continue`.
    Restrict,
}

/// Guardian quorum configuration. `threshold`
/// must be `1 <= threshold <= guardians.len()`; enforced at `enroll`. NOT a
/// `#[contracttype]` struct nested via `Option<GuardianSet>` inside
/// `RecoveryConfig` — soroban-sdk 27's `ScVal` conversion derive does not
/// support `Option<CustomStruct>` (confirmed empirically: `RecoveryConfig`
/// fails to compile with `ScVal: TryFrom<&Option<GuardianSet>>` unsatisfied
/// otherwise). `RecoveryConfig` instead stores the flattened
/// `guardians: Vec<Address>` / `guardian_threshold: u32` fields directly
/// (empty `guardians` means "not configured", mirroring `verifier`/`zk_pool`'s
/// `Option<Address>` — `Address` alone nests fine, only multi-field custom
/// structs hit this). This plain type exists only as an ergonomic
/// constructor/grouping for callers building a `RecoveryConfig`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GuardianSet {
    pub guardians: Vec<Address>,
    pub threshold: u32,
}

/// Recovery configuration for one account — the reviewable
/// recovery-configuration commitment: mode, profile, guardian
/// identities/quorum, verifier identity, baseline commitment. Fixed at
/// enrollment and, after that, mutable only through `reconfigure`'s narrow
/// additive path (see `contract.rs::reconfigure` and the crate doc
/// comment's "Known limits"). NOT embedded in the account's own Perch
/// policy document — this controller keeps recovery configuration entirely
/// in its own storage, so an account's document canonical bytes are
/// UNCHANGED by enrolling in recovery (see `lib.rs` tests
/// `enrolling_does_not_touch_the_account_doc`).
///
/// `reconfigure` only ever adds a missing evidence factor — it explicitly
/// refuses any change to `version` (`ReconfigureFieldMismatch`), so
/// `version` currently only ever reads `1`. It remains a real `u32` field
/// (not a constant) so a future, broader reconfigure path could bump it
/// without an ABI change, giving the `ProposalCommitment.config_version` /
/// circuit `cfg_version` fields a real value to bind rather than a
/// placeholder.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryConfig {
    pub mode: AuthMode,
    pub profile: Profile,
    /// Non-empty (with `guardian_threshold` in `1..=guardians.len()`) for
    /// `GuardianOnly`/`Combined`; MUST be empty for `ZkOnly`. Flattened from
    /// a [`GuardianSet`] rather than storing `Option<GuardianSet>` directly
    /// — see that type's doc comment for why.
    pub guardians: Vec<Address>,
    pub guardian_threshold: u32,
    /// The `nido-recovery-verifier` (constructorless, VK-baked-in) instance
    /// this account's ZK evidence must verify against. Required for
    /// `ZkOnly`/`Combined`; MUST be absent for `GuardianOnly` (the HARD "no
    /// ZK machinery" requirement — see `AuthMode::GuardianOnly`'s doc).
    pub verifier: Option<Address>,
    /// The `nido-zk-recovery` Merkle pool this account's enrollment secret
    /// was inserted into (`ZkRecoveryClient::insert_for`, called by the
    /// CLIENT at enrollment, not by this contract). Required iff `verifier`
    /// is.
    pub zk_pool: Option<Address>,
    /// Raw network passphrase bytes (this contract sha256's it internally,
    /// mirroring `nido_zk_recovery::hash::compute_auth_hash`'s own
    /// convention) — part of the "network identity" commitment field.
    pub network_passphrase: Bytes,
    /// The approved baseline document's canonical hash.
    /// `Compromise` attempts MUST target `baseline_doc_hash` plus
    /// replacements — never the live document — enforced at `begin_attempt`.
    pub baseline_doc_hash: BytesN<32>,
    pub delay_secs: u64,
    pub expiry_secs: u64,
    pub max_cancels: u32,
    pub version: u32,
    pub pending_activity_policy: PendingActivityPolicy,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttemptState {
    CollectingEvidence,
    AuthorizedPending,
    Completed,
    Cancelled,
}

/// The exact proposal-commitment field list. `network` is
/// `sha256(config.network_passphrase)` (32 bytes) rather than the raw
/// passphrase, matching the circuit's `npass_hi/lo` convention.
/// `baseline_or_source_id` is `config.baseline_doc_hash` for `Compromise`,
/// or the caller-supplied live-doc snapshot hash for `LostKey` ("current"
/// means a defined source snapshot, captured once at `begin_attempt` and
/// never recomputed).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposalCommitment {
    pub network: BytesN<32>,
    pub account: Address,
    pub controller_id: Address,
    pub action: CommitmentAction,
    pub config_version: u32,
    pub baseline_or_source_id: BytesN<32>,
    pub target_doc_hash: BytesN<32>,
    pub attempt_id: u64,
    pub delay_secs: u64,
}

/// A single recovery attempt's full lifecycle record — the reference model
/// is `collecting-evidence -> authorized-pending -> {completed, cancelled}`;
/// "expired" is a DERIVED predicate, not a stored state — see `lib.rs
/// ::is_live`, mirroring `TRANSITION_SPEC.md`'s "readiness may be derived
/// from time rather than stored as another state".
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attempt {
    pub id: u64,
    pub action: RecoveryAction,
    pub commitment: ProposalCommitment,
    pub state: AttemptState,
    /// Credential ids the target document replaces (client-declared — see
    /// the crate doc comment's "Known limits" on why this is a declared
    /// bookkeeping input, not an on-chain-verified doc diff).
    pub replaced_credential_ids: Vec<BytesN<32>>,
    pub guardian_approvals: Vec<Address>,
    pub zk_verified: bool,
    pub zk_nullifier: Option<BytesN<32>>,
    pub created_at: u64,
    pub executable_after: Option<u64>,
    pub expires_at: Option<u64>,
}

/// Per-attempt cancellation-evidence tally. Cancellation is its OWN action
/// domain, bound to the specific attempt it cancels — a distinct commitment
/// from initiation, distinct storage, no shared state with
/// `Attempt::guardian_approvals`/`zk_verified` above.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CancelTally {
    pub guardian_approvals: Vec<Address>,
    pub zk_verified: bool,
}

/// Global (not per-account) ZK nullifier lifecycle — mirrors
/// `nido-zk-recovery`'s `NullifierState`. A nullifier reserved by one
/// account's attempt cannot be reserved by another's.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NullifierState {
    Reserved(Address),
    Spent,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Key {
    Config(Address),
    RevokedCredentials(Address),
    Attempt(Address),
    NextAttemptId(Address),
    /// Cumulative successful cancellations for this account (mirrors
    /// `nido-zk-recovery`'s `Cancels(Address)` — bounds repeated
    /// initiate/cancel griefing across the account's WHOLE history, not
    /// per-attempt).
    CancelsUsed(Address),
    CancelTally(Address, u64),
    Nullifier(BytesN<32>),
    /// The context-rule id this policy was installed under, per account —
    /// same stolen-passkey-repoint hardening as
    /// `nido-recovery-doc-completion::Key::Installed`.
    Installed(Address),
    /// TEMPORARY: value-bound completion marker, written by `enforce` the
    /// instant it consumes an attempt. Not read by this crate's
    /// Variant-A-only completion path (Variant A needs no such bridge — see
    /// `docs/recovery/stage2-findings.md` §3) but kept so a future Variant B
    /// vehicle could reuse it without a storage-key ABI break.
    CompletionGrant(Address),
}

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyEnrolled = 1,
    NotEnrolled = 2,
    /// `enroll`: `GuardianOnly` mode must not set `verifier`/`zk_pool`, or
    /// `ZkOnly`/`Combined` must set them and `ZkOnly` must NOT set
    /// `guardians` — the HARD mode/machinery match.
    ModeConfigMismatch = 3,
    /// `enroll`: `threshold` is 0 or exceeds `guardians.len()`.
    InvalidThreshold = 4,
    /// `enroll`: `pending_activity_policy` is the unimplemented `Restrict`
    /// placeholder (no default; this is not a default, it is a refusal).
    UnresolvedPolicyBranch = 5,

    /// `begin_attempt`: a live (non-terminal, non-expired) attempt already
    /// exists — `docs/recovery/TRANSITION_SPEC.md`'s "no silent supersede".
    AttemptAlreadyActive = 6,
    /// `begin_attempt`: `Compromise` action's `source_or_baseline_hash` did
    /// not equal `config.baseline_doc_hash`.
    BaselineMismatch = 7,
    /// `begin_attempt`: a declared `replaced_credential_id` is already in
    /// `RevokedCredentials` — reviving a credential a prior recovery removed
    /// (property 10).
    RevokedCredentialRevived = 8,

    /// `submit_guardian_approval`/`submit_zk_proof` (and their `_cancel`
    /// counterparts): the account's mode does not include this factor.
    ModeMismatch = 9,
    /// No live attempt with this id in the expected state.
    NoSuchAttempt = 10,
    /// `submit_guardian_approval`: caller is not in the enrolled guardian
    /// set.
    NotAGuardian = 11,
    /// `submit_guardian_approval`: this guardian already approved this
    /// attempt/cancellation.
    DuplicateApproval = 12,
    /// `submit_zk_proof`/cancel: the submitted Merkle root is not a known
    /// historical root of the enrolled pool.
    UnknownRoot = 13,
    /// `submit_zk_proof`/cancel: nullifier already `Spent`, or `Reserved` by
    /// a DIFFERENT account/attempt.
    NullifierUnavailable = 14,
    /// `submit_zk_proof`/cancel: the verifier rejected the proof.
    VerificationFailed = 15,

    /// `cancel_*`: no live attempt to cancel.
    NoPending = 16,
    /// `cancel_*`: `max_cancels` already reached for this account (mirrors
    /// `nido-zk-recovery`'s cancel cap — bounds griefing via repeated
    /// initiate/cancel).
    CancelCapReached = 17,

    /// `Policy::enforce`: wrong `fn_name`/arg-shape, or submitted doc's hash
    /// doesn't match the attempt's committed `target_doc_hash`.
    ContextMismatch = 18,
    RuleMismatch = 19,
    NotInstalled = 20,
    AlreadyInstalled = 21,
    /// `uninstall` always refuses — see `lib.rs`'s doc comment (same
    /// reentrancy argument as `nido-zk-recovery`/`nido-recovery-doc-completion`).
    Unauthorized = 22,
    TimelockNotElapsed = 23,
    RecoveryExpired = 24,

    /// `reconfigure`: blocked while `has_pending(account)` is true — same
    /// guard `enroll` would need if it could be called twice.
    ReconfigurePendingBlocked = 25,
    /// `reconfigure`: the `(existing.mode, new_config.mode)` pair is not one
    /// of the two allowed additive transitions (`GuardianOnly -> Combined`,
    /// `ZkOnly -> Combined`), or the transition doesn't strictly ADD the
    /// missing factor's fields while leaving the existing factor's fields
    /// untouched.
    ReconfigureNotAdditive = 26,
    /// `reconfigure`: a field other than the mode/machinery-being-added
    /// differs from the currently-stored config — reconfigure only ever
    /// adds a missing evidence factor, never touches identity/baseline/
    /// timing.
    ReconfigureFieldMismatch = 27,
    /// `reconfigure` (`Profile::Protected` only): fewer than
    /// `existing.guardian_threshold` DISTINCT, currently-enrolled guardians
    /// nested-authorized this exact reconfigure call.
    ReconfigureEvidenceInsufficient = 28,
    /// `reconfigure` (`Profile::Protected`, existing mode `ZkOnly` only):
    /// refused, not implemented — see the crate doc comment's "Known
    /// limits" for exactly why a ZK reconfigure-evidence path needs a new
    /// circuit binding this crate does not add.
    ReconfigureZkEvidenceUnsupported = 29,
}

#[contractevent(topics = ["recovery_attempt_begun"], data_format = "map")]
pub struct RecoveryAttemptBegun<'a> {
    #[topic]
    pub account: &'a Address,
    pub attempt_id: &'a u64,
    pub target_doc_hash: &'a BytesN<32>,
}

#[contractevent(topics = ["recovery_authorized"], data_format = "map")]
pub struct RecoveryAuthorized<'a> {
    #[topic]
    pub account: &'a Address,
    pub attempt_id: &'a u64,
    pub executable_after: &'a u64,
}

#[contractevent(topics = ["recovery_canceled"], data_format = "map")]
pub struct RecoveryCanceled<'a> {
    #[topic]
    pub account: &'a Address,
    pub attempt_id: &'a u64,
}

#[contractevent(topics = ["recovery_completed"], data_format = "map")]
pub struct RecoveryCompleted<'a> {
    #[topic]
    pub account: &'a Address,
    pub attempt_id: &'a u64,
    pub target_doc_hash: &'a BytesN<32>,
}

#[contractevent(topics = ["recovery_reconfigured"], data_format = "map")]
pub struct RecoveryReconfigured<'a> {
    #[topic]
    pub account: &'a Address,
    pub new_mode: &'a AuthMode,
}
