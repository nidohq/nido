//! Session-key scoping tests for the smart account.
//!
//! A "session key" is modelled as a second passkey added under a
//! `CallContract`-scoped context rule. These tests exercise the context-rule
//! machinery the migration flow relies on for delegated, limited-scope keys:
//! adding a scoped rule, authorizing only within scope, time-based expiry via
//! `valid_until`, and revocation via `remove_context_rule`.

use g2c_integration_tests::{build_contract_assertion, deploy_smart_account, test_key};
use p256::ecdsa::SigningKey;
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::crypto::Hash;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, Bytes, Env, Map, String};
use stellar_accounts::smart_account::{do_check_auth, ContextRuleType, Signatures, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

/// Build a pinned P-256 "session key" and its `External` signer for `verifier`.
/// Seed 2 is distinct from the deployed passkey (seed 1).
fn session_signer(env: &Env, verifier: &Address) -> (SigningKey, Signer) {
    let key = test_key(2);
    let pubkey_sec1 = key.verifying_key().to_sec1_bytes();
    let key_data = Bytes::from_slice(env, &pubkey_sec1);
    let signer = Signer::External(verifier.clone(), key_data);
    (key, signer)
}

/// Construct a `Signatures` map containing a single passkey signature over
/// `payload`, attributed to `signer`.
fn single_signature(
    env: &Env,
    signer: &Signer,
    key: &SigningKey,
    payload: &Hash<32>,
) -> Signatures {
    let assertion = build_contract_assertion(key, env, &payload.to_array());
    let sig_data = WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    };
    let mut sig_map: Map<Signer, Bytes> = Map::new(env);
    sig_map.set(signer.clone(), sig_data.to_xdr(env));
    Signatures(sig_map)
}

/// An auth context for calling `contract`.
fn call_context(env: &Env, contract: &Address) -> Context {
    Context::Contract(ContractContext {
        contract: contract.clone(),
        fn_name: symbol_short!("transfer"),
        args: vec![env],
    })
}

/// Adding a `CallContract`-scoped context rule registers a new rule with the
/// expected type, expiry, and signer, and bumps the rule count.
#[test]
fn add_scoped_context_rule() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);

    let target = Address::generate(&env);
    let (_session_key, session) = session_signer(&env, &verifier_addr);

    assert_eq!(client.get_context_rules_count(), 1);

    let rule = client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &Some(100u32),
        &vec![&env, session.clone()],
        &Map::new(&env),
    );

    assert_eq!(client.get_context_rules_count(), 2);
    assert!(matches!(
        rule.context_type,
        ContextRuleType::CallContract(_)
    ));
    assert_eq!(rule.valid_until, Some(100u32));
    assert_eq!(rule.signers.len(), 1);
    assert_eq!(rule.signers.get(0).unwrap(), session);

    // The scoped rule is retrievable by its type.
    let scoped = client.get_context_rules(&ContextRuleType::CallContract(target));
    assert_eq!(scoped.len(), 1);
    assert_eq!(scoped.get(0).unwrap().id, rule.id);
}

/// A session key scoped to one contract can authorize calls to that contract,
/// even though it is not part of the default rule.
#[test]
fn session_key_authorizes_within_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);

    let target = Address::generate(&env);
    let (session_key, session) = session_signer(&env, &verifier_addr);

    client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &None,
        &vec![&env, session.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x11; 32]));
    let signatures = single_signature(&env, &session, &session_key, &hash);

    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, call_context(&env, &target)],
        )
        .unwrap();
    });
}

/// The same session-key-only signature is rejected for a contract outside the
/// rule's scope — there only the default (passkey) rule applies.
#[test]
fn session_key_rejected_outside_scope() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);

    let target = Address::generate(&env);
    let other = Address::generate(&env);
    let (session_key, session) = session_signer(&env, &verifier_addr);

    client.add_context_rule(
        &ContextRuleType::CallContract(target),
        &String::from_str(&env, "session"),
        &None,
        &vec![&env, session.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x22; 32]));
    let signatures = single_signature(&env, &session, &session_key, &hash);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, call_context(&env, &other)],
            )
            .unwrap();
        });
    }));

    assert!(
        result.is_err(),
        "session key must not authorize a contract outside its scope"
    );
}

/// A scoped session key authorizes calls before `valid_until`, but is rejected
/// once the ledger advances past expiry.
#[test]
fn expired_session_key_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);

    let target = Address::generate(&env);
    let (session_key, session) = session_signer(&env, &verifier_addr);

    client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &Some(100u32),
        &vec![&env, session.clone()],
        &Map::new(&env),
    );

    // Before expiry (ledger 50 < valid_until 100): authorized.
    env.ledger().set_sequence_number(50);
    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x33; 32]));
    let signatures = single_signature(&env, &session, &session_key, &hash);
    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, call_context(&env, &target)],
        )
        .unwrap();
    });

    // After expiry (ledger 101 > valid_until 100): the scoped rule is skipped,
    // leaving only the default rule, which the session key cannot satisfy.
    env.ledger().set_sequence_number(101);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, call_context(&env, &target)],
            )
            .unwrap();
        });
    }));

    assert!(result.is_err(), "expired session key must be rejected");
}

/// Removing the scoped context rule revokes the session key: a previously valid
/// session-key signature is rejected afterwards.
#[test]
fn removed_session_key_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, verifier_addr, _passkey) = deploy_smart_account(&env);

    let target = Address::generate(&env);
    let (session_key, session) = session_signer(&env, &verifier_addr);

    let rule = client.add_context_rule(
        &ContextRuleType::CallContract(target.clone()),
        &String::from_str(&env, "session"),
        &None,
        &vec![&env, session.clone()],
        &Map::new(&env),
    );

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x44; 32]));
    let signatures = single_signature(&env, &session, &session_key, &hash);

    // Sanity check: authorized while the rule exists.
    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, call_context(&env, &target)],
        )
        .unwrap();
    });

    client.remove_context_rule(&rule.id);
    assert_eq!(client.get_context_rules_count(), 1);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, call_context(&env, &target)],
            )
            .unwrap();
        });
    }));

    assert!(
        result.is_err(),
        "removed session key must no longer authorize calls"
    );
}
