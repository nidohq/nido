//! The shared recovery controller: ONE deployed instance, shared across
//! accounts, dispatching to a guardian-quorum adapter and/or a ZK-verifier
//! adapter per account's enrolled `AuthMode` — `Combined` checks BOTH
//! against the SAME attempt commitment before promoting it. Completion is
//! Variant A (`docs/recovery/stage2-findings.md`'s recommendation): this
//! contract's `Policy::enforce` gates the account's EXISTING `apply_doc`
//! entry point, zero smart-account code changes, same call-ordering
//! argument `nido-recovery-doc-completion` already proved (see `enforce`'s
//! doc comment below).

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contractimpl, contracttype, panic_with_error,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

use crate::types::{
    Attempt, AttemptState, AuthMode, CancelTally, CommitmentAction, Error, Key, NullifierState,
    PendingActivityPolicy, Profile, ProposalCommitment, RecoveryAction, RecoveryAttemptBegun,
    RecoveryAuthorized, RecoveryCanceled, RecoveryCompleted, RecoveryConfig, RecoveryReconfigured,
};
use crate::zk;

/// Install parameters for this `Policy` — structurally identical to
/// `nido-recovery-doc-completion::DocRecoveryInstallParams` /
/// `nido-zk-recovery::ZkRecoveryInstallParams` (`{ version: u32 }`), so the
/// account's existing constructor/`enroll_zk_recovery` install path decodes
/// into this type unchanged (see that crate's doc comment for why —
/// `#[contracttype]` structs encode structurally, not nominally).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryInstallParams {
    pub version: u32,
}

fn apply_doc_fn(e: &Env) -> Symbol {
    Symbol::new(e, "apply_doc")
}

fn extend_persistent_max(env: &Env, key: &Key) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(key, max, max);
}

fn config_or_panic(e: &Env, account: &Address) -> RecoveryConfig {
    e.storage()
        .persistent()
        .get(&Key::Config(account.clone()))
        .unwrap_or_else(|| panic_with_error!(e, Error::NotEnrolled))
}

fn revoked_credentials(e: &Env, account: &Address) -> Vec<BytesN<32>> {
    e.storage()
        .persistent()
        .get(&Key::RevokedCredentials(account.clone()))
        .unwrap_or_else(|| Vec::new(e))
}

fn next_attempt_id(e: &Env, account: &Address) -> u64 {
    let key = Key::NextAttemptId(account.clone());
    let id: u64 = e.storage().persistent().get(&key).unwrap_or(0) + 1;
    e.storage().persistent().set(&key, &id);
    extend_persistent_max(e, &key);
    id
}

fn cancels_used(e: &Env, account: &Address) -> u32 {
    e.storage()
        .persistent()
        .get(&Key::CancelsUsed(account.clone()))
        .unwrap_or(0)
}

/// "Readiness may be derived from time rather than stored as another
/// state" — expiry for BOTH `CollectingEvidence` (deadline reuses
/// `expiry_secs`, same simplification `TRANSITION_SPEC.md` flags as
/// CONFIGURABLE not AGREED) and `AuthorizedPending` (its own `expires_at`)
/// is a derived predicate, never a stored transition.
fn is_live(attempt: &Attempt, now: u64, expiry_secs: u64) -> bool {
    match attempt.state {
        AttemptState::CollectingEvidence => now < attempt.created_at + expiry_secs,
        AttemptState::AuthorizedPending => attempt.expires_at.is_some_and(|exp| now < exp),
        AttemptState::Completed | AttemptState::Cancelled => false,
    }
}

/// Releases a `Reserved(account)` nullifier — used both when a stale
/// (no-longer-live) attempt is about to be superseded by a new
/// `begin_attempt`, and when a cancellation succeeds. Mirrors
/// `nido-zk-recovery::controller::release_reservation_if_owned` exactly (a
/// `Spent` reservation, or one held by a different account, is left
/// untouched).
fn release_nullifier_if_owned(e: &Env, nullifier: &BytesN<32>, account: &Address) {
    let key = Key::Nullifier(nullifier.clone());
    if let Some(NullifierState::Reserved(owner)) =
        e.storage().persistent().get::<_, NullifierState>(&key)
    {
        if &owner == account {
            e.storage().persistent().remove(&key);
        }
    }
}

fn mode_has_guardians(mode: &crate::types::AuthMode) -> bool {
    !matches!(mode, crate::types::AuthMode::ZkOnly)
}

fn mode_has_zk(mode: &crate::types::AuthMode) -> bool {
    !matches!(mode, crate::types::AuthMode::GuardianOnly)
}

/// The HARD mode/machinery match + sane-threshold +
/// no-unresolved-policy checks — shared by `enroll` (validating a brand
/// new config) and `reconfigure` (validating the resulting config after an
/// additive transition). Panics on any violation; never returns `Result`,
/// matching `enroll`'s original panic-based style.
fn validate_config(e: &Env, config: &RecoveryConfig) {
    match config.mode {
        AuthMode::GuardianOnly => {
            if config.verifier.is_some() || config.zk_pool.is_some() {
                panic_with_error!(e, Error::ModeConfigMismatch);
            }
            if config.guardians.is_empty() {
                panic_with_error!(e, Error::ModeConfigMismatch);
            }
        }
        AuthMode::ZkOnly => {
            if !config.guardians.is_empty() {
                panic_with_error!(e, Error::ModeConfigMismatch);
            }
            if config.verifier.is_none() || config.zk_pool.is_none() {
                panic_with_error!(e, Error::ModeConfigMismatch);
            }
        }
        AuthMode::Combined => {
            if config.guardians.is_empty() || config.verifier.is_none() || config.zk_pool.is_none()
            {
                panic_with_error!(e, Error::ModeConfigMismatch);
            }
        }
    }
    if !config.guardians.is_empty() {
        let n = config.guardians.len();
        if config.guardian_threshold == 0 || config.guardian_threshold > n {
            panic_with_error!(e, Error::InvalidThreshold);
        }
    }
    if matches!(
        config.pending_activity_policy,
        PendingActivityPolicy::Restrict
    ) {
        panic_with_error!(e, Error::UnresolvedPolicyBranch);
    }
}

/// The digest a guardian nested-authorizes to supply `Profile::Protected`
/// reconfigure evidence (`Address::require_auth_for_args`) — binds this
/// EXACT `(account, new_config)` pair, so a guardian's authorization can
/// never be replayed against a different account or a different proposed
/// config. Deliberately NOT the same mechanism `submit_guardian_approval`
/// uses for initiation evidence (a multi-transaction tally accumulated over
/// time via separate `require_auth` calls) — reconfigure is framed as a
/// one-shot config mutation (not an attempt lifecycle), so ALL contributing
/// guardians authorize the SAME transaction via nested sub-invocation auth
/// entries instead, mirroring how `packages/frontend/src/lib/
/// recoveryActions.ts`'s friend-rotation flow already collects multiple
/// parties' signatures into one transaction.
fn reconfigure_digest(e: &Env, account: &Address, new_config: &RecoveryConfig) -> BytesN<32> {
    let xdr = (account.clone(), new_config.clone()).to_xdr(e);
    e.crypto().sha256(&xdr).to_bytes()
}

fn initiation_satisfied(cfg: &RecoveryConfig, attempt: &Attempt) -> bool {
    match cfg.mode {
        crate::types::AuthMode::GuardianOnly => {
            attempt.guardian_approvals.len() >= cfg.guardian_threshold
        }
        crate::types::AuthMode::ZkOnly => attempt.zk_verified,
        crate::types::AuthMode::Combined => {
            attempt.guardian_approvals.len() >= cfg.guardian_threshold && attempt.zk_verified
        }
    }
}

fn cancel_satisfied(cfg: &RecoveryConfig, tally: &CancelTally) -> bool {
    match cfg.mode {
        crate::types::AuthMode::GuardianOnly => {
            tally.guardian_approvals.len() >= cfg.guardian_threshold
        }
        crate::types::AuthMode::ZkOnly => tally.zk_verified,
        crate::types::AuthMode::Combined => {
            tally.guardian_approvals.len() >= cfg.guardian_threshold && tally.zk_verified
        }
    }
}

fn maybe_promote(
    e: &Env,
    cfg: &RecoveryConfig,
    account: &Address,
    attempt: &mut Attempt,
    now: u64,
) {
    if !initiation_satisfied(cfg, attempt) {
        return;
    }
    let executable_after = now + cfg.delay_secs;
    let expires_at = executable_after + cfg.expiry_secs;
    attempt.state = AttemptState::AuthorizedPending;
    attempt.executable_after = Some(executable_after);
    attempt.expires_at = Some(expires_at);

    RecoveryAuthorized {
        account,
        attempt_id: &attempt.id,
        executable_after: &executable_after,
    }
    .publish(e);
}

fn cancellable_attempt_or_panic(
    e: &Env,
    cfg: &RecoveryConfig,
    account: &Address,
    attempt_id: u64,
) -> Attempt {
    let attempt: Attempt = e
        .storage()
        .persistent()
        .get(&Key::Attempt(account.clone()))
        .unwrap_or_else(|| panic_with_error!(e, Error::NoPending));
    let now = e.ledger().timestamp();
    if attempt.id != attempt_id
        || !matches!(
            attempt.state,
            AttemptState::CollectingEvidence | AttemptState::AuthorizedPending
        )
        || !is_live(&attempt, now, cfg.expiry_secs)
    {
        panic_with_error!(e, Error::NoPending);
    }
    if cancels_used(e, account) >= cfg.max_cancels {
        panic_with_error!(e, Error::CancelCapReached);
    }
    attempt
}

/// Returns `true` iff cancellation evidence was satisfied and the attempt
/// was actually cancelled (in which case `tally_key`'s storage entry has
/// ALREADY been removed — the caller must not write `tally` back in that
/// case, or it would resurrect a stale tally for a terminal attempt).
fn maybe_cancel(
    e: &Env,
    cfg: &RecoveryConfig,
    account: &Address,
    mut attempt: Attempt,
    tally_key: &Key,
    tally: &CancelTally,
) -> bool {
    if !cancel_satisfied(cfg, tally) {
        return false;
    }
    attempt.state = AttemptState::Cancelled;
    if let Some(nullifier) = &attempt.zk_nullifier {
        release_nullifier_if_owned(e, nullifier, account);
    }
    let attempt_key = Key::Attempt(account.clone());
    e.storage().persistent().set(&attempt_key, &attempt);
    extend_persistent_max(e, &attempt_key);
    e.storage().persistent().remove(tally_key);

    let used = cancels_used(e, account) + 1;
    let used_key = Key::CancelsUsed(account.clone());
    e.storage().persistent().set(&used_key, &used);
    extend_persistent_max(e, &used_key);

    RecoveryCanceled {
        account,
        attempt_id: &attempt.id,
    }
    .publish(e);
    true
}

#[contract]
pub struct RecoveryController;

#[contractimpl]
impl RecoveryController {
    /// One-shot per account, self-authed. Validates the HARD mode/machinery
    /// match (`GuardianOnly` MUST NOT configure any ZK address; `ZkOnly`
    /// MUST NOT configure guardians; `Combined` needs both), a sane
    /// guardian threshold, and refuses the unimplemented
    /// `PendingActivityPolicy::Restrict` (no default — a refusal, not a
    /// silent substitution).
    ///
    /// `RecoveryConfig` is not fully immutable after enrollment —
    /// `reconfigure` (below) allows one narrow, strictly additive mutation
    /// (see its doc comment and the crate doc comment's "Known limits"). It
    /// never allows changing `baseline_doc_hash`
    /// (`Error::ReconfigureFieldMismatch` refuses any such attempt), which
    /// is what makes the property "a stolen admin key must not be able to
    /// refresh the baseline" hold: there is no path, legitimate or
    /// otherwise, that can change the baseline once enrolled.
    #[allow(clippy::needless_pass_by_value)]
    pub fn enroll(e: Env, account: Address, config: RecoveryConfig) {
        account.require_auth();

        let key = Key::Config(account.clone());
        if e.storage().persistent().has(&key) {
            panic_with_error!(&e, Error::AlreadyEnrolled);
        }

        validate_config(&e, &config);

        e.storage().persistent().set(&key, &config);
        extend_persistent_max(&e, &key);
    }

    /// Changes an ALREADY-enrolled account's config — the ONE allowed
    /// mutation, replacing the "no reconfigure entry point" limit this
    /// crate previously carried (see the crate doc comment's "Known
    /// limits" for the full design rationale and its remaining bound: no
    /// ZK reconfigure-evidence path).
    ///
    /// Only two transitions are accepted, and ONLY as strict additions:
    /// `GuardianOnly -> Combined` (adds `verifier`/`zk_pool`, `guardians`/
    /// `guardian_threshold` untouched) or `ZkOnly -> Combined` (adds
    /// `guardians`/`guardian_threshold`, `verifier`/`zk_pool` untouched).
    /// Every other field of `RecoveryConfig` must byte-for-byte equal the
    /// stored config, or this panics `ReconfigureFieldMismatch` —
    /// reconfigure only ever adds a missing evidence factor, never touches
    /// identity/baseline/timing. This is the "configuration consistency"
    /// property: a live attempt's frozen commitment can never be silently
    /// reinterpreted by a later config change, because nothing the
    /// commitment binds to is ever allowed to change here.
    ///
    /// Blocked while `has_pending(account)` is true, same as every other
    /// mutator. Authorization depends on `Profile`:
    /// `Profile::Loss` needs only `account.require_auth()` (ordinary
    /// admin); `Profile::Protected` additionally needs the CURRENTLY-
    /// enrolled factor's evidence — for an existing `GuardianOnly` config,
    /// `guardian_evidence` must list `>= guardian_threshold` DISTINCT
    /// enrolled guardians, each of whom nested-authorizes THIS EXACT
    /// `(account, new_config)` pair in the SAME transaction
    /// (`reconfigure_digest` + `Address::require_auth_for_args` — NOT the
    /// multi-transaction tally `submit_guardian_approval` uses, since this
    /// is a one-shot mutation, not an attempt). For an existing `ZkOnly`
    /// config this panics `ReconfigureZkEvidenceUnsupported` — see the
    /// crate doc comment.
    #[allow(clippy::needless_pass_by_value)]
    pub fn reconfigure(
        e: Env,
        account: Address,
        new_config: RecoveryConfig,
        guardian_evidence: Vec<Address>,
    ) {
        account.require_auth();

        let existing = config_or_panic(&e, &account);

        if Self::has_pending(e.clone(), account.clone()) {
            panic_with_error!(&e, Error::ReconfigurePendingBlocked);
        }

        match (&existing.mode, &new_config.mode) {
            (AuthMode::GuardianOnly, AuthMode::Combined) => {
                if new_config.guardians != existing.guardians
                    || new_config.guardian_threshold != existing.guardian_threshold
                    || existing.verifier.is_some()
                    || existing.zk_pool.is_some()
                    || new_config.verifier.is_none()
                    || new_config.zk_pool.is_none()
                {
                    panic_with_error!(&e, Error::ReconfigureNotAdditive);
                }
            }
            (AuthMode::ZkOnly, AuthMode::Combined) => {
                if new_config.verifier != existing.verifier
                    || new_config.zk_pool != existing.zk_pool
                    || !existing.guardians.is_empty()
                    || new_config.guardians.is_empty()
                {
                    panic_with_error!(&e, Error::ReconfigureNotAdditive);
                }
            }
            _ => panic_with_error!(&e, Error::ReconfigureNotAdditive),
        }

        if new_config.profile != existing.profile
            || new_config.network_passphrase != existing.network_passphrase
            || new_config.baseline_doc_hash != existing.baseline_doc_hash
            || new_config.delay_secs != existing.delay_secs
            || new_config.expiry_secs != existing.expiry_secs
            || new_config.max_cancels != existing.max_cancels
            || new_config.pending_activity_policy != existing.pending_activity_policy
            || new_config.version != existing.version
        {
            panic_with_error!(&e, Error::ReconfigureFieldMismatch);
        }

        // Belt and suspenders: never trust a caller-supplied config blindly,
        // even though the additive-transition check above should already
        // guarantee this holds.
        validate_config(&e, &new_config);

        if matches!(existing.profile, Profile::Protected) {
            match existing.mode {
                AuthMode::GuardianOnly => {
                    let digest = reconfigure_digest(&e, &account, &new_config);
                    let mut seen: Vec<Address> = Vec::new(&e);
                    for g in guardian_evidence.iter() {
                        if !existing.guardians.iter().any(|eg| eg == g) {
                            panic_with_error!(&e, Error::NotAGuardian);
                        }
                        if seen.iter().any(|s| s == g) {
                            panic_with_error!(&e, Error::DuplicateApproval);
                        }
                        g.require_auth_for_args(soroban_sdk::vec![&e, digest.clone().into()]);
                        seen.push_back(g);
                    }
                    if seen.len() < existing.guardian_threshold {
                        panic_with_error!(&e, Error::ReconfigureEvidenceInsufficient);
                    }
                }
                AuthMode::ZkOnly => {
                    panic_with_error!(&e, Error::ReconfigureZkEvidenceUnsupported);
                }
                AuthMode::Combined => unreachable!("existing config can never already be Combined here — validate_config/enroll never store Combined without both factors, and the transition match above only accepts GuardianOnly/ZkOnly as the FROM state"),
            }
        }

        e.storage()
            .persistent()
            .set(&Key::Config(account.clone()), &new_config);
        extend_persistent_max(&e, &Key::Config(account.clone()));

        RecoveryReconfigured {
            account: &account,
            new_mode: &new_config.mode,
        }
        .publish(&e);
    }

    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn config(e: Env, account: Address) -> Option<RecoveryConfig> {
        e.storage().persistent().get(&Key::Config(account))
    }

    /// A reviewable, on-chain-computable commitment to `account`'s enrolled
    /// `RecoveryConfig` — `sha256(xdr(config))`, Soroban's own `ToXdr`
    /// serialization (deterministic for a given value: same `RecoveryConfig`
    /// always encodes to the same bytes). This satisfies the property that
    /// the document commitment must cover all authority-bearing recovery
    /// configuration, WITHOUT embedding recovery configuration in the
    /// account's own Perch policy document — see the crate doc comment's
    /// "Known limits" for exactly why that embedding is blocked by the
    /// DEPLOYED, pinned `perch-doc-compiler`'s wire protocol (an external
    /// dependency this contract does not control), not by a gap in this
    /// contract. `None` if `account` is not enrolled.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn config_hash(e: Env, account: Address) -> Option<BytesN<32>> {
        let cfg: RecoveryConfig = e.storage().persistent().get(&Key::Config(account))?;
        let xdr = cfg.to_xdr(&e);
        Some(e.crypto().sha256(&xdr).to_bytes())
    }

    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn revoked(e: Env, account: Address) -> Vec<BytesN<32>> {
        revoked_credentials(&e, &account)
    }

    /// Opens a new recovery attempt (`TRANSITION_SPEC.md`'s `beginAttempt`).
    /// PERMISSIONLESS — no `require_auth` at all: declaring intent carries
    /// no authority by itself, real gating happens at evidence-driven
    /// promotion (`submit_guardian_approval`/`submit_zk_proof`). Refuses
    /// (`AttemptAlreadyActive`) if a LIVE attempt already exists ("no silent
    /// supersede") — but if the existing attempt is stale (expired,
    /// `CollectingEvidence` past its deadline, or terminal), it is replaced,
    /// releasing any nullifier reservation it held first (mirrors
    /// `nido-zk-recovery::initiate_recovery`'s stale-pending-supersede
    /// step).
    ///
    /// `action == Compromise` MUST target `config.baseline_doc_hash`
    /// (`BaselineMismatch` otherwise): compromise recovery restores the
    /// approved BASELINE plus replacements, never the live (possibly
    /// attacker-modified) document. `action == LostKey` accepts any
    /// `source_or_baseline_hash` — the CALLER captures the live document's
    /// current hash as the fixed source snapshot at this exact moment
    /// ("current" means a defined source snapshot; a `LostKey` attempt must
    /// not silently overwrite policy changes that occur after); this contract
    /// does not itself fetch the live doc hash (it has no doc-pipeline
    /// access), so the client is trusted to pass the ACTUAL current hash —
    /// evidence providers reviewing the target-document preview (client/SDK
    /// responsibility, not this contract's) are what catches a
    /// lying/stale claim here, exactly as they catch any other
    /// target-document mismatch.
    ///
    /// `replaced_credential_ids` is a client-DECLARED bookkeeping input, not
    /// an on-chain-verified document diff — see the crate doc comment's
    /// "Known limits".
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn begin_attempt(
        e: Env,
        account: Address,
        action: RecoveryAction,
        target_doc_hash: BytesN<32>,
        source_or_baseline_hash: BytesN<32>,
        replaced_credential_ids: Vec<BytesN<32>>,
    ) -> u64 {
        let cfg = config_or_panic(&e, &account);

        if matches!(action, RecoveryAction::Compromise)
            && source_or_baseline_hash != cfg.baseline_doc_hash
        {
            panic_with_error!(&e, Error::BaselineMismatch);
        }

        let now = e.ledger().timestamp();
        let attempt_key = Key::Attempt(account.clone());
        if let Some(existing) = e.storage().persistent().get::<_, Attempt>(&attempt_key) {
            if is_live(&existing, now, cfg.expiry_secs) {
                panic_with_error!(&e, Error::AttemptAlreadyActive);
            }
            if let Some(nullifier) = &existing.zk_nullifier {
                release_nullifier_if_owned(&e, nullifier, &account);
            }
        }

        let revoked = revoked_credentials(&e, &account);
        for id in replaced_credential_ids.iter() {
            if revoked.iter().any(|r| r == id) {
                panic_with_error!(&e, Error::RevokedCredentialRevived);
            }
        }

        let attempt_id = next_attempt_id(&e, &account);
        let network = e.crypto().sha256(&cfg.network_passphrase).to_bytes();
        let commitment_action = match action {
            RecoveryAction::LostKey => CommitmentAction::LostKey,
            RecoveryAction::Compromise => CommitmentAction::Compromise,
        };
        let commitment = ProposalCommitment {
            network,
            account: account.clone(),
            controller_id: e.current_contract_address(),
            action: commitment_action,
            config_version: cfg.version,
            baseline_or_source_id: source_or_baseline_hash,
            target_doc_hash: target_doc_hash.clone(),
            attempt_id,
            delay_secs: cfg.delay_secs,
        };
        let attempt = Attempt {
            id: attempt_id,
            action,
            commitment,
            state: AttemptState::CollectingEvidence,
            replaced_credential_ids,
            guardian_approvals: Vec::new(&e),
            zk_verified: false,
            zk_nullifier: None,
            created_at: now,
            executable_after: None,
            expires_at: None,
        };
        e.storage().persistent().set(&attempt_key, &attempt);
        extend_persistent_max(&e, &attempt_key);

        RecoveryAttemptBegun {
            account: &account,
            attempt_id: &attempt_id,
            target_doc_hash: &target_doc_hash,
        }
        .publish(&e);

        attempt_id
    }

    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn get_attempt(e: Env, account: Address) -> Option<Attempt> {
        e.storage().persistent().get(&Key::Attempt(account))
    }

    /// `guardian` must `require_auth` (real Soroban authorization — the
    /// guardian's own signature) and be a member of the enrolled
    /// `GuardianSet`. A `GuardianOnly`/`Combined` account only — `ZkOnly`
    /// rejects with `ModeMismatch`, since it enrolled with no guardian set
    /// at all (the HARD "no ZK machinery for `GuardianOnly`" requirement is
    /// symmetric: `ZkOnly` correspondingly has no guardian machinery to
    /// accept an approval into).
    #[allow(clippy::needless_pass_by_value)]
    pub fn submit_guardian_approval(e: Env, account: Address, attempt_id: u64, guardian: Address) {
        guardian.require_auth();
        let cfg = config_or_panic(&e, &account);
        if !mode_has_guardians(&cfg.mode) {
            panic_with_error!(&e, Error::ModeMismatch);
        }
        if !cfg.guardians.iter().any(|g| g == guardian) {
            panic_with_error!(&e, Error::NotAGuardian);
        }

        let attempt_key = Key::Attempt(account.clone());
        let mut attempt: Attempt = e
            .storage()
            .persistent()
            .get(&attempt_key)
            .unwrap_or_else(|| panic_with_error!(&e, Error::NoSuchAttempt));
        let now = e.ledger().timestamp();
        if attempt.id != attempt_id
            || !matches!(attempt.state, AttemptState::CollectingEvidence)
            || !is_live(&attempt, now, cfg.expiry_secs)
        {
            panic_with_error!(&e, Error::NoSuchAttempt);
        }
        if attempt.guardian_approvals.iter().any(|g| g == guardian) {
            panic_with_error!(&e, Error::DuplicateApproval);
        }
        attempt.guardian_approvals.push_back(guardian);

        maybe_promote(&e, &cfg, &account, &mut attempt, now);
        e.storage().persistent().set(&attempt_key, &attempt);
        extend_persistent_max(&e, &attempt_key);
    }

    /// PERMISSIONLESS caller — the proof itself is the authorization (mirrors
    /// `nido-zk-recovery::initiate_recovery`: no `require_auth`, the entire
    /// security property is "the proof verifies against an `auth_hash` this
    /// contract recomputes from its own known state", so nothing is gained
    /// by ALSO requiring a signature from whoever happens to relay the
    /// proof on-chain). Recomputes `auth_hash` from `attempt.commitment`'s
    /// OWN fields (never trusts a caller-supplied hash) via `zk::verify`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn submit_zk_proof(
        e: Env,
        account: Address,
        attempt_id: u64,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Bytes,
    ) {
        let cfg = config_or_panic(&e, &account);
        if !mode_has_zk(&cfg.mode) {
            panic_with_error!(&e, Error::ModeMismatch);
        }
        let verifier = cfg
            .verifier
            .clone()
            .unwrap_or_else(|| panic_with_error!(&e, Error::ModeConfigMismatch));
        let pool = cfg
            .zk_pool
            .clone()
            .unwrap_or_else(|| panic_with_error!(&e, Error::ModeConfigMismatch));

        let attempt_key = Key::Attempt(account.clone());
        let mut attempt: Attempt = e
            .storage()
            .persistent()
            .get(&attempt_key)
            .unwrap_or_else(|| panic_with_error!(&e, Error::NoSuchAttempt));
        let now = e.ledger().timestamp();
        if attempt.id != attempt_id
            || !matches!(attempt.state, AttemptState::CollectingEvidence)
            || !is_live(&attempt, now, cfg.expiry_secs)
        {
            panic_with_error!(&e, Error::NoSuchAttempt);
        }

        if attempt.zk_verified {
            // Idempotent no-op re-submission.
            return;
        }

        let nullifier_key = Key::Nullifier(nullifier.clone());
        if let Some(state) = e
            .storage()
            .persistent()
            .get::<_, NullifierState>(&nullifier_key)
        {
            match state {
                NullifierState::Reserved(owner) if owner == account => {}
                NullifierState::Reserved(_) | NullifierState::Spent => {
                    panic_with_error!(&e, Error::NullifierUnavailable)
                }
            }
        }

        let c = &attempt.commitment;
        zk::verify(
            &e,
            &pool,
            &verifier,
            &c.action,
            &account,
            &cfg.network_passphrase,
            &c.controller_id,
            &c.target_doc_hash,
            c.config_version,
            &c.baseline_or_source_id,
            c.attempt_id,
            c.delay_secs,
            &root,
            &nullifier,
            &proof,
        )
        .unwrap_or_else(|err| match err {
            zk::ZkVerifyError::UnknownRoot => panic_with_error!(&e, Error::UnknownRoot),
            zk::ZkVerifyError::Verifier(_)
            | zk::ZkVerifyError::VerifierUnreachable
            | zk::ZkVerifyError::Aborted
            | zk::ZkVerifyError::UnknownError => {
                panic_with_error!(&e, Error::VerificationFailed)
            }
        });

        e.storage()
            .persistent()
            .set(&nullifier_key, &NullifierState::Reserved(account.clone()));
        extend_persistent_max(&e, &nullifier_key);

        attempt.zk_verified = true;
        attempt.zk_nullifier = Some(nullifier);

        maybe_promote(&e, &cfg, &account, &mut attempt, now);
        e.storage().persistent().set(&attempt_key, &attempt);
        extend_persistent_max(&e, &attempt_key);
    }

    /// Guardian cancellation evidence (own action domain). Distinct storage
    /// (`CancelTally`) from initiation's
    /// `Attempt::guardian_approvals`: a guardian who approved INITIATION has
    /// approved nothing about CANCELLATION, and vice versa.
    #[allow(clippy::needless_pass_by_value)]
    pub fn submit_guardian_cancel(e: Env, account: Address, attempt_id: u64, guardian: Address) {
        guardian.require_auth();
        let cfg = config_or_panic(&e, &account);
        if !mode_has_guardians(&cfg.mode) {
            panic_with_error!(&e, Error::ModeMismatch);
        }
        if !cfg.guardians.iter().any(|g| g == guardian) {
            panic_with_error!(&e, Error::NotAGuardian);
        }

        let attempt = cancellable_attempt_or_panic(&e, &cfg, &account, attempt_id);

        let tally_key = Key::CancelTally(account.clone(), attempt_id);
        let mut tally: CancelTally =
            e.storage()
                .persistent()
                .get(&tally_key)
                .unwrap_or(CancelTally {
                    guardian_approvals: Vec::new(&e),
                    zk_verified: false,
                });
        if tally.guardian_approvals.iter().any(|g| g == guardian) {
            panic_with_error!(&e, Error::DuplicateApproval);
        }
        tally.guardian_approvals.push_back(guardian);

        if !maybe_cancel(&e, &cfg, &account, attempt, &tally_key, &tally) {
            e.storage().persistent().set(&tally_key, &tally);
            extend_persistent_max(&e, &tally_key);
        }
    }

    /// ZK cancellation evidence — PERMISSIONLESS caller (same reasoning as
    /// `submit_zk_proof`). The proof's `auth_hash` binds `action = Cancel`
    /// (via `zk::action_code`), so a cancellation proof can NEVER be reused
    /// as initiation evidence or vice versa — cryptographic domain
    /// separation, not just a storage-layout separation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn submit_zk_cancel(
        e: Env,
        account: Address,
        attempt_id: u64,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Bytes,
    ) {
        let cfg = config_or_panic(&e, &account);
        if !mode_has_zk(&cfg.mode) {
            panic_with_error!(&e, Error::ModeMismatch);
        }
        let verifier = cfg
            .verifier
            .clone()
            .unwrap_or_else(|| panic_with_error!(&e, Error::ModeConfigMismatch));
        let pool = cfg
            .zk_pool
            .clone()
            .unwrap_or_else(|| panic_with_error!(&e, Error::ModeConfigMismatch));

        let attempt = cancellable_attempt_or_panic(&e, &cfg, &account, attempt_id);

        let cancel_commitment = ProposalCommitment {
            action: CommitmentAction::Cancel,
            ..attempt.commitment.clone()
        };

        zk::verify(
            &e,
            &pool,
            &verifier,
            &cancel_commitment.action,
            &account,
            &cfg.network_passphrase,
            &cancel_commitment.controller_id,
            &cancel_commitment.target_doc_hash,
            cancel_commitment.config_version,
            &cancel_commitment.baseline_or_source_id,
            cancel_commitment.attempt_id,
            cancel_commitment.delay_secs,
            &root,
            &nullifier,
            &proof,
        )
        .unwrap_or_else(|err| match err {
            zk::ZkVerifyError::UnknownRoot => panic_with_error!(&e, Error::UnknownRoot),
            zk::ZkVerifyError::Verifier(_)
            | zk::ZkVerifyError::VerifierUnreachable
            | zk::ZkVerifyError::Aborted
            | zk::ZkVerifyError::UnknownError => {
                panic_with_error!(&e, Error::VerificationFailed)
            }
        });

        let tally_key = Key::CancelTally(account.clone(), attempt_id);
        let mut tally: CancelTally =
            e.storage()
                .persistent()
                .get(&tally_key)
                .unwrap_or(CancelTally {
                    guardian_approvals: Vec::new(&e),
                    zk_verified: false,
                });
        tally.zk_verified = true;

        if !maybe_cancel(&e, &cfg, &account, attempt, &tally_key, &tally) {
            e.storage().persistent().set(&tally_key, &tally);
            extend_persistent_max(&e, &tally_key);
        }
    }

    /// View cross-called by the smart account's `guard_no_pending`
    /// (`contracts/smart-account/src/contract.rs`), exactly like
    /// `nido-recovery-doc-completion`'s `has_pending`. Governed by
    /// `config.pending_activity_policy` — see
    /// `PendingActivityPolicy`'s doc for what `Freeze`/`Continue` each mean.
    /// An account with NO enrollment (never called `enroll`) trivially has
    /// no pending — this must not panic for an unenrolled account, since the
    /// smart account cross-calls it unconditionally whenever ANY controller
    /// is installed as `recovery_controller`.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn has_pending(e: Env, account: Address) -> bool {
        let Some(cfg) = e
            .storage()
            .persistent()
            .get::<_, RecoveryConfig>(&Key::Config(account.clone()))
        else {
            return false;
        };
        if matches!(cfg.pending_activity_policy, PendingActivityPolicy::Continue) {
            return false;
        }
        let now = e.ledger().timestamp();
        e.storage()
            .persistent()
            .get::<_, Attempt>(&Key::Attempt(account))
            .is_some_and(|a| is_live(&a, now, cfg.expiry_secs))
    }

    /// Parity view (mirrors `nido-recovery-doc-completion`'s /
    /// `nido-zk-recovery`'s identically-named view): always `false`. This
    /// controller only wires Variant A (gating the account's EXISTING
    /// `apply_doc`), never the account's raw `add_context_rule` completion
    /// vehicle — the smart account's guard cross-calls this unconditionally
    /// whenever this controller is installed, so it must exist.
    #[must_use]
    #[allow(clippy::needless_pass_by_value, clippy::used_underscore_binding)]
    pub fn completion_granted(_e: Env, _account: Address) -> bool {
        false
    }
}

#[contractimpl]
impl Policy for RecoveryController {
    type AccountParams = RecoveryInstallParams;

    /// Identical shape to `nido-recovery-doc-completion::Policy::install` —
    /// same stolen-passkey-repoint hardening (`AlreadyInstalled` guard, see
    /// that crate's doc comment for the full reentrancy argument): zero-signer,
    /// `CallContract(smart_account)`-scoped rule only, one-shot per account.
    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();

        let key = Key::Installed(smart_account.clone());
        if e.storage().persistent().get::<_, u32>(&key).is_some() {
            panic_with_error!(e, Error::AlreadyInstalled);
        }
        if !context_rule.signers.is_empty() {
            panic_with_error!(e, Error::ContextMismatch);
        }
        match &context_rule.context_type {
            ContextRuleType::CallContract(addr) if *addr == smart_account => {}
            _ => panic_with_error!(e, Error::ContextMismatch),
        }

        e.storage().persistent().set(&key, &context_rule.id);
        extend_persistent_max(e, &key);
        let _ = install_params;
    }

    /// The completion gate — Variant A only (`docs/recovery/stage2-findings.md`'s
    /// recommendation). Ordered checks mirror
    /// `nido-recovery-doc-completion::Policy::enforce` exactly (that
    /// document's §3 call-ordering analysis applies verbatim: `enforce` runs
    /// during the completing call's OWN `__check_auth`, BEFORE its body, so
    /// consuming the attempt HERE is what makes `has_pending` read `false`
    /// for that same call's body-time guard check, with no separate
    /// completion-grant bridge needed):
    /// 1. `context_rule.id` matches the id this policy was installed under.
    /// 2. A live attempt exists, is `AuthorizedPending`, its timelock has
    ///    elapsed, and it is not expired.
    /// 3. `context` is a self-call to `apply_doc` with exactly one `Bytes`
    ///    argument whose sha256 equals `attempt.commitment.target_doc_hash`.
    /// 4. Consume: mark `Completed`, append `replaced_credential_ids` to
    ///    `RevokedCredentials` (property 10 bookkeeping), spend the ZK
    ///    nullifier if one was reserved, emit.
    fn enforce(
        e: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        let _ = &authenticated_signers;
        smart_account.require_auth();

        let installed_id: u32 = e
            .storage()
            .persistent()
            .get(&Key::Installed(smart_account.clone()))
            .unwrap_or_else(|| panic_with_error!(e, Error::NotInstalled));
        if installed_id != context_rule.id {
            panic_with_error!(e, Error::RuleMismatch);
        }

        let attempt_key = Key::Attempt(smart_account.clone());
        let mut attempt: Attempt = e
            .storage()
            .persistent()
            .get(&attempt_key)
            .unwrap_or_else(|| panic_with_error!(e, Error::NoPending));
        if !matches!(attempt.state, AttemptState::AuthorizedPending) {
            panic_with_error!(e, Error::NoPending);
        }
        let now = e.ledger().timestamp();
        let executable_after = attempt.executable_after.unwrap_or(u64::MAX);
        let expires_at = attempt.expires_at.unwrap_or(0);
        if now < executable_after {
            panic_with_error!(e, Error::TimelockNotElapsed);
        }
        if now >= expires_at {
            panic_with_error!(e, Error::RecoveryExpired);
        }

        let cc: ContractContext = match context {
            Context::Contract(cc) if cc.contract == smart_account => cc,
            _ => panic_with_error!(e, Error::ContextMismatch),
        };
        if cc.fn_name != apply_doc_fn(e) {
            panic_with_error!(e, Error::ContextMismatch);
        }
        if cc.args.len() != 1 {
            panic_with_error!(e, Error::ContextMismatch);
        }
        let doc_val: Val = cc
            .args
            .get(0)
            .unwrap_or_else(|| panic_with_error!(e, Error::ContextMismatch));
        let doc_json: Bytes = Bytes::try_from_val(e, &doc_val)
            .unwrap_or_else(|_| panic_with_error!(e, Error::ContextMismatch));
        let submitted_hash = e.crypto().sha256(&doc_json).to_bytes();
        if submitted_hash != attempt.commitment.target_doc_hash {
            panic_with_error!(e, Error::ContextMismatch);
        }

        attempt.state = AttemptState::Completed;
        e.storage().persistent().set(&attempt_key, &attempt);

        if !attempt.replaced_credential_ids.is_empty() {
            let revoked_key = Key::RevokedCredentials(smart_account.clone());
            let mut revoked = revoked_credentials(e, &smart_account);
            for id in attempt.replaced_credential_ids.iter() {
                revoked.push_back(id);
            }
            e.storage().persistent().set(&revoked_key, &revoked);
            extend_persistent_max(e, &revoked_key);
        }

        if let Some(nullifier) = &attempt.zk_nullifier {
            let nullifier_key = Key::Nullifier(nullifier.clone());
            e.storage()
                .persistent()
                .set(&nullifier_key, &NullifierState::Spent);
            extend_persistent_max(e, &nullifier_key);
        }

        e.storage().temporary().set(
            &Key::CompletionGrant(smart_account.clone()),
            &submitted_hash,
        );

        RecoveryCompleted {
            account: &smart_account,
            attempt_id: &attempt.id,
            target_doc_hash: &submitted_hash,
        }
        .publish(e);
    }

    /// UNCONDITIONALLY REFUSES — identical reentrancy-safety argument as
    /// `nido-zk-recovery`/`nido-recovery-doc-completion::Policy::uninstall`
    /// (see either's doc comment): from inside the account's own
    /// `remove_context_rule`/`remove_policy`, no cross-call back into the
    /// account can distinguish a legitimate teardown from a thief's forged
    /// direct call, so both are refused; the legitimate path still succeeds
    /// via OZ's `try_uninstall` panic-swallowing.
    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        let _ = context_rule;
        smart_account.require_auth();
        panic_with_error!(e, Error::Unauthorized);
    }
}

#[cfg(test)]
mod tests {
    //! Unit coverage for the controller in isolation (no smart account, no
    //! ZK verifier/pool involved — those need real cross-contract wiring,
    //! covered by `crates/integration-tests/tests/it/recovery_stage3_*.rs`).
    use super::*;
    use crate::types::{AuthMode, GuardianSet, PendingActivityPolicy, RecoveryConfig};
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::Env;

    fn deploy(env: &Env) -> Address {
        env.register(RecoveryController, ())
    }

    fn base_config(env: &Env, mode: AuthMode, guardians: GuardianSet) -> RecoveryConfig {
        RecoveryConfig {
            mode,
            profile: crate::types::Profile::Loss,
            guardians: guardians.guardians,
            guardian_threshold: guardians.threshold,
            verifier: None,
            zk_pool: None,
            network_passphrase: Bytes::from_slice(env, b"Test SDF Network ; September 2015"),
            baseline_doc_hash: BytesN::from_array(env, &[0x42; 32]),
            delay_secs: 1000,
            expiry_secs: 1000,
            max_cancels: 3,
            version: 1,
            pending_activity_policy: PendingActivityPolicy::Freeze,
        }
    }

    fn guardian_only_config(env: &Env, guardians: Vec<Address>, threshold: u32) -> RecoveryConfig {
        base_config(
            env,
            AuthMode::GuardianOnly,
            GuardianSet {
                guardians,
                threshold,
            },
        )
    }

    fn zk_only_config(env: &Env, verifier: Address, zk_pool: Address) -> RecoveryConfig {
        let mut cfg = base_config(
            env,
            AuthMode::ZkOnly,
            GuardianSet {
                guardians: Vec::new(env),
                threshold: 0,
            },
        );
        cfg.verifier = Some(verifier);
        cfg.zk_pool = Some(zk_pool);
        cfg
    }

    fn hash_of(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    #[test]
    fn guardian_only_enrollment_rejects_any_zk_machinery() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let mut cfg = guardian_only_config(&env, guardians, 1);
        cfg.verifier = Some(Address::generate(&env));

        assert!(
            client.try_enroll(&account, &cfg).is_err(),
            "GuardianOnly must refuse a configured verifier -- HARD requirement"
        );
    }

    #[test]
    fn zk_only_enrollment_rejects_guardians() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let mut cfg = base_config(
            &env,
            AuthMode::ZkOnly,
            GuardianSet {
                guardians,
                threshold: 1,
            },
        );
        cfg.verifier = Some(Address::generate(&env));
        cfg.zk_pool = Some(Address::generate(&env));

        assert!(client.try_enroll(&account, &cfg).is_err());
    }

    #[test]
    fn enroll_rejects_unresolved_policy_branch() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let mut cfg = guardian_only_config(&env, guardians, 1);
        cfg.pending_activity_policy = PendingActivityPolicy::Restrict;

        assert!(
            client.try_enroll(&account, &cfg).is_err(),
            "Restrict must be refused, not silently accepted as a default"
        );
    }

    #[test]
    fn enroll_rejects_threshold_above_guardian_count() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let cfg = guardian_only_config(&env, guardians, 2);

        assert!(client.try_enroll(&account, &cfg).is_err());
    }

    #[test]
    fn guardian_only_lifecycle_promotes_on_quorum_and_requires_no_zk() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        let cfg = guardian_only_config(&env, guardians, 2);
        client.enroll(&account, &cfg);

        let attempt_id = client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );

        client.submit_guardian_approval(&account, &attempt_id, &g1);
        let attempt = client.get_attempt(&account).unwrap();
        assert!(
            matches!(attempt.state, AttemptState::CollectingEvidence),
            "one of two guardians is not quorum"
        );

        client.submit_guardian_approval(&account, &attempt_id, &g2);
        let attempt = client.get_attempt(&account).unwrap();
        assert!(matches!(attempt.state, AttemptState::AuthorizedPending));
        assert!(
            client.has_pending(&account),
            "Freeze policy must block ordinary writes while authorized-pending"
        );
    }

    #[test]
    fn duplicate_guardian_approval_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);
        // Use a threshold of 1 but a second (uninvolved) guardian scenario:
        // re-enroll isn't possible, so assert the SAME guardian can't double-count
        // by re-registering a fresh account with threshold 2 and one real guardian
        // twice-submitted.
        let account2 = Address::generate(&env);
        let mut guardians2 = Vec::new(&env);
        guardians2.push_back(g1.clone());
        let cfg2 = guardian_only_config(&env, guardians2, 1);
        client.enroll(&account2, &cfg2);
        let attempt_id = client.begin_attempt(
            &account2,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );
        client.submit_guardian_approval(&account2, &attempt_id, &g1);
        assert!(client
            .try_submit_guardian_approval(&account2, &attempt_id, &g1)
            .is_err());
    }

    #[test]
    fn no_silent_supersede_of_a_live_attempt() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );
        assert!(client
            .try_begin_attempt(
                &account,
                &RecoveryAction::LostKey,
                &hash_of(&env, 3),
                &hash_of(&env, 2),
                &Vec::new(&env)
            )
            .is_err());
    }

    #[test]
    fn compromise_action_must_target_the_enrolled_baseline() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        // Wrong "baseline" (not the enrolled one) must be refused.
        assert!(client
            .try_begin_attempt(
                &account,
                &RecoveryAction::Compromise,
                &hash_of(&env, 1),
                &hash_of(&env, 0xAA),
                &Vec::new(&env)
            )
            .is_err());

        // The enrolled baseline hash succeeds.
        client.begin_attempt(
            &account,
            &RecoveryAction::Compromise,
            &hash_of(&env, 1),
            &cfg.baseline_doc_hash,
            &Vec::new(&env),
        );
    }

    #[test]
    fn cancellation_evidence_is_a_separate_domain_from_initiation() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        let cfg = guardian_only_config(&env, guardians, 2);
        client.enroll(&account, &cfg);
        let attempt_id = client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );

        // g1's INITIATION approval does not count toward CANCELLATION quorum.
        client.submit_guardian_approval(&account, &attempt_id, &g1);
        client.submit_guardian_cancel(&account, &attempt_id, &g1);
        let attempt = client.get_attempt(&account).unwrap();
        assert!(
            matches!(attempt.state, AttemptState::CollectingEvidence),
            "one initiation + one (separate-domain) cancel approval must not equal 2-of-2 cancel quorum"
        );

        client.submit_guardian_cancel(&account, &attempt_id, &g2);
        let attempt = client.get_attempt(&account).unwrap();
        assert!(matches!(attempt.state, AttemptState::Cancelled));
    }

    #[test]
    fn admin_alone_never_cancels() {
        // No entry point accepts bare account/admin authorization for
        // cancellation -- `submit_guardian_cancel` requires a GUARDIAN's
        // auth, not the account's. This test documents that by construction
        // there is no "admin cancel" function to call at all; the closest
        // approximation is confirming the account itself is not a valid
        // guardian unless explicitly enrolled as one.
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);
        let attempt_id = client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );

        assert!(
            client
                .try_submit_guardian_cancel(&account, &attempt_id, &account)
                .is_err(),
            "the account itself is not an enrolled guardian and must be refused"
        );
    }

    #[test]
    fn revoked_credential_cannot_be_reintroduced() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        // Simulate a prior completion having revoked credential `9`.
        env.as_contract(&id, || {
            let mut revoked = Vec::new(&env);
            revoked.push_back(hash_of(&env, 9));
            env.storage()
                .persistent()
                .set(&Key::RevokedCredentials(account.clone()), &revoked);
        });

        let mut replaced = Vec::new(&env);
        replaced.push_back(hash_of(&env, 9));
        assert!(client
            .try_begin_attempt(
                &account,
                &RecoveryAction::LostKey,
                &hash_of(&env, 1),
                &hash_of(&env, 2),
                &replaced
            )
            .is_err());
    }

    #[test]
    fn expired_collecting_evidence_attempt_can_be_superseded() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );
        env.ledger().with_mut(|l| l.timestamp = cfg.expiry_secs + 1);
        assert!(!client.has_pending(&account));

        let second = client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 3),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );
        assert_eq!(
            second, 2,
            "attempt ids increment even across a superseded stale attempt"
        );
    }

    #[test]
    fn continue_policy_never_blocks_ordinary_writes() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        let mut cfg = guardian_only_config(&env, guardians, 2);
        cfg.pending_activity_policy = PendingActivityPolicy::Continue;
        client.enroll(&account, &cfg);

        let attempt_id = client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 1),
            &hash_of(&env, 2),
            &Vec::new(&env),
        );
        client.submit_guardian_approval(&account, &attempt_id, &g1);
        client.submit_guardian_approval(&account, &attempt_id, &g2);
        assert!(matches!(
            client.get_attempt(&account).unwrap().state,
            AttemptState::AuthorizedPending
        ));
        assert!(
            !client.has_pending(&account),
            "Continue policy must never block, even authorized-pending"
        );
    }

    #[test]
    fn enrolling_does_not_require_or_touch_any_document() {
        // Recovery configuration lives entirely in this controller's own
        // storage, never in the account's Perch policy document -- so
        // `enroll` needs no document argument at all, and a
        // document's canonical bytes are trivially unaffected by enrollment
        // (there is no code path in this crate that could touch them).
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);
        assert_eq!(client.config(&account), Some(cfg));
    }

    #[test]
    fn config_hash_is_deterministic_and_none_before_enrollment() {
        // The "document commitment" property, satisfied via an
        // on-chain-computable RecoveryConfig commitment rather than doc
        // embedding (blocked by the deployed perch-doc-compiler's wire
        // protocol -- see the crate doc comment's Known Limits).
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        assert_eq!(
            client.config_hash(&account),
            None,
            "unenrolled account has no commitment"
        );

        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        let hash1 = client.config_hash(&account);
        assert!(hash1.is_some());
        let hash2 = client.config_hash(&account);
        assert_eq!(
            hash1, hash2,
            "the commitment must be deterministic across reads"
        );

        let other_account = Address::generate(&env);
        let g2 = Address::generate(&env);
        let mut guardians2 = Vec::new(&env);
        guardians2.push_back(g2);
        let cfg2 = guardian_only_config(&env, guardians2, 1);
        client.enroll(&other_account, &cfg2);
        assert_ne!(
            hash1,
            client.config_hash(&other_account),
            "different configs must commit to different hashes"
        );
    }

    // --- reconfigure -----------------------------------------------------

    #[test]
    fn reconfigure_guardian_only_to_combined_adds_zk_and_leaves_guardians_untouched() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let cfg = guardian_only_config(&env, guardians.clone(), 1);
        client.enroll(&account, &cfg);

        let verifier = Address::generate(&env);
        let pool = Address::generate(&env);
        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(verifier.clone());
        combined.zk_pool = Some(pool.clone());

        client.reconfigure(&account, &combined, &Vec::new(&env));

        let stored = client.config(&account).expect("still enrolled");
        assert_eq!(stored.mode, AuthMode::Combined);
        assert_eq!(stored.guardians, guardians, "guardians must be untouched");
        assert_eq!(stored.guardian_threshold, 1);
        assert_eq!(stored.verifier, Some(verifier));
        assert_eq!(stored.zk_pool, Some(pool));
    }

    #[test]
    fn reconfigure_zk_only_to_combined_adds_guardians_and_leaves_zk_untouched() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let verifier = Address::generate(&env);
        let pool = Address::generate(&env);
        let cfg = zk_only_config(&env, verifier.clone(), pool.clone());
        client.enroll(&account, &cfg);

        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.guardians = guardians.clone();
        combined.guardian_threshold = 1;

        client.reconfigure(&account, &combined, &Vec::new(&env));

        let stored = client.config(&account).expect("still enrolled");
        assert_eq!(stored.mode, AuthMode::Combined);
        assert_eq!(
            stored.verifier,
            Some(verifier),
            "verifier must be untouched"
        );
        assert_eq!(stored.zk_pool, Some(pool), "zk_pool must be untouched");
        assert_eq!(stored.guardians, guardians);
        assert_eq!(stored.guardian_threshold, 1);
    }

    #[test]
    fn reconfigure_rejects_combined_as_a_starting_point() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let mut cfg = guardian_only_config(&env, guardians, 1);
        cfg.mode = AuthMode::Combined;
        cfg.verifier = Some(Address::generate(&env));
        cfg.zk_pool = Some(Address::generate(&env));
        client.enroll(&account, &cfg);

        assert!(
            client
                .try_reconfigure(&account, &cfg, &Vec::new(&env))
                .is_err(),
            "Combined -> anything must be refused, even a no-op reconfigure to itself"
        );
    }

    #[test]
    fn reconfigure_rejects_a_mode_swap_instead_of_addition() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        let mut swapped = cfg.clone();
        swapped.mode = AuthMode::ZkOnly;
        swapped.guardians = Vec::new(&env);
        swapped.guardian_threshold = 0;
        swapped.verifier = Some(Address::generate(&env));
        swapped.zk_pool = Some(Address::generate(&env));

        assert!(
            client
                .try_reconfigure(&account, &swapped, &Vec::new(&env))
                .is_err(),
            "GuardianOnly -> ZkOnly is a swap, not an addition -- must be refused"
        );
    }

    #[test]
    fn reconfigure_rejects_re_adding_an_already_present_factor() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian.clone());
        let cfg = guardian_only_config(&env, guardians.clone(), 1);
        client.enroll(&account, &cfg);

        // "Reconfigure" into GuardianOnly again, just with a different
        // guardian set -- looks like GuardianOnly -> GuardianOnly, which
        // isn't one of the two allowed (GuardianOnly -> Combined /
        // ZkOnly -> Combined) transitions at all.
        let other_guardian = Address::generate(&env);
        let mut other_guardians = Vec::new(&env);
        other_guardians.push_back(other_guardian);
        let mut resend = cfg.clone();
        resend.guardians = other_guardians;

        assert!(
            client
                .try_reconfigure(&account, &resend, &Vec::new(&env))
                .is_err(),
            "GuardianOnly -> GuardianOnly is not an allowed transition"
        );
    }

    #[test]
    fn reconfigure_rejects_changing_a_locked_field() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(Address::generate(&env));
        combined.zk_pool = Some(Address::generate(&env));
        combined.delay_secs += 1; // locked field, must not be changeable

        assert!(
            client
                .try_reconfigure(&account, &combined, &Vec::new(&env))
                .is_err(),
            "reconfigure must reject a change to any field other than the added factor"
        );
    }

    #[test]
    fn reconfigure_is_blocked_while_an_attempt_is_pending() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let cfg = guardian_only_config(&env, guardians, 1);
        client.enroll(&account, &cfg);

        client.begin_attempt(
            &account,
            &RecoveryAction::LostKey,
            &hash_of(&env, 0x01),
            &hash_of(&env, 0x02),
            &Vec::new(&env),
        );

        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(Address::generate(&env));
        combined.zk_pool = Some(Address::generate(&env));

        assert!(
            client
                .try_reconfigure(&account, &combined, &Vec::new(&env))
                .is_err(),
            "reconfigure must be blocked while has_pending is true, same as any other mutator"
        );
    }

    #[test]
    fn reconfigure_loss_profile_needs_only_account_auth() {
        // Loss profile (the default the wallet's simplified forms use for
        // both guardian and ZK enrollment) needs no evidence at all beyond
        // account.require_auth() -- already exercised by the two success
        // tests above (base_config defaults to Profile::Loss). This test
        // just makes that property explicit by name.
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let cfg = guardian_only_config(&env, guardians, 1);
        assert_eq!(cfg.profile, crate::types::Profile::Loss);
        client.enroll(&account, &cfg);

        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(Address::generate(&env));
        combined.zk_pool = Some(Address::generate(&env));
        // Empty guardian_evidence -- Loss profile must not need any.
        client.reconfigure(&account, &combined, &Vec::new(&env));
        assert_eq!(client.config(&account).unwrap().mode, AuthMode::Combined);
    }

    #[test]
    fn reconfigure_protected_guardian_only_needs_quorum_evidence() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2.clone());
        let mut cfg = guardian_only_config(&env, guardians, 2);
        cfg.profile = crate::types::Profile::Protected;
        client.enroll(&account, &cfg);

        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(Address::generate(&env));
        combined.zk_pool = Some(Address::generate(&env));

        // Insufficient evidence: only one of the two required guardians.
        let mut one = Vec::new(&env);
        one.push_back(g1.clone());
        assert!(
            client.try_reconfigure(&account, &combined, &one).is_err(),
            "Protected profile must require the full guardian_threshold, not just one guardian"
        );

        // Sufficient evidence: both guardians (order doesn't matter).
        let mut both = Vec::new(&env);
        both.push_back(g1);
        both.push_back(g2);
        client.reconfigure(&account, &combined, &both);
        assert_eq!(client.config(&account).unwrap().mode, AuthMode::Combined);
    }

    #[test]
    fn reconfigure_protected_guardian_evidence_rejects_a_non_guardian() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1);
        let mut cfg = guardian_only_config(&env, guardians, 1);
        cfg.profile = crate::types::Profile::Protected;
        client.enroll(&account, &cfg);

        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(Address::generate(&env));
        combined.zk_pool = Some(Address::generate(&env));

        let stranger = Address::generate(&env);
        let mut evidence = Vec::new(&env);
        evidence.push_back(stranger);
        assert!(client
            .try_reconfigure(&account, &combined, &evidence)
            .is_err());
    }

    #[test]
    fn reconfigure_protected_guardian_evidence_rejects_duplicate_guardian() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let g1 = Address::generate(&env);
        let g2 = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(g1.clone());
        guardians.push_back(g2);
        let mut cfg = guardian_only_config(&env, guardians, 2);
        cfg.profile = crate::types::Profile::Protected;
        client.enroll(&account, &cfg);

        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.verifier = Some(Address::generate(&env));
        combined.zk_pool = Some(Address::generate(&env));

        // g1 listed twice can never satisfy a threshold of 2 DISTINCT guardians.
        let mut evidence = Vec::new(&env);
        evidence.push_back(g1.clone());
        evidence.push_back(g1);
        assert!(client
            .try_reconfigure(&account, &combined, &evidence)
            .is_err());
    }

    #[test]
    fn reconfigure_protected_zk_only_evidence_is_explicitly_unsupported() {
        // Documents the real, spec-relevant gap: a ZK reconfigure-evidence
        // path would need a NEW circuit auth_hash binding (a `Reconfigure`
        // commitment domain distinct from LostKey/Compromise/Cancel) that
        // does not exist today -- refusing cleanly here, rather than
        // reusing an existing domain's binding unsafely, or building a new
        // circuit out of scope for this pass.
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = RecoveryControllerClient::new(&env, &id);
        let account = Address::generate(&env);
        let verifier = Address::generate(&env);
        let pool = Address::generate(&env);
        let mut cfg = zk_only_config(&env, verifier, pool);
        cfg.profile = crate::types::Profile::Protected;
        client.enroll(&account, &cfg);

        let guardian = Address::generate(&env);
        let mut guardians = Vec::new(&env);
        guardians.push_back(guardian);
        let mut combined = cfg.clone();
        combined.mode = AuthMode::Combined;
        combined.guardians = guardians;
        combined.guardian_threshold = 1;

        assert!(client
            .try_reconfigure(&account, &combined, &Vec::new(&env))
            .is_err());
    }
}
