//! Feasibility spike: zero-signer `AuthPayload` policy-completion path
//! (OZ `stellar-accounts` git rev 637c53a).
//!
//! **Claim under test:** a smart account can authorize a self-modifying call
//! (`add_context_rule`) via an `AuthPayload` whose `signers` map is EMPTY,
//! where authorization comes solely from a `Policy` attached to a
//! zero-signer `ContextRule` scoped to `ContextRuleType::CallContract(self)`.
//!
//! This is the mechanism the ZK-recovery design needs for
//! `complete_recovery`: after the timelock, no passkey signs — the recovery
//! controller (represented here by a stub policy) permits the key-rotation
//! call directly via its `enforce` hook. This spike replaces the real
//! recovery controller with two stub policies (`SpikePolicy` — always
//! permit, `DenyPolicy` — always deny) to isolate OZ's zero-signer +
//! policy authorization mechanics from any recovery-controller logic.
//!
//! ## Source reading that motivates this shape (storage.rs, OZ 637c53a)
//!
//! `get_validated_context_by_id` (storage.rs:272-325):
//! ```text
//! if policies.is_empty() {
//!     // Without policies, all rule signers must be matched.
//!     if rule_signers.len() != matched_signers.len() {
//!         panic_with_error!(e, SmartAccountError::UnvalidatedContext);
//!     }
//! }
//! // With policies, defer full validation to enforce().
//! ```
//! A rule with zero signers and one policy has `matched_signers.len() == 0
//! == rule_signers.len()`, so this check passes trivially regardless of the
//! `policies.is_empty()` branch — but critically, the shown branch means
//! that whenever a rule DOES have policies, per-signer matching is not
//! required at all; enforcement is fully delegated to `enforce()`.
//!
//! `validate_signers_and_policies` (storage.rs:377-391) only rejects a rule
//! when BOTH `signer_ids` and `policy_ids` are empty
//! (`SmartAccountError::NoSignersAndPolicies`) — so zero signers + one
//! policy is an accepted rule shape at `add_context_rule` time.
//!
//! `do_check_auth` (storage.rs:462-520) iterates
//! `signatures.signers.iter()` to authenticate (an empty map iterates zero
//! times, so no signature-related panics occur), then unconditionally
//! calls `PolicyClient::enforce` for every policy on every validated rule
//! — so an empty-signers `AuthPayload` reaches `enforce` as long as the
//! referenced rule's context type matches.

// The `#[contractimpl]` macro's generated invoke-wrapper binds each method
// param to a same-named local before forwarding to the impl below, which
// counts as a "use" of every `_`-prefixed param outside any scope a
// function-level `#[allow]` can reach. Every lint in this module (all 18)
// is this same macro-generated false positive on the two stub policies'
// unused `Policy` trait params below, so the allow is module-scoped rather
// than repeated per method.
#![allow(clippy::used_underscore_binding)]

use nido_integration_tests::{compute_auth_digest, deploy_smart_account, SmartAccountClient};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::{
    contract, contractimpl, vec, Address, Bytes, Env, IntoVal, Map, String, Symbol, Val, Vec,
};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{
    do_check_auth, AuthPayload, ContextRule, ContextRuleType, Signer,
};

/// Stub always-permit policy. Mirrors `contracts/multisig-policy/src/contract.rs`
/// structurally (`enforce`/`install`/`uninstall`), but `enforce` only
/// requires the smart account's own authorization and otherwise permits
/// unconditionally. Stands in for the real recovery controller, which is
/// out of scope for this spike.
#[contract]
pub struct SpikePolicy;

#[contractimpl]
impl Policy for SpikePolicy {
    type AccountParams = u32;

    fn enforce(
        _e: &Env,
        _context: Context,
        _authenticated_signers: Vec<Signer>,
        _context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
    }

    fn install(
        _e: &Env,
        _install_params: Self::AccountParams,
        _context_rule: ContextRule,
        _smart_account: Address,
    ) {
        // No installation state; the spike policy is stateless.
    }

    fn uninstall(_e: &Env, _context_rule: ContextRule, _smart_account: Address) {
        // No cleanup required.
    }
}

/// Sibling stub policy that always DENIES (`enforce` panics
/// unconditionally). Used in the negative test to prove that
/// `do_check_auth` actually routes through `enforce` for the zero-signer
/// path — i.e. that the positive test's pass is not vacuous.
#[contract]
pub struct DenyPolicy;

#[contractimpl]
impl Policy for DenyPolicy {
    type AccountParams = u32;

    fn enforce(
        _e: &Env,
        _context: Context,
        _authenticated_signers: Vec<Signer>,
        _context_rule: ContextRule,
        _smart_account: Address,
    ) {
        panic!("DenyPolicy always denies");
    }

    fn install(
        _e: &Env,
        _install_params: Self::AccountParams,
        _context_rule: ContextRule,
        _smart_account: Address,
    ) {
    }

    fn uninstall(_e: &Env, _context_rule: ContextRule, _smart_account: Address) {}
}

/// Install a `CallContract(self)` rule with zero signers and a single
/// policy (`policy_addr`), mirroring the shape `complete_recovery` would
/// need. Returns the new rule's ID.
fn install_zero_signer_policy_rule(
    env: &Env,
    client: &SmartAccountClient<'_>,
    account_addr: &Address,
    policy_addr: &Address,
) -> u32 {
    env.mock_all_auths();
    let mut policies: Map<Address, Val> = Map::new(env);
    policies.set(policy_addr.clone(), 0u32.into_val(env));
    let rule = client.add_context_rule(
        &ContextRuleType::CallContract(account_addr.clone()),
        &String::from_str(env, "zk-completion"),
        &None,
        &vec![env], // zero signers — authorization comes solely from the policy
        &policies,
    );
    rule.id
}

/// Build the `Context::Contract` for the self-modifying `add_context_rule`
/// call being authorized. `fn_name`/`args` are not inspected by
/// `get_validated_context_by_id` (only `contract` is, to derive the
/// required `ContextRuleType::CallContract`), so an empty `args` vec is
/// sufficient here — mirrors `multisig_recovery.rs`.
fn add_context_rule_context(env: &Env, account_addr: &Address) -> Context {
    Context::Contract(ContractContext {
        contract: account_addr.clone(),
        fn_name: Symbol::new(env, "add_context_rule"),
        args: vec![env],
    })
}

#[test]
fn zero_signer_policy_completion() {
    let env = Env::default();
    let (client, account_addr, _verifier_addr, _passkey) = deploy_smart_account(&env);
    let policy_addr = env.register(SpikePolicy, ());
    let rule_id = install_zero_signer_policy_rule(&env, &client, &account_addr, &policy_addr);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xD4; 32]));
    let context_rule_ids = vec![&env, rule_id];
    // No signers to authenticate, but keep parity with the real digest
    // binding scheme in case future revisions of the design start checking it.
    let _auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);

    let empty_signer_payload = AuthPayload {
        signers: Map::new(&env),
        context_rule_ids,
    };

    let context = add_context_rule_context(&env, &account_addr);

    env.mock_all_auths();
    env.as_contract(&account_addr, || {
        let res = do_check_auth(&env, &hash, &empty_signer_payload, &vec![&env, context]);
        assert!(
            res.is_ok(),
            "zero-signer policy rule must authorize via enforce: {res:?}"
        );
    });
}

#[test]
fn zero_signer_policy_deny_blocks_completion() {
    let env = Env::default();
    let (client, account_addr, _verifier_addr, _passkey) = deploy_smart_account(&env);
    let policy_addr = env.register(DenyPolicy, ());
    let rule_id = install_zero_signer_policy_rule(&env, &client, &account_addr, &policy_addr);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xE5; 32]));
    let context_rule_ids = vec![&env, rule_id];

    let empty_signer_payload = AuthPayload {
        signers: Map::new(&env),
        context_rule_ids,
    };

    let context = add_context_rule_context(&env, &account_addr);

    env.mock_all_auths();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(&env, &hash, &empty_signer_payload, &vec![&env, context]).unwrap();
        });
    }));
    assert!(
        result.is_err(),
        "deny policy must block zero-signer completion (proves the policy actually gates)"
    );
}
