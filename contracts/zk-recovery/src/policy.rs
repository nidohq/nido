//! `Policy::enforce` completion authority (spec §3.1, M1 Task 7 -- the M1
//! HARD REQUIREMENT).
//!
//! After a recovery's timelock elapses, a permissionless `add_context_rule`
//! call on the recovering account is authorized purely by this policy's
//! `enforce` -- OZ's own matching (`get_validated_context_by_id`,
//! `stellar-accounts` `storage.rs:289-301`, confirmed by the M0 spike
//! `zk_completion_spike.rs`) validates ONLY the target `contract` of a
//! `CallContract(self)` rule, NOT `fn_name` or `args`. A zero-signer
//! recovery rule is therefore, as far as OZ is concerned, an "authorize any
//! self-call" rule. Every bit of this module below the pending/timelock
//! checks exists to close that gap: `enforce` inspects the `Context` itself
//! and permits ONLY an `add_context_rule` call whose new-signers argument is
//! EXACTLY the pending recovery's proven `new_pubkey`, wrapped as the
//! expected `Signer::External(webauthn_verifier, ..)`. Anything else --
//! wrong `fn_name` (e.g. `remove_signer`), wrong/extra signers, or any
//! attached `policies` -- is rejected with `ContextMismatch`. Without this
//! gate, reaching `enforce` (e.g. via the SAME zero-signer rule selected for
//! an unrelated self-call) would authorize ANY self-call, including
//! `remove_signer` or installing arbitrary new rules/policies.
//!
//! This file adds a THIRD `#[contractimpl]` block on `pool::ZkRecovery` --
//! see `pool.rs`'s and `controller.rs`'s doc comments for why this lives as
//! a `#[path]` submodule of `pool` rather than a sibling top-level module.

use crate::pool::{config, ZkRecovery, ZkRecoveryArgs, ZkRecoveryClient};
#[allow(unused_imports)]
// referenced by the `#[contractimpl]` macro expansion, not by name here.
use crate::types::{
    NullifierState, PendingRecovery, RecoveryCompleted, RecoveryError, RecoveryKey,
    ZkRecoveryInstallParams,
};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::{
    contractimpl, panic_with_error, Address, Bytes, Env, Map, Symbol, TryFromVal, Val, Vec,
};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

/// Extends a persistent entry's TTL to the network max, mirroring
/// `merkle.rs::extend_persistent_max`/`controller.rs::extend_persistent_max`
/// (duplicated rather than made `pub` -- this module's keys are unrelated to
/// either's).
fn extend_persistent_max(env: &Env, key: &RecoveryKey) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(key, max, max);
}

/// The exact `fn_name` a completion call must carry (spec §3.1). Any other
/// invocation reaching `enforce` via the zero-signer recovery rule (e.g.
/// `remove_signer`, since OZ only checks the rule's `contract` scope) is
/// rejected.
fn completion_fn_name(e: &Env) -> Symbol {
    Symbol::new(e, "add_context_rule")
}

#[contractimpl]
impl Policy for ZkRecovery {
    type AccountParams = ZkRecoveryInstallParams;

    /// Installs this contract as `smart_account`'s recovery completion
    /// authority for `context_rule`, recording which rule id it was
    /// installed under (`RecoveryKey::Installed`) -- `enforce` uses this to
    /// reject being invoked for any OTHER rule the account might also have
    /// pointed at this same policy contract address.
    ///
    /// Requires the account's own auth (standard OZ `Policy::install`
    /// contract, satisfied here via the "invoker contract auth" mechanism --
    /// `install` is always cross-called from within the account's own
    /// `add_context_rule`, so no separate signature is needed). Requires the
    /// rule to be zero-signer (authorization comes solely from this policy,
    /// spec §3.1) and scoped to `CallContract(smart_account)` (self only --
    /// never a rule that could authorize calls against a DIFFERENT
    /// contract).
    ///
    /// # Stolen-passkey hardening (spec §3.1, the direct-call neuter fix)
    ///
    /// `smart_account.require_auth()` alone is NOT a sufficient gate: a thief
    /// holding a stolen `WebAuthn` passkey satisfies the account's Default rule,
    /// so they can call this `install` ENTRY POINT DIRECTLY (top-level, or via
    /// the account's `execute`) -- bypassing the M2 in-account guard and the
    /// 7-day removal delay. Without further checks, a direct
    /// `install(params, fabricated_rule, account)` on an ALREADY-enrolled
    /// account would silently REPOINT `RecoveryKey::Installed(account)` to a
    /// bogus rule id, so every future completion `enforce` panics
    /// `RuleMismatch` -- recovery permanently neutered, on-chain rule
    /// untouched.
    ///
    /// The **`AlreadyInstalled` guard** below closes that: once an account has
    /// this policy installed, `install` refuses to run again for it. The only
    /// legitimate `install` per account fires EXACTLY ONCE, atomically inside
    /// the account's own construction (`Some(recovery_controller)`) or its
    /// `enroll_zk_recovery` migration -- at which point `Installed(account)` is
    /// absent, so the guard passes. Any later direct call (the thief's repoint)
    /// finds it set and panics.
    ///
    /// A genuine rule-EXISTENCE cross-check (verifying the account actually
    /// holds `context_rule` with this controller in its policy set) is
    /// deliberately NOT attempted: `install` runs while the account is already
    /// on the call stack (`account.add_context_rule -> controller.install`), so
    /// any cross-call back into the account (`get_context_rule`) hits Soroban's
    /// reentrancy ban and TRAPS -- which would brick ALL account creation. The
    /// `context_rule` argument is therefore treated as untrusted for
    /// authenticity; only its shape is validated. See the module notes and the
    /// `uninstall` doc for the full reentrancy-constraint reasoning.
    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();

        // Stolen-passkey neuter fix: refuse to (re)install for an account that
        // already has this policy installed -- blocks a direct repoint of
        // `Installed(account)` to a fabricated rule id. Reentrancy-free
        // (controller-local storage only).
        let key = RecoveryKey::Installed(smart_account.clone());
        if e.storage().persistent().get::<_, u32>(&key).is_some() {
            panic_with_error!(e, RecoveryError::AlreadyInstalled);
        }

        if !context_rule.signers.is_empty() {
            panic_with_error!(e, RecoveryError::ContextMismatch);
        }
        match &context_rule.context_type {
            ContextRuleType::CallContract(addr) if *addr == smart_account => {}
            _ => panic_with_error!(e, RecoveryError::ContextMismatch),
        }

        e.storage().persistent().set(&key, &context_rule.id);
        extend_persistent_max(e, &key);
        let _ = install_params;
    }

    /// The M1 hard requirement: permits ONLY the exact intended
    /// key-rotation, then consumes the pending recovery.
    ///
    /// Ordered checks:
    /// 1. `smart_account.require_auth()` -- blocks any invocation of
    ///    `enforce` that isn't itself part of the account's own auth
    ///    resolution (direct third-party calls to a policy contract's
    ///    `enforce` are meaningless anyway since only the account's
    ///    `__check_auth`/`do_check_auth` ever cross-calls it, but this
    ///    mirrors `multisig-policy`'s and OZ's `simple_threshold::enforce`
    ///    shape).
    /// 2. `context_rule.id` must equal the id this policy was `install`ed
    ///    under for `smart_account` (`RuleMismatch` otherwise) -- rejects a
    ///    stale/different rule that happens to also reference this policy
    ///    contract.
    /// 3. A live pending must exist for `smart_account`: absent ->
    ///    `NoPending`; `now < executable_after` -> `TimelockNotElapsed`;
    ///    `now >= expires_at` -> `RecoveryExpired`.
    /// 4. THE GATE: `context` must be `Context::Contract` targeting
    ///    `smart_account` itself, with `fn_name == "add_context_rule"` and
    ///    EXACTLY 5 args (`add_context_rule`'s real arity: `context_type,
    ///    name, valid_until, signers, policies`) whose `signers` (arg index
    ///    3) decodes to EXACTLY `[Signer::External(config.webauthn_verifier,
    ///    pending.new_pubkey)]` and whose `policies` (arg index 4) is EMPTY
    ///    -- a non-empty `policies` map would let a completion call sneak in
    ///    an arbitrary extra policy alongside the legitimate rotation, so
    ///    it's rejected too. Anything else -> `ContextMismatch`.
    /// 5. Consume: the pending's nullifier becomes permanently `Spent`, the
    ///    pending record is deleted, and `RecoveryCompleted` is emitted.
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
            .get(&RecoveryKey::Installed(smart_account.clone()))
            .unwrap_or_else(|| panic_with_error!(e, RecoveryError::NotInstalled));
        if installed_id != context_rule.id {
            panic_with_error!(e, RecoveryError::RuleMismatch);
        }

        let pending_key = RecoveryKey::Pending(smart_account.clone());
        let pending: PendingRecovery = e
            .storage()
            .persistent()
            .get(&pending_key)
            .unwrap_or_else(|| panic_with_error!(e, RecoveryError::NoPending));

        let now = e.ledger().timestamp();
        if now < pending.executable_after {
            panic_with_error!(e, RecoveryError::TimelockNotElapsed);
        }
        if now >= pending.expires_at {
            panic_with_error!(e, RecoveryError::RecoveryExpired);
        }

        // --- THE GATE (spec §3.1, the M1 hard requirement) ---
        let cc: ContractContext = match context {
            Context::Contract(cc) if cc.contract == smart_account => cc,
            _ => panic_with_error!(e, RecoveryError::ContextMismatch),
        };
        if cc.fn_name != completion_fn_name(e) {
            panic_with_error!(e, RecoveryError::ContextMismatch);
        }
        // `add_context_rule(context_type, name, valid_until, signers,
        // policies)` -- exactly 5 args; `signers` is index 3, `policies` is
        // index 4.
        if cc.args.len() != 5 {
            panic_with_error!(e, RecoveryError::ContextMismatch);
        }
        let signers_val: Val = cc
            .args
            .get(3)
            .unwrap_or_else(|| panic_with_error!(e, RecoveryError::ContextMismatch));
        let new_signers: Vec<Signer> = Vec::try_from_val(e, &signers_val)
            .unwrap_or_else(|_| panic_with_error!(e, RecoveryError::ContextMismatch));
        let policies_val: Val = cc
            .args
            .get(4)
            .unwrap_or_else(|| panic_with_error!(e, RecoveryError::ContextMismatch));
        let new_policies: Map<Address, Val> = Map::try_from_val(e, &policies_val)
            .unwrap_or_else(|_| panic_with_error!(e, RecoveryError::ContextMismatch));
        if !new_policies.is_empty() {
            panic_with_error!(e, RecoveryError::ContextMismatch);
        }

        let cfg = config(e);
        let expected_signer = Signer::External(
            cfg.webauthn_verifier,
            Bytes::from_array(e, &pending.new_pubkey.to_array()),
        );
        let mut expected_signers: Vec<Signer> = Vec::new(e);
        expected_signers.push_back(expected_signer);
        if new_signers != expected_signers {
            panic_with_error!(e, RecoveryError::ContextMismatch);
        }

        // --- Consume ---
        let nullifier_key = RecoveryKey::Nullifier(pending.nullifier.clone());
        e.storage()
            .persistent()
            .set(&nullifier_key, &NullifierState::Spent);
        extend_persistent_max(e, &nullifier_key);
        e.storage().persistent().remove(&pending_key);

        RecoveryCompleted {
            account: &smart_account,
            nullifier: &pending.nullifier,
        }
        .publish(e);
    }

    /// UNCONDITIONALLY REFUSES (spec §3.1, the direct-call neuter fix).
    ///
    /// # Why refusing is the only reentrancy-safe choice
    ///
    /// The pre-fix `uninstall` cleared `RecoveryKey::Installed(account)` on any
    /// call gated solely by `smart_account.require_auth()`. A thief holding a
    /// stolen `WebAuthn` passkey satisfies that, so a direct
    /// `uninstall(any_rule, account)` (top-level, or via the account's
    /// `execute`) cleared `Installed` while the account's recovery rule stayed
    /// intact on-chain -- every future completion `enforce` then panics
    /// `NotInstalled`, permanently neutering recovery, instantly, bypassing the
    /// M2 in-account guard and the 7-day removal delay.
    ///
    /// A discriminator that PASSES the legitimate teardown but FAILS a thief's
    /// direct call is not achievable at this contract:
    /// - The account's on-chain state (does the rule still reference this
    ///   controller? has removal been announced-and-elapsed?) is the only thing
    ///   that distinguishes them -- but `uninstall` is invoked from WITHIN the
    ///   account's own `remove_context_rule`/`remove_policy` (account already on
    ///   the call stack), so any cross-call back into the account
    ///   (`get_context_rule`, a removal-ready view, ...) hits Soroban's
    ///   reentrancy ban and TRAPS -- which would break the legitimate teardown
    ///   itself (empirically confirmed: `Error(Context, InvalidAction)`).
    /// - Controller-local signals (`has_pending`, the `context_rule` argument)
    ///   are identical between a genuine `execute_recovery_rule_removal`
    ///   teardown and a thief's forged call: OZ invokes `uninstall` BEFORE
    ///   deleting the rule, so the rule still references this controller in
    ///   BOTH cases, and the thief picks a no-pending moment and forges a
    ///   matching `context_rule`.
    ///
    /// So this refuses ALL `uninstall` calls. This is safe for the ONE
    /// legitimate invocation -- OZ's `remove_context_rule`/`remove_policy` call
    /// this via `try_uninstall`, which SWALLOWS a policy panic by design ("so
    /// that if the policy panics (recoverable failure), context rule removal
    /// can still be completed", `stellar-accounts` `storage.rs`). The account's
    /// 7-day-gated `execute_recovery_rule_removal` therefore still removes the
    /// recovery rule end-to-end; the now-orphaned `Installed(account)` marker
    /// is inert (no rule routes to this controller, so `enforce` is
    /// unreachable). A thief's direct `uninstall` likewise only earns this
    /// panic and CANNOT clear `Installed`, so a live recovery survives.
    ///
    /// Trade-off (documented, low-severity): because the marker is not cleared
    /// on removal, re-enrolling the SAME account into recovery after an opt-out
    /// would hit the `install` `AlreadyInstalled` guard. The clean path is a
    /// fresh account (the privacy-preserving norm); this cannot be relaxed
    /// without a reentrancy-safe way to clear `Installed`, which does not exist
    /// here.
    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        let _ = context_rule;
        smart_account.require_auth();
        panic_with_error!(e, RecoveryError::Unauthorized);
    }
}
