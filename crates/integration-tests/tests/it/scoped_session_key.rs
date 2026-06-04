//! Scoped session-key integration tests. Builds the same context-rule
//! invocation `scopedSessionKey.buildInstall` produces in the SDK and
//! verifies the in-scope / out-of-scope / expired / revoked paths.

use g2c_integration_tests::{
    build_contract_assertion, compute_auth_digest, deploy_smart_account, test_key,
};
use p256::ecdsa::SigningKey;
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, Bytes, Env, Map, String};
use stellar_accounts::smart_account::{do_check_auth, AuthPayload, ContextRuleType, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

fn session_signer(env: &Env, verifier: &Address) -> (SigningKey, Signer) {
    let key = test_key(2);
    let pubkey = key.verifying_key().to_sec1_bytes();
    (
        key,
        Signer::External(verifier.clone(), Bytes::from_slice(env, &pubkey)),
    )
}

/// Sign the auth digest (sha256(payload || context_rule_ids.to_xdr())) with the
/// session key. All four tests use rule id 1 (default=0, session-key=1).
fn one_sig(
    env: &Env,
    signer: &Signer,
    key: &SigningKey,
    payload: &soroban_sdk::crypto::Hash<32>,
) -> AuthPayload {
    let context_rule_ids = vec![env, 1u32];
    let auth_digest = compute_auth_digest(env, payload, &context_rule_ids);
    let a = build_contract_assertion(key, env, &auth_digest);
    let sd = WebAuthnSigData {
        signature: a.signature,
        authenticator_data: a.authenticator_data,
        client_data: a.client_data,
    };
    let mut m: Map<Signer, Bytes> = Map::new(env);
    m.set(signer.clone(), sd.to_xdr(env));
    AuthPayload {
        signers: m,
        context_rule_ids,
    }
}

fn context_for(env: &Env, contract: &Address) -> Context {
    Context::Contract(ContractContext {
        contract: contract.clone(),
        fn_name: symbol_short!("transfer"),
        args: vec![env],
    })
}

#[test]
fn session_key_authorizes_target_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let target = Address::generate(&env);
    let (key, signer) = session_signer(&env, &verifier_addr);

    client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &None,
        &vec![&env, signer.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x11; 32]));
    let signatures = one_sig(&env, &signer, &key, &hash);
    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, context_for(&env, &target)],
        )
        .unwrap();
    });
}

#[test]
fn session_key_rejected_for_other_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let target = Address::generate(&env);
    let other = Address::generate(&env);
    let (key, signer) = session_signer(&env, &verifier_addr);

    client.add_context_rule(
        &ContextRuleType::CallContract(target),
        &String::from_str(&env, "session"),
        &None,
        &vec![&env, signer.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x22; 32]));
    let signatures = one_sig(&env, &signer, &key, &hash);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, context_for(&env, &other)],
            )
            .unwrap();
        });
    }));
    assert!(result.is_err());
}

#[test]
fn session_key_rejected_after_valid_until() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let target = Address::generate(&env);
    let (key, signer) = session_signer(&env, &verifier_addr);

    client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &Some(100u32),
        &vec![&env, signer.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x33; 32]));
    let signatures = one_sig(&env, &signer, &key, &hash);

    env.ledger().set_sequence_number(50);
    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, context_for(&env, &target)],
        )
        .unwrap();
    });

    env.ledger().set_sequence_number(101);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, context_for(&env, &target)],
            )
            .unwrap();
        });
    }));
    assert!(result.is_err());
}

#[test]
fn session_key_rejected_after_revoke() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);
    let target = Address::generate(&env);
    let (key, signer) = session_signer(&env, &verifier_addr);

    let rule = client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &None,
        &vec![&env, signer.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x44; 32]));
    let signatures = one_sig(&env, &signer, &key, &hash);

    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, context_for(&env, &target)],
        )
        .unwrap();
    });

    client.remove_context_rule(&rule.id);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, context_for(&env, &target)],
            )
            .unwrap();
        });
    }));
    assert!(result.is_err());
}
