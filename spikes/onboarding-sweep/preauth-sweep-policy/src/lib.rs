#![no_std]
//! # Preauthorized-sweep policy (SPIKE / prototype — do NOT ship as-is)
//!
//! A minimal OpenZeppelin `Policy` that grants a dedicated "sweep signer" on a
//! Nido smart account **C** the authority to authorize *exactly one thing* and
//! nothing else: pulling a classic onboarding account **G**'s balance into C
//! via a Stellar Asset Contract (SAC) `transfer_from(spender = C, from = G,
//! to = C, amount)`.
//!
//! ## Why a policy (design A) rather than a native account method (design B)
//!
//! OZ's context-rule machinery scopes a signer to a whole *contract*
//! (`ContextRuleType::CallContract(sac)`), never to a single *function*. So a
//! bare `CallContract(sac)` rule would let the sweep signer call ANY SAC method
//! (`transfer`, `approve`, `burn`, `transfer_from` with any `to`). Function +
//! argument narrowing is only achievable inside a policy's `enforce`, which
//! DOES receive the invocation `Context` (contract, fn_name, args). This
//! contract reads `transfer_from`'s `(from, to)` arguments straight out of that
//! Context and panics unless `from == recorded G` and `to == C`. It leaves the
//! recovery-guarded core smart-account contract completely untouched.
//!
//! ## The bound (the entire security claim)
//!
//! The sweep signer is a member of ONLY this one rule. `do_check_auth` rejects
//! it for any other rule (`UnauthorizedSigner`). This rule is
//! `CallContract(sac)`, so `do_check_auth` rejects it for any other contract
//! (`UnvalidatedContext`). And this policy's `enforce` panics unless the call
//! is precisely `transfer_from(from = stored G, to = C)`. Therefore the sweep
//! signer alone can authorize exactly the sweep and nothing else:
//! - N1 wrong destination (`to != C`)  -> `WrongDestination`
//! - N2 wrong source      (`from != G`) -> `WrongSource`
//! - N3 any other function (`transfer`, `approve`, ...) -> `NotTransferFrom`
//!   and any other contract is rejected upstream by the rule's `CallContract`
//!   scope before `enforce` is even reached.

use admin_sep::{Administratable, Upgradable};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
    TryFromVal, Vec,
};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

/// Installation parameters: the single classic account **G** whose balance this
/// rule may sweep FROM. Recorded at install time and immutable thereafter
/// except via uninstall/reinstall (both smart-account-authorized).
#[contracttype]
#[derive(Clone)]
pub struct PreauthSweepParams {
    /// The onboarding source account G. `transfer_from`'s `from` arg must equal
    /// this exactly.
    pub source: Address,
}

/// Per-(account, rule) storage key holding the recorded source G.
#[contracttype]
pub enum SweepStorageKey {
    /// `(smart_account, context_rule_id) -> source G`
    AccountContext(Address, u32),
}

/// Error codes. Distinct per rejection reason so tests can assert the sweep
/// was blocked for the RIGHT reason, not by an incidental failure.
#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SweepError {
    /// No sweep policy installed for this (account, rule).
    NotInstalled = 1,
    /// A sweep policy is already installed for this (account, rule).
    AlreadyInstalled = 2,
    /// No signer authenticated — the sweep key must actually sign.
    NoSigner = 3,
    /// `from` argument != the recorded source G. (N2)
    WrongSource = 4,
    /// `to` argument != the smart account C. (N1)
    WrongDestination = 5,
    /// The invoked function is not `transfer_from`. (N3)
    NotTransferFrom = 6,
    /// Rule is not `CallContract(sac)` — refuse to pin an unscoped rule.
    OnlyCallContract = 7,
    /// A `transfer_from` argument was missing or the wrong type.
    MalformedArgs = 8,
    /// Negative amount.
    NegativeAmount = 9,
}

#[contract]
pub struct PreauthSweepPolicy;

// Admin/upgrade governance mirrors the sibling policy contracts
// (spending-limit-policy / multisig-policy): admin-sep supplies
// admin/set_admin/upgrade. The enforce/install/uninstall paths never read
// admin, so per-account state and gas are unaffected.
#[contractimpl(contracttrait)]
impl Administratable for PreauthSweepPolicy {}

#[contractimpl(contracttrait)]
impl Upgradable for PreauthSweepPolicy {}

#[contractimpl]
impl PreauthSweepPolicy {
    /// Record the `admin` authorized to rotate the admin or upgrade this
    /// policy. `set_admin` on first call (no admin yet) skips the auth check.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(e: Env, admin: Address) {
        Self::set_admin(&e, admin);
    }

    /// Read the recorded source G for a given (account, rule). None if not
    /// installed. Lets a relayer/SDK confirm what a rule is pinned to.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn get_source(e: &Env, context_rule_id: u32, smart_account: Address) -> Option<Address> {
        e.storage()
            .persistent()
            .get(&SweepStorageKey::AccountContext(smart_account, context_rule_id))
    }
}

#[contractimpl]
impl Policy for PreauthSweepPolicy {
    type AccountParams = PreauthSweepParams;

    fn enforce(
        e: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        // Same auth model as the OZ building blocks: the enforce path is
        // authorized by the smart account itself.
        smart_account.require_auth();

        // Load-bearing: with a policy attached, OZ defers signer-matching to
        // enforce. Without this guard the rule could be satisfied with zero
        // sweep-key signatures.
        if authenticated_signers.is_empty() {
            panic_with_error!(e, SweepError::NoSigner);
        }

        let source: Address = e
            .storage()
            .persistent()
            .get(&SweepStorageKey::AccountContext(smart_account.clone(), context_rule.id))
            .unwrap_or_else(|| panic_with_error!(e, SweepError::NotInstalled));

        match context {
            Context::Contract(ContractContext { fn_name, args, .. }) => {
                // GOTCHA: "transfer_from" is 13 chars; symbol_short! caps at 9
                // and would not compile. Must use Symbol::new.
                if fn_name != Symbol::new(e, "transfer_from") {
                    panic_with_error!(e, SweepError::NotTransferFrom);
                }

                // SAC transfer_from(spender, from, to, amount)
                //   args[0]=spender(==C), args[1]=from, args[2]=to, args[3]=amount
                let from = args
                    .get(1)
                    .and_then(|v| Address::try_from_val(e, &v).ok())
                    .unwrap_or_else(|| panic_with_error!(e, SweepError::MalformedArgs));
                let to = args
                    .get(2)
                    .and_then(|v| Address::try_from_val(e, &v).ok())
                    .unwrap_or_else(|| panic_with_error!(e, SweepError::MalformedArgs));
                let amount = args
                    .get(3)
                    .and_then(|v| i128::try_from_val(e, &v).ok())
                    .unwrap_or_else(|| panic_with_error!(e, SweepError::MalformedArgs));

                if from != source {
                    panic_with_error!(e, SweepError::WrongSource);
                }
                if to != smart_account {
                    panic_with_error!(e, SweepError::WrongDestination);
                }
                if amount < 0 {
                    panic_with_error!(e, SweepError::NegativeAmount);
                }
                // pass: exactly transfer_from(from = G, to = C), amount >= 0.
            }
            _ => panic_with_error!(e, SweepError::NotTransferFrom),
        }
    }

    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();

        // Pin the rule to a single token contract. A Default rule would let the
        // sweep signer's rule match every contract; refuse it.
        if !matches!(context_rule.context_type, ContextRuleType::CallContract(_)) {
            panic_with_error!(e, SweepError::OnlyCallContract);
        }

        let key = SweepStorageKey::AccountContext(smart_account.clone(), context_rule.id);
        if e.storage().persistent().has(&key) {
            panic_with_error!(e, SweepError::AlreadyInstalled);
        }
        e.storage().persistent().set(&key, &install_params.source);
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let key = SweepStorageKey::AccountContext(smart_account, context_rule.id);
        if !e.storage().persistent().has(&key) {
            panic_with_error!(e, SweepError::NotInstalled);
        }
        e.storage().persistent().remove(&key);
    }
}
