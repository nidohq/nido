// The `ref_option` lint is triggered by Soroban SDK macro-generated code
// (contractclient/contractargs) for `Option<u32>` parameters, not by our code.
#![allow(clippy::ref_option)]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Address, Env, IntoVal, Map, String, Symbol, Val, Vec,
};
use stellar_accounts::policies::simple_threshold::SimpleThresholdAccountParams;
use stellar_accounts::smart_account::{
    add_context_rule, add_policy, add_signer, do_check_auth, get_context_rule,
    get_context_rules_count, remove_context_rule, remove_policy, remove_signer,
    update_context_rule_name, update_context_rule_valid_until, AuthPayload, ContextRule,
    ContextRuleType, ExecutionEntryPoint, Signer, SmartAccount, SmartAccountError,
};

/// Instance storage key for the `u32` id of the zero-signer recovery
/// `ContextRule` installed at construction (`Some(recovery_controller)`
/// path only). Absent when the account was constructed with `None`.
const RECOVERY_RULE_ID: Symbol = symbol_short!("RCVR_ID");

/// Instance storage key for the recovery controller `Address` the recovery
/// rule's policy points at. Absent when the account was constructed with
/// `None`.
const RECOVERY_CONTROLLER: Symbol = symbol_short!("RCVR_CTRL");

/// Install-param shape for the M1 `nido-zk-recovery` controller's `Policy`
/// impl, reconstructed inline rather than imported.
///
/// This crate deliberately does NOT depend on `nido-zk-recovery` (see the
/// note in `Cargo.toml`): both are `#[contract]` crates, and linking one
/// into the other's cdylib collides their identically-named `#[no_mangle]`
/// exports (`__constructor`, `install`, `enforce`, …) at wasm link time.
/// `#[contracttype]` structs are encoded on the ledger purely structurally
/// (an `ScMap` keyed by field-name symbols, sorted) — there is no nominal
/// type tag — so this MUST stay byte-for-byte structurally identical to
/// `contracts/zk-recovery/src/types.rs::ZkRecoveryInstallParams` (currently
/// just `{ version: u32 }`) for the real controller's `Policy::install` to
/// decode it via `FromVal`. If that type ever changes shape, this must
/// change with it.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ZkRecoveryInstallParams {
    pub version: u32,
}

#[contract]
pub struct NidoSmartAccount;

#[contractimpl]
impl NidoSmartAccount {
    /// Initialize the smart account with a default context rule.
    ///
    /// Typically called with a single `WebAuthn` passkey signer during
    /// the Nido account creation flow.
    ///
    /// # Arguments
    ///
    /// * `signers` - Initial signers (e.g., passkey via `WebAuthn` verifier)
    /// * `policies` - Optional policies (e.g., spending limits)
    /// * `recovery_controller` - When `Some`, the M1 `nido-zk-recovery`
    ///   controller to install as this account's zero-signer
    ///   `CallContract(self)` recovery rule's policy (production factory
    ///   deploys always pass `Some`, keeping the anonymity set uniform).
    ///   `None` skips the recovery rule entirely — used by unrelated test
    ///   deploys and non-factory construction paths that don't want the
    ///   extra rule.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(
        e: &Env,
        signers: Vec<Signer>,
        policies: Map<Address, Val>,
        recovery_controller: Option<Address>,
    ) {
        add_context_rule(
            e,
            &ContextRuleType::Default,
            &String::from_str(e, "default"),
            None,
            &signers,
            &policies,
        );

        if let Some(controller) = recovery_controller {
            let install: Val = ZkRecoveryInstallParams { version: 1 }.into_val(e);
            let mut recovery_policies: Map<Address, Val> = Map::new(e);
            recovery_policies.set(controller.clone(), install);

            let no_signers: Vec<Signer> = Vec::new(e);
            let rule = add_context_rule(
                e,
                &ContextRuleType::CallContract(e.current_contract_address()),
                &String::from_str(e, "zk-recovery"),
                None,
                &no_signers,
                &recovery_policies,
            );

            e.storage().instance().set(&RECOVERY_RULE_ID, &rule.id);
            e.storage()
                .instance()
                .set(&RECOVERY_CONTROLLER, &controller);
        }
    }

    /// The `u32` id of the zero-signer recovery `ContextRule` installed at
    /// construction, or `None` if the account was constructed with
    /// `recovery_controller: None`.
    pub fn recovery_rule_id(e: &Env) -> Option<u32> {
        e.storage().instance().get(&RECOVERY_RULE_ID)
    }

    /// The recovery controller `Address` installed as the recovery rule's
    /// policy at construction, or `None` if the account was constructed with
    /// `recovery_controller: None`.
    pub fn recovery_controller(e: &Env) -> Option<Address> {
        e.storage().instance().get(&RECOVERY_CONTROLLER)
    }

    /// Install a social-recovery rule scoped to calls on this account, gated
    /// by an M-of-N multisig policy.
    ///
    /// Typed wrapper around `add_context_rule` that constructs the policies
    /// map for the caller — the SDK doesn't need to wrestle with the
    /// `Map<Address, Val>` install-param encoding (the generated TS bindings
    /// would otherwise erase the install param to `any`).
    ///
    /// The rule is scoped to `CallContract(self)` so it authorises calls
    /// against the account's own methods (e.g. `add_signer`, `remove_signer`,
    /// `add_context_rule`) — not external transfers.
    ///
    /// # Arguments
    ///
    /// * `name` - Human-readable rule name.
    /// * `valid_until` - Optional expiration ledger sequence.
    /// * `friends` - The signers authorised by the recovery rule.
    /// * `multisig_policy` - Address of the deployed multisig policy contract.
    /// * `threshold` - Number of `friends` signatures required (M).
    #[allow(clippy::needless_pass_by_value)]
    pub fn add_multisig_recovery(
        e: &Env,
        name: String,
        valid_until: Option<u32>,
        friends: Vec<Signer>,
        multisig_policy: Address,
        threshold: u32,
    ) -> ContextRule {
        e.current_contract_address().require_auth();
        let install: Val = SimpleThresholdAccountParams { threshold }.into_val(e);
        let mut policies: Map<Address, Val> = Map::new(e);
        policies.set(multisig_policy, install);
        add_context_rule(
            e,
            &ContextRuleType::CallContract(e.current_contract_address()),
            &name,
            valid_until,
            &friends,
            &policies,
        )
    }
}

#[contractimpl]
impl CustomAccountInterface for NidoSmartAccount {
    type Error = SmartAccountError;
    // OZ v0.7+ replaced the `Signatures` struct with `AuthPayload`
    // (which adds `context_rule_ids` aligned by index with `auth_contexts`).
    type Signature = AuthPayload;

    fn __check_auth(
        e: Env,
        signature_payload: Hash<32>,
        signatures: AuthPayload,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)
    }
}

#[contractimpl]
impl SmartAccount for NidoSmartAccount {
    fn get_context_rule(e: &Env, context_rule_id: u32) -> ContextRule {
        get_context_rule(e, context_rule_id)
    }

    fn get_context_rules_count(e: &Env) -> u32 {
        get_context_rules_count(e)
    }

    fn add_context_rule(
        e: &Env,
        context_type: ContextRuleType,
        name: String,
        valid_until: Option<u32>,
        signers: Vec<Signer>,
        policies: Map<Address, Val>,
    ) -> ContextRule {
        e.current_contract_address().require_auth();
        add_context_rule(e, &context_type, &name, valid_until, &signers, &policies)
    }

    fn update_context_rule_name(e: &Env, context_rule_id: u32, name: String) -> ContextRule {
        e.current_contract_address().require_auth();
        update_context_rule_name(e, context_rule_id, &name)
    }

    fn update_context_rule_valid_until(
        e: &Env,
        context_rule_id: u32,
        valid_until: Option<u32>,
    ) -> ContextRule {
        e.current_contract_address().require_auth();
        update_context_rule_valid_until(e, context_rule_id, valid_until)
    }

    fn remove_context_rule(e: &Env, context_rule_id: u32) {
        e.current_contract_address().require_auth();
        remove_context_rule(e, context_rule_id);
    }

    fn add_signer(e: &Env, context_rule_id: u32, signer: Signer) -> u32 {
        e.current_contract_address().require_auth();
        add_signer(e, context_rule_id, &signer)
    }

    fn remove_signer(e: &Env, context_rule_id: u32, signer_id: u32) {
        e.current_contract_address().require_auth();
        remove_signer(e, context_rule_id, signer_id);
    }

    fn add_policy(e: &Env, context_rule_id: u32, policy: Address, install_param: Val) -> u32 {
        e.current_contract_address().require_auth();
        add_policy(e, context_rule_id, &policy, install_param)
    }

    fn remove_policy(e: &Env, context_rule_id: u32, policy_id: u32) {
        e.current_contract_address().require_auth();
        remove_policy(e, context_rule_id, policy_id);
    }
}

#[contractimpl]
impl ExecutionEntryPoint for NidoSmartAccount {
    fn execute(e: &Env, target: Address, target_fn: Symbol, target_args: Vec<Val>) {
        e.current_contract_address().require_auth();
        e.invoke_contract::<Val>(&target, &target_fn, target_args);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use stellar_accounts::policies::Policy;

    /// Minimal stub implementing OZ's `Policy` for `ZkRecoveryInstallParams`
    /// — stands in for the real `nido-zk-recovery` controller (which needs a
    /// full `RecoveryConfig` deploy) so these constructor-level tests can
    /// register a lightweight in-crate contract instead. Mirrors the real
    /// controller's `install`/`enforce`/`uninstall` auth shape
    /// (`contracts/zk-recovery/src/policy.rs`) but does no bookkeeping.
    #[contract]
    struct StubRecoveryPolicy;

    #[contractimpl]
    impl Policy for StubRecoveryPolicy {
        type AccountParams = ZkRecoveryInstallParams;

        fn install(
            _e: &Env,
            _install_params: Self::AccountParams,
            _context_rule: ContextRule,
            smart_account: Address,
        ) {
            smart_account.require_auth();
        }

        fn enforce(
            _e: &Env,
            _context: Context,
            _authenticated_signers: Vec<Signer>,
            _context_rule: ContextRule,
            smart_account: Address,
        ) {
            smart_account.require_auth();
        }

        fn uninstall(_e: &Env, _context_rule: ContextRule, smart_account: Address) {
            smart_account.require_auth();
        }
    }

    /// A single delegated signer for the Default rule — a rule needs at
    /// least one signer or policy (`SmartAccountError::NoSignersAndPolicies`,
    /// `storage.rs` #3004), so the tests below can't pass an empty vec here
    /// the way the (unrelated) zero-signer recovery rule does.
    fn one_signer(e: &Env) -> Vec<Signer> {
        soroban_sdk::vec![e, Signer::Delegated(Address::generate(e))]
    }

    fn empty_policies(e: &Env) -> Map<Address, Val> {
        Map::new(e)
    }

    /// `Some(controller)`: exactly two context rules exist, the second is
    /// `CallContract(self)` with zero signers and one policy == the
    /// controller, and both view methods return `Some`.
    #[test]
    fn some_controller_installs_recovery_rule() {
        let e = Env::default();
        e.mock_all_auths();

        let controller = e.register(StubRecoveryPolicy, ());
        let account_addr = e.register(
            NidoSmartAccount,
            (one_signer(&e), empty_policies(&e), Some(controller.clone())),
        );

        e.as_contract(&account_addr, || {
            assert_eq!(get_context_rules_count(&e), 2);

            let default_rule = get_context_rule(&e, 0);
            assert_eq!(default_rule.context_type, ContextRuleType::Default);

            let recovery_rule = get_context_rule(&e, 1);
            assert_eq!(
                recovery_rule.context_type,
                ContextRuleType::CallContract(account_addr.clone())
            );
            assert!(recovery_rule.signers.is_empty());
            assert_eq!(recovery_rule.policies.len(), 1);
            assert_eq!(recovery_rule.policies.get(0), Some(controller.clone()));

            assert_eq!(
                NidoSmartAccount::recovery_rule_id(&e),
                Some(recovery_rule.id)
            );
            assert_eq!(
                NidoSmartAccount::recovery_controller(&e),
                Some(controller.clone())
            );
        });
    }

    /// `None`: only the Default rule exists; both view methods return
    /// `None`. Existing (non-recovery) test deploys must be unaffected.
    #[test]
    fn none_skips_recovery_rule() {
        let e = Env::default();
        e.mock_all_auths();

        let account_addr = e.register(
            NidoSmartAccount,
            (one_signer(&e), empty_policies(&e), None::<Address>),
        );

        e.as_contract(&account_addr, || {
            assert_eq!(get_context_rules_count(&e), 1);
            let default_rule = get_context_rule(&e, 0);
            assert_eq!(default_rule.context_type, ContextRuleType::Default);

            assert_eq!(NidoSmartAccount::recovery_rule_id(&e), None);
            assert_eq!(NidoSmartAccount::recovery_controller(&e), None);
        });
    }

    // The deterministic-address invariant (constructor args, including the
    // new `recovery_controller`, must not affect the deployer-derived
    // address) is checked at the factory level — see
    // `contracts/factory/src/contract.rs`'s
    // `get_c_address_unaffected_by_recovery_controller_arg`, which is where
    // the actual deployer/salt/`deploy_v2` machinery this account is
    // deployed through lives.
}
