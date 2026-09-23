#![no_std]
#![allow(dead_code)]

//! A single recovery controller that authorizes a doc-hash-committed target
//! document, used to compare TWO completion mechanisms on the doc-only smart
//! account:
//!
//! - **Variant A** — the controller's zero-signer `CallContract(self)` rule
//!   gates the account's EXISTING `apply_doc(doc_json)` entry point
//!   (`contracts/smart-account/src/contract.rs`). No smart-account code
//!   changes at all; see that crate's `complete_recovery` doc comment for why
//!   none are needed.
//! - **Variant B** — the same rule instead gates a NEW, dedicated
//!   `complete_recovery(doc_json)` entry point that calls the exact same
//!   internal `crate::doc::apply` pipeline `apply_doc` uses (a shared private
//!   pipeline — no exported raw mutator).
//!
//! `enforce` (below) accepts EITHER `fn_name`, so one deployed instance of
//! this controller can gate either vehicle — which variant a given test
//! exercises is purely a matter of which smart-account entry point the test
//! calls through. See `docs/recovery/stage2-findings.md` for the
//! call-ordering analysis and the resulting recommendation (Variant A).
//!
//! **Controlled test authenticator, not production evidence**: initiation/
//! cancellation are gated by a single designated `authority: Address`
//! requiring ordinary Soroban `require_auth()` — standing in for guardian
//! quorum or a verified ZK proof. This isolates the completion-mechanism
//! comparison from circuit/guardian-adapter work, which this crate does not
//! attempt. Cancellation deliberately reuses the SAME authority/evidence as
//! initiation rather than a distinct cancellation-domain commitment — a
//! known simplification, called out in `docs/recovery/stage2-findings.md`,
//! not a claim that this matches the eventual production cancellation
//! design (see `contracts/recovery-controller` for the production-shaped
//! guardian/ZK cancellation-domain separation).
//!
//! Out of scope for this crate: circuits, guardian adapters, a Merkle pool,
//! nullifiers, and any UI. `docs/recovery/TRANSITION_SPEC.md` defines the
//! fuller lifecycle (configurable pending-activity policy, cancellation
//! domains, baseline replacement, etc.) this crate does not attempt to
//! reproduce in full — it isolates one question: given a real account and a
//! real perch document pipeline, which completion vehicle is safe and why.

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Bytes, BytesN, Env, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

/// Variant A's completion vehicle: the account's existing, general doc-apply
/// entry point.
fn apply_doc_fn(e: &Env) -> Symbol {
    Symbol::new(e, "apply_doc")
}

/// Variant B's completion vehicle: the dedicated, recovery-only entry point
/// added to the smart account for this comparison.
fn complete_recovery_fn(e: &Env) -> Symbol {
    Symbol::new(e, "complete_recovery")
}

/// A single doc-hash-committed recovery attempt (narrowed to what this
/// crate needs): no baseline/replacement modeling, no configuration
/// version — just the fields both variants need to bind and time-gate a
/// completion.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingDocRecovery {
    /// sha256 of the exact canonical document bytes a completion must
    /// submit — fixed for the attempt's lifetime.
    pub target_doc_hash: BytesN<32>,
    pub initiated_at: u64,
    pub executable_after: u64,
    pub expires_at: u64,
}

/// Storage key space. Appended-only ordering is not load-bearing here (this
/// crate has no upgrade/migration story), unlike `nido-zk-recovery`'s
/// XDR-ordinal-stability convention — kept alphabetical for readability.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Key {
    /// The designated "controlled test authenticator" address per account —
    /// stands in for guardian quorum / a verified ZK proof (see module doc).
    Authority(Address),
    /// The context-rule id this policy was installed under, per account —
    /// mirrors `nido-zk-recovery`'s `Installed`, same stolen-passkey-repoint
    /// hardening rationale (see `install`'s doc comment below).
    Installed(Address),
    /// The live-or-terminal attempt for an account, if any.
    Pending(Address),
    /// TEMPORARY: written by `enforce` the instant it consumes a pending
    /// (during the completing call's OWN `__check_auth`), holding the exact
    /// `target_doc_hash` that was authorized. Read-and-deleted by Variant B's
    /// `complete_recovery` body in the SAME invocation — see that entry
    /// point's doc comment in `contracts/smart-account/src/contract.rs` and
    /// `docs/recovery/stage2-findings.md`'s call-ordering section for why
    /// Variant B needs this and Variant A does not.
    CompletionGrant(Address),
}

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// `initiate`/`cancel` called for an account with no `enroll`ed authority.
    NotEnrolled = 1,
    /// `enroll` called twice for the same account.
    AlreadyEnrolled = 2,
    /// `initiate` called while a LIVE (not yet expired) attempt already
    /// exists — no silent supersede: a new initiation must
    /// never act as an uncancelled cancellation.
    AttemptAlreadyActive = 3,
    /// `cancel`, or `enforce`'s completion gate, found no live attempt.
    NoPending = 4,
    TimelockNotElapsed = 5,
    RecoveryExpired = 6,
    /// `enforce`'s gate: wrong `fn_name`, wrong arg count/shape, or the
    /// submitted document's hash does not match the attempt's committed
    /// `target_doc_hash`.
    ContextMismatch = 7,
    /// `enforce`: `context_rule.id` does not match the id this policy was
    /// installed under for this account.
    RuleMismatch = 8,
    NotInstalled = 9,
    AlreadyInstalled = 10,
    /// `uninstall` always refuses — see its doc comment.
    Unauthorized = 11,
}

/// `initiate` (controlled test authenticator's evidence accepted).
#[contractevent(topics = ["doc_recovery_initiated"], data_format = "map")]
pub struct DocRecoveryInitiated<'a> {
    #[topic]
    pub account: &'a Address,
    pub target_doc_hash: &'a BytesN<32>,
    pub executable_after: &'a u64,
}

/// `cancel`.
#[contractevent(topics = ["doc_recovery_canceled"], data_format = "map")]
pub struct DocRecoveryCanceled<'a> {
    #[topic]
    pub account: &'a Address,
}

/// `Policy::enforce` completion.
#[contractevent(topics = ["doc_recovery_completed"], data_format = "map")]
pub struct DocRecoveryCompleted<'a> {
    #[topic]
    pub account: &'a Address,
    pub target_doc_hash: &'a BytesN<32>,
}

/// Install parameters for this `Policy`. Structurally identical to
/// `nido-zk-recovery`'s `ZkRecoveryInstallParams` (`{ version: u32 }`) —
/// `#[contracttype]` structs encode purely structurally (an `ScMap` keyed by
/// field-name symbols, no nominal type tag), so the smart account's existing
/// `install_recovery_rule` helper (which always encodes
/// `ZkRecoveryInstallParams { version: 1 }`) decodes into this type
/// unchanged. This lets this crate reuse the account's EXISTING
/// constructor/`enroll_zk_recovery` install path and its `guard_no_pending`
/// wiring verbatim, with zero smart-account code changes for Variant A.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocRecoveryInstallParams {
    pub version: u32,
}

fn extend_persistent_max(env: &Env, key: &Key) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(key, max, max);
}

fn authority_or_panic(env: &Env, account: &Address) -> Address {
    env.storage()
        .persistent()
        .get(&Key::Authority(account.clone()))
        .unwrap_or_else(|| panic_with_error!(env, Error::NotEnrolled))
}

#[contract]
pub struct DocRecoveryCompletion;

#[contractimpl]
impl DocRecoveryCompletion {
    /// Designates `authority` as `account`'s controlled test authenticator.
    /// Self-authed by `account` (mirrors `nido-smart-account`'s
    /// `enroll_zk_recovery`: the account opts itself in). Panics
    /// `AlreadyEnrolled` on a second call — this crate does not model
    /// authority rotation.
    #[allow(clippy::needless_pass_by_value)]
    pub fn enroll(e: Env, account: Address, authority: Address) {
        account.require_auth();
        let key = Key::Authority(account);
        if e.storage().persistent().has(&key) {
            panic_with_error!(&e, Error::AlreadyEnrolled);
        }
        e.storage().persistent().set(&key, &authority);
        extend_persistent_max(&e, &key);
    }

    /// View: the enrolled authority for `account`, if any.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn authority(e: Env, account: Address) -> Option<Address> {
        e.storage().persistent().get(&Key::Authority(account))
    }

    /// Starts a timelocked doc-recovery attempt for `account`, committing to
    /// `target_doc_hash` (fixed for the attempt's lifetime, never
    /// recomputed). Requires the enrolled authority's own `require_auth`
    /// — real Soroban authorization, standing in for guardian quorum / a
    /// verified ZK proof (module doc). Refuses (`AttemptAlreadyActive`) if a
    /// LIVE attempt already exists (no silent supersede).
    /// Returns `executable_after`.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn initiate(
        e: Env,
        account: Address,
        target_doc_hash: BytesN<32>,
        delay_secs: u64,
        expiry_secs: u64,
    ) -> u64 {
        let authority = authority_or_panic(&e, &account);
        authority.require_auth();

        let now = e.ledger().timestamp();
        let pending_key = Key::Pending(account.clone());
        if let Some(existing) = e
            .storage()
            .persistent()
            .get::<_, PendingDocRecovery>(&pending_key)
        {
            if now < existing.expires_at {
                panic_with_error!(&e, Error::AttemptAlreadyActive);
            }
        }

        let executable_after = now + delay_secs;
        let expires_at = executable_after + expiry_secs;
        let pending = PendingDocRecovery {
            target_doc_hash: target_doc_hash.clone(),
            initiated_at: now,
            executable_after,
            expires_at,
        };
        e.storage().persistent().set(&pending_key, &pending);
        extend_persistent_max(&e, &pending_key);

        DocRecoveryInitiated {
            account: &account,
            target_doc_hash: &target_doc_hash,
            executable_after: &executable_after,
        }
        .publish(&e);

        executable_after
    }

    /// Withdraws a LIVE attempt for `account`. Requires the SAME enrolled
    /// authority as `initiate` — a known simplification: production
    /// cancellation should use a distinct cancellation-domain commitment
    /// so a leaked initiation approval cannot double as a cancellation;
    /// this crate does not model domain separation
    /// (see the module doc and `docs/recovery/stage2-findings.md`). Panics
    /// `NoPending` if no live attempt exists.
    #[allow(clippy::needless_pass_by_value)]
    pub fn cancel(e: Env, account: Address) {
        let authority = authority_or_panic(&e, &account);
        authority.require_auth();

        let now = e.ledger().timestamp();
        let pending_key = Key::Pending(account.clone());
        let live = e
            .storage()
            .persistent()
            .get::<_, PendingDocRecovery>(&pending_key)
            .filter(|p| now < p.expires_at);
        if live.is_none() {
            panic_with_error!(&e, Error::NoPending);
        }
        e.storage().persistent().remove(&pending_key);

        DocRecoveryCanceled { account: &account }.publish(&e);
    }

    /// View: the live-or-stale attempt for `account`, if any.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn get_pending(e: Env, account: Address) -> Option<PendingDocRecovery> {
        e.storage().persistent().get(&Key::Pending(account))
    }

    /// View: `true` iff a LIVE (not yet expired) attempt exists for
    /// `account`. Cross-called by the smart account's `guard_no_pending`
    /// (`contracts/smart-account/src/contract.rs`) exactly like
    /// `nido-zk-recovery::has_pending` — this is what makes Variant A's
    /// `apply_doc` block ordinary writes while an attempt is pending, and
    /// stop blocking the instant `enforce` consumes it (see the module doc's
    /// call-ordering note).
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn has_pending(e: Env, account: Address) -> bool {
        let now = e.ledger().timestamp();
        e.storage()
            .persistent()
            .get::<_, PendingDocRecovery>(&Key::Pending(account))
            .is_some_and(|p| now < p.expires_at)
    }

    /// View: always `false`. This controller never uses the account's
    /// EXISTING `add_context_rule` completion vehicle (that gate's own
    /// `has_pending() || completion_granted()` OR-check is precisely the
    /// coarse boolean-flag pattern this crate's design deliberately avoids
    /// — see `docs/recovery/stage2-findings.md`) — but the account's guard cross-
    /// calls this method unconditionally whenever THIS controller is
    /// installed as `recovery_controller`, so it must exist and must not
    /// silently open that vehicle for either variant.
    #[must_use]
    // `#[contractimpl]`'s generated invoke-wrapper code binds each non-`Env`
    // param to a same-named local before forwarding it to this method, which
    // clippy counts as a "use" of the underscore-prefixed binding even
    // though this method's own body never reads it (mirrors
    // `nido-smart-account`'s identical `#[allow]` on its `StubRecoveryPolicy`
    // test double).
    #[allow(clippy::needless_pass_by_value, clippy::used_underscore_binding)]
    pub fn completion_granted(_e: Env, _account: Address) -> bool {
        false
    }

    /// Variant B only: reads and DELETES the value-bound completion grant
    /// `enforce` wrote for `account`, if any — single-use by construction
    /// (the second read of the same invocation, or any later one, sees
    /// `None`). Returns the exact `target_doc_hash` that was authorized, so
    /// the caller (the smart account's `complete_recovery` body) can bind the
    /// document it is about to install to what was actually granted, rather
    /// than trusting a bare boolean. See `docs/recovery/stage2-findings.md`'s
    /// call-ordering section for why Variant B needs this and Variant A does
    /// not.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn take_completion_grant(e: Env, account: Address) -> Option<BytesN<32>> {
        let key = Key::CompletionGrant(account);
        let value = e.storage().temporary().get(&key);
        if value.is_some() {
            e.storage().temporary().remove(&key);
        }
        value
    }
}

#[contractimpl]
impl Policy for DocRecoveryCompletion {
    type AccountParams = DocRecoveryInstallParams;

    /// Installs this contract as `smart_account`'s recovery completion
    /// authority, recording which rule id it was installed under
    /// (`Key::Installed`) — mirrors `nido-zk-recovery::Policy::install`
    /// verbatim, including its stolen-passkey-repoint hardening: once
    /// installed for an account, a second `install` call for the SAME
    /// account is refused (`AlreadyInstalled`), so a thief holding a stolen
    /// passkey cannot directly call this entry point to repoint
    /// `Installed(account)` at a fabricated rule id and permanently neuter
    /// completion. Requires the rule to be zero-signer and scoped to
    /// `CallContract(smart_account)` (self only).
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

    /// The completion gate, shared by both variants. Ordered checks:
    /// 1. `context_rule.id` must equal the id this policy was installed
    ///    under for `smart_account` (`RuleMismatch` otherwise).
    /// 2. A live attempt must exist (`NoPending`), its timelock must have
    ///    elapsed (`TimelockNotElapsed`), and it must not be expired
    ///    (`RecoveryExpired`).
    /// 3. `context` must be a self-call whose `fn_name` is EITHER
    ///    `apply_doc` (Variant A) or `complete_recovery` (Variant B), with
    ///    EXACTLY one argument decoding to `Bytes` whose sha256 equals the
    ///    attempt's committed `target_doc_hash` — anything else is
    ///    `ContextMismatch`. This is the entire binding: the same document
    ///    the authority approved at `initiate` time is the ONLY document a
    ///    completion can install, for either vehicle.
    /// 4. Consume: delete the pending (single completion — a second
    ///    completion attempt, same transaction, same ledger, or after
    ///    expiry, finds no pending and fails at step 2), write the
    ///    value-bound completion grant Variant B's body reads, and emit.
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

        let pending_key = Key::Pending(smart_account.clone());
        let pending: PendingDocRecovery = e
            .storage()
            .persistent()
            .get(&pending_key)
            .unwrap_or_else(|| panic_with_error!(e, Error::NoPending));

        let now = e.ledger().timestamp();
        if now < pending.executable_after {
            panic_with_error!(e, Error::TimelockNotElapsed);
        }
        if now >= pending.expires_at {
            panic_with_error!(e, Error::RecoveryExpired);
        }

        let cc: ContractContext = match context {
            Context::Contract(cc) if cc.contract == smart_account => cc,
            _ => panic_with_error!(e, Error::ContextMismatch),
        };
        if cc.fn_name != apply_doc_fn(e) && cc.fn_name != complete_recovery_fn(e) {
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
        if submitted_hash != pending.target_doc_hash {
            panic_with_error!(e, Error::ContextMismatch);
        }

        e.storage().persistent().remove(&pending_key);
        e.storage().temporary().set(
            &Key::CompletionGrant(smart_account.clone()),
            &submitted_hash,
        );

        DocRecoveryCompleted {
            account: &smart_account,
            target_doc_hash: &submitted_hash,
        }
        .publish(e);
    }

    /// UNCONDITIONALLY REFUSES — same reentrancy-safety argument as
    /// `nido-zk-recovery::Policy::uninstall` (see that doc comment): from
    /// inside the account's own `remove_context_rule`/`remove_policy` call,
    /// no cross-call back into the account can distinguish a legitimate
    /// teardown from a thief's forged direct call, so this refuses both.
    /// This crate has no announce-then-execute removal path of its own
    /// (out of scope — it reuses the smart account's, exactly as
    /// `nido-zk-recovery` does), so `try_uninstall`'s panic-swallowing
    /// (`stellar-accounts`) is what lets that removal path still work.
    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        let _ = context_rule;
        smart_account.require_auth();
        panic_with_error!(e, Error::Unauthorized);
    }
}

#[cfg(test)]
mod tests {
    //! Unit coverage for the controller in isolation (no smart account
    //! involved) — the full account+controller+doc-pipeline properties live
    //! in `crates/integration-tests/tests/it/recovery_stage2_*.rs`.
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::Env;

    fn deploy(env: &Env) -> Address {
        env.register(DocRecoveryCompletion, ())
    }

    fn hash_of(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    #[test]
    fn enroll_requires_account_auth_and_is_one_shot() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = DocRecoveryCompletionClient::new(&env, &id);
        let account = Address::generate(&env);
        let authority = Address::generate(&env);

        client.enroll(&account, &authority);
        assert_eq!(client.authority(&account), Some(authority.clone()));

        let other = Address::generate(&env);
        assert!(
            client.try_enroll(&account, &other).is_err(),
            "a second enroll for the same account must be refused"
        );
    }

    #[test]
    fn initiate_requires_authority_auth() {
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        use soroban_sdk::IntoVal;

        let env = Env::default();
        let id = deploy(&env);
        let client = DocRecoveryCompletionClient::new(&env, &id);
        let account = Address::generate(&env);
        let authority = Address::generate(&env);

        // `enroll` needs only the account's own auth -- mock that call
        // specifically rather than globally, so `initiate` below is left
        // with NO mocked auths at all.
        client
            .mock_auths(&[MockAuth {
                address: &account,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "enroll",
                    args: (account.clone(), authority.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .enroll(&account, &authority);

        // No auths mocked for this call: the authority's require_auth must reject.
        assert!(client
            .try_initiate(&account, &hash_of(&env, 1), &1000u64, &1000u64)
            .is_err());
    }

    #[test]
    fn no_silent_supersede_of_a_live_attempt() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = DocRecoveryCompletionClient::new(&env, &id);
        let account = Address::generate(&env);
        let authority = Address::generate(&env);
        client.enroll(&account, &authority);

        client.initiate(&account, &hash_of(&env, 1), &1000u64, &1000u64);
        assert!(
            client
                .try_initiate(&account, &hash_of(&env, 2), &1000u64, &1000u64)
                .is_err(),
            "a live attempt must not be silently superseded"
        );
    }

    #[test]
    fn expired_attempt_can_be_reinitiated() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = DocRecoveryCompletionClient::new(&env, &id);
        let account = Address::generate(&env);
        let authority = Address::generate(&env);
        client.enroll(&account, &authority);

        client.initiate(&account, &hash_of(&env, 1), &1000u64, &1000u64);
        let pending = client.get_pending(&account).unwrap();
        env.ledger()
            .with_mut(|l| l.timestamp = pending.expires_at + 1);
        assert!(!client.has_pending(&account));

        client.initiate(&account, &hash_of(&env, 2), &1000u64, &1000u64);
        assert_eq!(
            client.get_pending(&account).unwrap().target_doc_hash,
            hash_of(&env, 2)
        );
    }

    #[test]
    fn cancel_requires_a_live_attempt_and_clears_it() {
        let env = Env::default();
        env.mock_all_auths();
        let id = deploy(&env);
        let client = DocRecoveryCompletionClient::new(&env, &id);
        let account = Address::generate(&env);
        let authority = Address::generate(&env);
        client.enroll(&account, &authority);

        assert!(
            client.try_cancel(&account).is_err(),
            "cancel with no pending must fail"
        );

        client.initiate(&account, &hash_of(&env, 1), &1000u64, &1000u64);
        client.cancel(&account);
        assert!(!client.has_pending(&account));
        assert!(client.get_pending(&account).is_none());
    }

    #[test]
    fn take_completion_grant_is_single_use() {
        let env = Env::default();
        let id = deploy(&env);
        let account = Address::generate(&env);
        let hash = hash_of(&env, 7);
        env.as_contract(&id, || {
            env.storage()
                .temporary()
                .set(&Key::CompletionGrant(account.clone()), &hash);
        });

        let client = DocRecoveryCompletionClient::new(&env, &id);
        assert_eq!(client.take_completion_grant(&account), Some(hash));
        assert_eq!(
            client.take_completion_grant(&account),
            None,
            "a second read in the same invocation window must see the grant already consumed"
        );
    }

    #[test]
    fn completion_granted_is_always_false() {
        let env = Env::default();
        let id = deploy(&env);
        let client = DocRecoveryCompletionClient::new(&env, &id);
        let account = Address::generate(&env);
        assert!(!client.completion_granted(&account));
    }
}
