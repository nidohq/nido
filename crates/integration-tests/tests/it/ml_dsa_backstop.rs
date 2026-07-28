//! Backstop-rule semantics: an ML-DSA signer enrolled via `add_context_rule`
//! under a `CallContract(self)` rule (no policies) can authorize account
//! administration but is structurally unable to authorize calls to any other
//! contract — OZ matches `CallContract` rules by target contract only, so a
//! self-scoped rule never matches a spend.

use fips204::ml_dsa_65;
use fips204::traits::{KeyGen, SerDes, Signer as FipsSigner};
use nido_integration_tests::{compute_auth_digest, deploy_smart_account, ML_DSA_VERIFIER_WASM};
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
