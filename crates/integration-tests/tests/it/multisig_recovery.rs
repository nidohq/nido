//! Social-recovery integration tests.
//!
//! Builds the same `add_context_rule` invocation the SDK's
//! `multisigRecovery.buildInstall` produces, then exercises:
//!   - threshold-not-met rejection,
//!   - successful rotation when M friends sign,
//!   - scope enforcement: same M signatures cannot move funds.

use g2c_integration_tests::{
    build_contract_assertion, compute_auth_digest, deploy_multisig_policy, deploy_smart_account,
    multisig_install_map, test_key,
};
use p256::ecdsa::SigningKey;
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, Bytes, Env, Map, String, Symbol};
use stellar_accounts::smart_account::{do_check_auth, AuthPayload, ContextRuleType, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

fn external_signer(env: &Env, verifier: &Address, key: &SigningKey) -> Signer {
    let pubkey = key.verifying_key().to_sec1_bytes();
    Signer::External(verifier.clone(), Bytes::from_slice(env, &pubkey))
}

/// Build a (signer, sig_data) pair signing the given pre-computed auth digest.
/// Use `compute_auth_digest(env, hash, &context_rule_ids)` to get the digest.
fn signature_for(
    env: &Env,
    signer: &Signer,
    key: &SigningKey,
    auth_digest: &[u8; 32],
) -> (Signer, Bytes) {
    let a = build_contract_assertion(key, env, auth_digest);
    let sd = WebAuthnSigData {
        signature: a.signature,
        authenticator_data: a.authenticator_data,
        client_data: a.client_data,
    };
    (signer.clone(), sd.to_xdr(env))
}

fn install_two_of_three_recovery(
    env: &Env,
    client: &g2c_integration_tests::SmartAccountClient<'_>,
    account_addr: &Address,
    verifier: &Address,
    friend_keys: [&SigningKey; 3],
) -> (Signer, Signer, Signer, Address) {
    env.mock_all_auths();
    let policy_addr = deploy_multisig_policy(env);
    let s1 = external_signer(env, verifier, friend_keys[0]);
    let s2 = external_signer(env, verifier, friend_keys[1]);
    let s3 = external_signer(env, verifier, friend_keys[2]);

    client.add_context_rule(
        &ContextRuleType::CallContract(account_addr.clone()),
        &String::from_str(env, "recovery"),
        &None,
        &vec![env, s1.clone(), s2.clone(), s3.clone()],
        &multisig_install_map(env, &policy_addr, 2u32),
    );
    (s1, s2, s3, policy_addr)
}

#[test]
fn one_friend_signature_is_rejected() {
    let env = Env::default();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let f1 = test_key(2);
    let f2 = test_key(3);
    let f3 = test_key(4);
    let (s1, _s2, _s3, _policy) = install_two_of_three_recovery(
        &env,
        &client,
        &account_addr,
        &verifier_addr,
        [&f1, &f2, &f3],
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xA1; 32]));
    let context_rule_ids = vec![&env, 1u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    // Only one friend signs; threshold is 2.
    let mut sig_map: Map<Signer, Bytes> = Map::new(&env);
    let (signer, sig) = signature_for(&env, &s1, &f1, &auth_digest);
    sig_map.set(signer, sig);
    let signatures = AuthPayload {
        signers: sig_map,
        context_rule_ids,
    };

    // Auth context: call self (the recovery scope).
    let context = Context::Contract(ContractContext {
        contract: account_addr.clone(),
        fn_name: Symbol::new(&env, "add_signer"),
        args: vec![&env],
    });

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(&env, &hash, &signatures, &vec![&env, context]).unwrap();
        });
    }));
    assert!(
        result.is_err(),
        "one signature must not satisfy 2-of-3 threshold"
    );
}

#[test]
fn two_friend_signatures_pass_for_self_scope() {
    let env = Env::default();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let f1 = test_key(2);
    let f2 = test_key(3);
    let f3 = test_key(4);
    let (s1, s2, _s3, _policy) = install_two_of_three_recovery(
        &env,
        &client,
        &account_addr,
        &verifier_addr,
        [&f1, &f2, &f3],
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xB2; 32]));
    let context_rule_ids = vec![&env, 1u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    let mut sig_map: Map<Signer, Bytes> = Map::new(&env);
    let (signer1, sig1) = signature_for(&env, &s1, &f1, &auth_digest);
    let (signer2, sig2) = signature_for(&env, &s2, &f2, &auth_digest);
    sig_map.set(signer1, sig1);
    sig_map.set(signer2, sig2);
    let signatures = AuthPayload {
        signers: sig_map,
        context_rule_ids,
    };

    let context = Context::Contract(ContractContext {
        contract: account_addr.clone(),
        fn_name: Symbol::new(&env, "add_signer"),
        args: vec![&env],
    });

    env.as_contract(&account_addr, || {
        do_check_auth(&env, &hash, &signatures, &vec![&env, context]).unwrap();
    });
}

#[test]
fn two_friend_signatures_rejected_for_other_contract() {
    let env = Env::default();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let f1 = test_key(2);
    let f2 = test_key(3);
    let f3 = test_key(4);
    let (s1, s2, _s3, _policy) = install_two_of_three_recovery(
        &env,
        &client,
        &account_addr,
        &verifier_addr,
        [&f1, &f2, &f3],
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xC3; 32]));
    let context_rule_ids = vec![&env, 1u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    let mut sig_map: Map<Signer, Bytes> = Map::new(&env);
    let (signer1, sig1) = signature_for(&env, &s1, &f1, &auth_digest);
    let (signer2, sig2) = signature_for(&env, &s2, &f2, &auth_digest);
    sig_map.set(signer1, sig1);
    sig_map.set(signer2, sig2);
    let signatures = AuthPayload {
        signers: sig_map,
        context_rule_ids,
    };

    // Auth context: call a DIFFERENT contract (a synthetic token transfer).
    let other = Address::generate(&env);
    let context = Context::Contract(ContractContext {
        contract: other,
        fn_name: symbol_short!("transfer"),
        args: vec![&env],
    });

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(&env, &hash, &signatures, &vec![&env, context]).unwrap();
        });
    }));
    assert!(
        result.is_err(),
        "recovery rule must not authorize calls outside CallContract(self)"
    );
}
