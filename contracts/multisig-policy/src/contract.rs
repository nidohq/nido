//! Multisig policy contract — thin wrapper around `OpenZeppelin`'s
//! `simple_threshold` library. Stateless per-deployment; per-`(account,
//! rule_id)` threshold lives in the contract's persistent storage as managed
//! by the library.

use soroban_sdk::auth::Context;
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, BytesN, Env, Symbol, Vec,
};
use stellar_accounts::policies::simple_threshold::{self, SimpleThresholdAccountParams};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, Signer};

#[contract]
pub struct MultisigPolicy;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// No upgrade `admin` is stored (a pre-upgradability instance predating
    /// this field; the deployed testnet policy has no admin and is immutable).
    AdminNotSet = 1,
}

#[contractimpl]
impl MultisigPolicy {
    fn key_admin() -> Symbol {
        symbol_short!("admin")
    }

    /// Record the `admin` (mainnet: multisig, ideally behind an upgrade
    /// timelock) authorized to rotate the admin or upgrade this policy (issue
    /// #26). The `enforce`/`install`/`uninstall` paths never read admin, so
    /// per-account policy state and gas are unaffected.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&Self::key_admin(), &admin);
    }

    /// The admin authorized to rotate the admin or upgrade the policy wasm.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin is stored.
    #[allow(clippy::needless_pass_by_value)]
    pub fn admin(e: Env) -> Result<Address, Error> {
        e.storage()
            .instance()
            .get(&Self::key_admin())
            .ok_or(Error::AdminNotSet)
    }

    /// Rotate the admin. Requires the current admin's auth.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin is stored.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_admin(e: Env, new_admin: Address) -> Result<(), Error> {
        Self::admin(e.clone())?.require_auth();
        e.storage().instance().set(&Self::key_admin(), &new_admin);
        Ok(())
    }

    /// Upgrade this policy's wasm to `new_wasm_hash` (an already-installed
    /// wasm hash). Requires admin auth; per-account threshold state survives.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin is stored.
    #[allow(clippy::needless_pass_by_value)]
    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        Self::admin(e.clone())?.require_auth();
        e.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Read the installed M-of-N threshold for a given account + rule.
    /// Returns 0 if not installed.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn get_threshold(e: &Env, context_rule_id: u32, smart_account: Address) -> u32 {
        simple_threshold::get_threshold(e, context_rule_id, &smart_account)
    }
}

#[contractimpl]
impl Policy for MultisigPolicy {
    type AccountParams = SimpleThresholdAccountParams;

    // OZ v0.7+ removed `can_enforce` from the Policy trait; `enforce` is now
    // the only validation step (it panics on threshold-not-met).
    fn enforce(
        e: &Env,
        context: Context,
        authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        simple_threshold::enforce(
            e,
            &context,
            &authenticated_signers,
            &context_rule,
            &smart_account,
        );
    }

    fn install(
        e: &Env,
        install_params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        simple_threshold::install(e, &install_params, &context_rule, &smart_account);
    }

    fn uninstall(e: &Env, context_rule: ContextRule, smart_account: Address) {
        simple_threshold::uninstall(e, &context_rule, &smart_account);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;
    use soroban_sdk::String;
    use stellar_accounts::smart_account::{ContextRuleType, Signer};

    /// Upgradability (issue #26): the constructor stores the `admin`, and
    /// `set_admin` rotates it under the current admin's auth.
    #[test]
    fn admin_is_stored_and_rotatable() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(MultisigPolicy, (admin.clone(),));
        let client = MultisigPolicyClient::new(&env, &id);

        assert_eq!(client.admin(), admin);

        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);
    }

    #[test]
    fn install_stores_threshold_per_account_rule() {
        let env = Env::default();
        let policy_addr = env.register(MultisigPolicy, (Address::generate(&env),));
        let account = Address::generate(&env);
        let rule_id = 7u32;
        let threshold = 2u32;

        env.mock_all_auths();

        // Synthesize a ContextRule (the smart account would pass one in real use).
        // The library validates threshold <= signers.len(), so we need enough signers.
        let mut signers = Vec::new(&env);
        signers.push_back(Signer::Delegated(Address::generate(&env)));
        signers.push_back(Signer::Delegated(Address::generate(&env)));
        signers.push_back(Signer::Delegated(Address::generate(&env)));
        // OZ v0.7 added signer_ids/policy_ids vectors aligned by index with
        // signers/policies. Synthetic IDs are fine — install doesn't read them.
        let mut signer_ids = Vec::new(&env);
        signer_ids.push_back(0u32);
        signer_ids.push_back(1u32);
        signer_ids.push_back(2u32);
        let rule = ContextRule {
            id: rule_id,
            context_type: ContextRuleType::Default,
            name: String::from_str(&env, "test"),
            signers,
            signer_ids,
            policies: Vec::new(&env),
            policy_ids: Vec::new(&env),
            valid_until: None,
        };

        env.as_contract(&policy_addr, || {
            MultisigPolicy::install(
                &env,
                SimpleThresholdAccountParams { threshold },
                rule.clone(),
                account.clone(),
            );
            let stored = MultisigPolicy::get_threshold(&env, rule_id, account);
            assert_eq!(stored, threshold);
        });
    }
}
