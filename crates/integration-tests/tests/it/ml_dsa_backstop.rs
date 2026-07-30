//! Backstop-rule semantics: an ML-DSA signer enrolled via `add_context_rule`
//! under a `CallContract(self)` rule (no policies) can authorize account
//! administration but is structurally unable to authorize calls to any other
//! contract — OZ matches `CallContract` rules by target contract only, so a
//! self-scoped rule never matches a spend.

use fips204::ml_dsa_65;
use fips204::traits::{KeyGen, SerDes, Signer as FipsSigner};
use nido_integration_tests::{
    build_contract_assertion, compute_auth_digest, deploy_smart_account, test_key,
    ML_DSA_VERIFIER_WASM,
};
use nido_ml_dsa_verifier::contract::{MlDsaSigData, PK_LEN, SIG_CONTEXT};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, Bytes, Env, Map, String, Symbol};
use stellar_accounts::smart_account::{do_check_auth, AuthPayload, ContextRuleType, Signer};

/// Deterministic ML-DSA-65 keypair (same convention as `ml_dsa_verifier.rs` —
/// helpers are file-private there, duplicated per the repo's test convention).
fn ml_dsa_test_key(seed: u8) -> (ml_dsa_65::PublicKey, ml_dsa_65::PrivateKey) {
    ml_dsa_65::KG::keygen_from_seed(&[seed; 32])
}

fn key_commitment(env: &Env, pk_bytes: &[u8; PK_LEN]) -> Bytes {
    env.crypto()
        .sha256(&Bytes::from_slice(env, pk_bytes))
        .to_bytes()
        .into()
}

fn build_ml_dsa_sig_data(
    env: &Env,
    sk: &ml_dsa_65::PrivateKey,
    pk_bytes: &[u8; PK_LEN],
    digest: &[u8; 32],
) -> Bytes {
    let signature = sk.try_sign(digest, SIG_CONTEXT).expect("ML-DSA signing");
    MlDsaSigData {
        public_key: Bytes::from_slice(env, pk_bytes),
        signature: Bytes::from_slice(env, &signature),
    }
    .to_xdr(env)
}

/// Deploy a passkey account (Default rule id 0), then enroll an ML-DSA
/// backstop via `add_context_rule` exactly as the frontend does:
/// `CallContract(self)`, one External signer, no policies → rule id 1.
fn setup_backstop(env: &Env) -> (Address, Signer, ml_dsa_65::PrivateKey, [u8; PK_LEN]) {
    env.mock_all_auths();
    let (client, account_addr, _webauthn_addr, _passkey) = deploy_smart_account(env);
    let ml_dsa_addr = env.register(ML_DSA_VERIFIER_WASM, ());
    let (pk, sk) = ml_dsa_test_key(7);
    let pk_bytes = pk.into_bytes();
    let signer = Signer::External(ml_dsa_addr, key_commitment(env, &pk_bytes));

    client.add_context_rule(
        &ContextRuleType::CallContract(account_addr.clone()),
        &String::from_str(env, "pq-backstop"),
        &None,
        &vec![env, signer.clone()],
        &Map::new(env),
    );
    (account_addr, signer, sk, pk_bytes)
}

/// Auth payload authorizing via the backstop rule (id 1).
fn ml_dsa_auth(
    env: &Env,
    signer: &Signer,
    sk: &ml_dsa_65::PrivateKey,
    pk_bytes: &[u8; PK_LEN],
    hash: &soroban_sdk::crypto::Hash<32>,
) -> AuthPayload {
    let context_rule_ids = vec![env, 1u32];
    let auth_digest = compute_auth_digest(env, hash, &context_rule_ids);
    let sig_data = build_ml_dsa_sig_data(env, sk, pk_bytes, &auth_digest);
    let mut signers: Map<Signer, Bytes> = Map::new(env);
    signers.set(signer.clone(), sig_data);
    AuthPayload {
        signers,
        context_rule_ids,
    }
}

/// (a) The backstop CAN authorize self-administration: a call to the
/// account's own `add_signer`.
#[test]
fn backstop_authorizes_self_administration() {
    let env = Env::default();
    let (account_addr, signer, sk, pk_bytes) = setup_backstop(&env);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x21; 32]));
    let signatures = ml_dsa_auth(&env, &signer, &sk, &pk_bytes, &hash);

    let context = Context::Contract(ContractContext {
        contract: account_addr.clone(),
        fn_name: Symbol::new(&env, "add_signer"),
        args: vec![&env],
    });

    env.as_contract(&account_addr, || {
        do_check_auth(&env, &hash, &signatures, &vec![&env, context]).unwrap();
    });
}

/// (b) The backstop CANNOT authorize a call to any other contract — the
/// self-scoped rule doesn't match, so `do_check_auth` panics
/// (`UnvalidatedContext`) even though the ML-DSA signature itself is valid.
#[test]
fn backstop_cannot_authorize_spend() {
    let env = Env::default();
    let (account_addr, signer, sk, pk_bytes) = setup_backstop(&env);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x22; 32]));
    let signatures = ml_dsa_auth(&env, &signer, &sk, &pk_bytes, &hash);

    // A transfer on some other contract (e.g. the XLM SAC).
    let context = Context::Contract(ContractContext {
        contract: Address::generate(&env),
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
        "self-scoped backstop rule must not authorize calls to other contracts"
    );
}

/// Rotation drill end-state: a replacement passkey installed as a SECOND
/// Default rule (the "recovered" pattern — Default rules coexist and act as
/// OR because the `AuthPayload` names its rule id) fully controls the
/// account, and after `remove_context_rule(0)` the old passkey's rule is
/// gone. Pins the exact sequence the frontend's recovery drill submits with
/// ML-DSA-authorized transactions.
#[test]
fn rotation_installs_second_default_rule_and_retires_rule_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, webauthn_addr, old_passkey) = deploy_smart_account(&env);

    // Backstop enrolled as rule 1 (parity with the frontend's state; the
    // ML-DSA auth for these mutations is proven by
    // backstop_authorizes_self_administration — mock_all_auths here).
    let ml_dsa_addr = env.register(ML_DSA_VERIFIER_WASM, ());
    let (ml_pk, _ml_sk) = ml_dsa_test_key(7);
    client.add_context_rule(
        &ContextRuleType::CallContract(account_addr.clone()),
        &String::from_str(&env, "pq-backstop"),
        &None,
        &vec![
            &env,
            Signer::External(ml_dsa_addr, key_commitment(&env, &ml_pk.into_bytes())),
        ],
        &Map::new(&env),
    );

    // Replacement passkey as a fresh Default rule ("recovered").
    let new_key = test_key(5);
    let new_pub = Bytes::from_slice(&env, &new_key.verifying_key().to_sec1_bytes());
    let recovered = client.add_context_rule(
        &ContextRuleType::Default,
        &String::from_str(&env, "recovered"),
        &None,
        &vec![
            &env,
            Signer::External(webauthn_addr.clone(), new_pub.clone()),
        ],
        &Map::new(&env),
    );

    // The new passkey authorizes an arbitrary call under its own rule id.
    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x31; 32]));
    let context_rule_ids = vec![&env, recovered.id];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    let assertion = build_contract_assertion(&new_key, &env, &auth_digest);
    let sig_data = stellar_accounts::verifiers::webauthn::WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    }
    .to_xdr(&env);
    let mut signers: Map<Signer, Bytes> = Map::new(&env);
    signers.set(Signer::External(webauthn_addr.clone(), new_pub), sig_data);
    let signatures = AuthPayload {
        signers,
        context_rule_ids,
    };
    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, transfer_context(&env)],
        )
        .unwrap();
    });

    // Retire the old passkey's rule; authorizing via rule 0 now fails even
    // with a valid old-passkey assertion.
    client.remove_context_rule(&0u32);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x32; 32]));
    let context_rule_ids = vec![&env, 0u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    let assertion = build_contract_assertion(&old_passkey, &env, &auth_digest);
    let sig_data = stellar_accounts::verifiers::webauthn::WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    }
    .to_xdr(&env);
    let old_pub = Bytes::from_slice(&env, &old_passkey.verifying_key().to_sec1_bytes());
    let mut signers: Map<Signer, Bytes> = Map::new(&env);
    signers.set(Signer::External(webauthn_addr, old_pub), sig_data);
    let signatures = AuthPayload {
        signers,
        context_rule_ids,
    };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&account_addr, || {
            do_check_auth(
                &env,
                &hash,
                &signatures,
                &vec![&env, transfer_context(&env)],
            )
            .unwrap();
        });
    }));
    assert!(
        result.is_err(),
        "the retired rule 0 must no longer authorize"
    );
}

fn transfer_context(env: &Env) -> Context {
    Context::Contract(ContractContext {
        contract: Address::generate(env),
        fn_name: symbol_short!("transfer"),
        args: vec![env],
    })
}

/// Paranoid (hybrid 2-of-2) enforced end-state: a Default rule holding
/// [passkey, ML-DSA] with rule 0 removed requires BOTH signatures over the
/// same digest for ANY call — either signature alone is rejected. Pins the
/// arm→enforce sequence the frontend's paranoid mode submits.
#[test]
#[allow(clippy::similar_names)]
fn paranoid_enforced_requires_both_signatures() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, account_addr, webauthn_addr, passkey) = deploy_smart_account(&env);

    let ml_dsa_addr = env.register(ML_DSA_VERIFIER_WASM, ());
    let (ml_pk, ml_sk) = ml_dsa_test_key(7);
    let ml_pk_bytes = ml_pk.into_bytes();
    let passkey_pub = Bytes::from_slice(&env, &passkey.verifying_key().to_sec1_bytes());
    let passkey_signer = Signer::External(webauthn_addr.clone(), passkey_pub);
    let ml_dsa_signer = Signer::External(ml_dsa_addr, key_commitment(&env, &ml_pk_bytes));

    // ARM: hybrid Default rule; ENFORCE: retire the passkey-only rule 0.
    let hybrid = client.add_context_rule(
        &ContextRuleType::Default,
        &String::from_str(&env, "paranoid"),
        &None,
        &vec![&env, passkey_signer.clone(), ml_dsa_signer.clone()],
        &Map::new(&env),
    );
    client.remove_context_rule(&0u32);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x41; 32]));
    let context_rule_ids = vec![&env, hybrid.id];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);

    let assertion = build_contract_assertion(&passkey, &env, &auth_digest);
    let webauthn_sig = stellar_accounts::verifiers::webauthn::WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    }
    .to_xdr(&env);
    let ml_dsa_sig = build_ml_dsa_sig_data(&env, &ml_sk, &ml_pk_bytes, &auth_digest);

    // Both signatures → authorized.
    let mut both: Map<Signer, Bytes> = Map::new(&env);
    both.set(passkey_signer.clone(), webauthn_sig.clone());
    both.set(ml_dsa_signer.clone(), ml_dsa_sig.clone());
    let signatures = AuthPayload {
        signers: both,
        context_rule_ids: context_rule_ids.clone(),
    };
    env.as_contract(&account_addr, || {
        do_check_auth(
            &env,
            &hash,
            &signatures,
            &vec![&env, transfer_context(&env)],
        )
        .unwrap();
    });

    // Either signature alone → rejected (strict AND).
    for (label, signer, sig) in [
        ("passkey alone", &passkey_signer, &webauthn_sig),
        ("ML-DSA alone", &ml_dsa_signer, &ml_dsa_sig),
    ] {
        let mut solo: Map<Signer, Bytes> = Map::new(&env);
        solo.set(signer.clone(), sig.clone());
        let signatures = AuthPayload {
            signers: solo,
            context_rule_ids: context_rule_ids.clone(),
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.as_contract(&account_addr, || {
                do_check_auth(
                    &env,
                    &hash,
                    &signatures,
                    &vec![&env, transfer_context(&env)],
                )
                .unwrap();
            });
        }));
        assert!(result.is_err(), "{label} must not satisfy the hybrid rule");
    }
}

/// (c) The enrollment itself requires the account's auth: without
/// `mock_all_auths`, `add_context_rule` is rejected.
#[test]
fn enrollment_requires_account_auth() {
    let env = Env::default();
    let (client, account_addr, _webauthn_addr, _passkey) = deploy_smart_account(&env);
    let ml_dsa_addr = env.register(ML_DSA_VERIFIER_WASM, ());
    let (pk, _sk) = ml_dsa_test_key(9);
    let signer = Signer::External(ml_dsa_addr, key_commitment(&env, &pk.into_bytes()));

    let result = client.try_add_context_rule(
        &ContextRuleType::CallContract(account_addr.clone()),
        &String::from_str(&env, "pq-backstop"),
        &None,
        &vec![&env, signer],
        &Map::new(&env),
    );
    assert!(
        result.is_err(),
        "add_context_rule without account auth must fail"
    );
}
