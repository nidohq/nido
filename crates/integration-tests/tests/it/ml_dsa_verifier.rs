//! Post-quantum (ML-DSA-65) signer integration tests: the guest-wasm
//! `nido-ml-dsa-verifier` plugged into the smart account's `do_check_auth`
//! exactly like the `WebAuthn` verifier — plus the hybrid strict-AND rule
//! (passkey + ML-DSA) that motivates it as a quantum-emergency backstop.

use fips204::ml_dsa_65;
use fips204::traits::{KeyGen, SerDes, Signer as FipsSigner};
use nido_integration_tests::{
    build_contract_assertion, compute_auth_digest, ML_DSA_VERIFIER_WASM, SMART_ACCOUNT_WASM,
    WEBAUTHN_VERIFIER_WASM,
};
use nido_ml_dsa_verifier::contract::{MlDsaSigData, MlDsaVerifierClient, PK_LEN, SIG_CONTEXT};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, Bytes, Env, Map, Val, Vec};
use stellar_accounts::smart_account::{do_check_auth, AuthPayload, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

/// Deterministic ML-DSA-65 keypair from a one-byte seed (mirrors
/// `test_key(seed)` for P-256).
fn ml_dsa_test_key(seed: u8) -> (ml_dsa_65::PublicKey, ml_dsa_65::PrivateKey) {
    ml_dsa_65::KG::keygen_from_seed(&[seed; 32])
}

/// The signer's on-chain `key_data`: 32-byte SHA-256 commitment to the
/// encoded public key.
fn key_commitment(env: &Env, pk_bytes: &[u8; PK_LEN]) -> Bytes {
    env.crypto()
        .sha256(&Bytes::from_slice(env, pk_bytes))
        .to_bytes()
        .into()
}

/// Sign `digest` with the domain-separation context the verifier enforces and
/// XDR-encode the `MlDsaSigData` payload.
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

/// Deploy the ML-DSA verifier and a smart account whose Default rule holds a
/// single ML-DSA signer.
fn deploy_ml_dsa_account(
    env: &Env,
) -> (
    Address,
    Address,
    ml_dsa_65::PublicKey,
    ml_dsa_65::PrivateKey,
) {
    let verifier_addr = env.register(ML_DSA_VERIFIER_WASM, ());
    let (pk, sk) = ml_dsa_test_key(7);
    let signer = Signer::External(
        verifier_addr.clone(),
        key_commitment(env, &pk.clone().into_bytes()),
    );

    let signers = vec![env, signer];
    let policies: Map<Address, Val> = Map::new(env);
    let account_addr = env.register(SMART_ACCOUNT_WASM, (&signers, &policies, None::<Address>));
    (account_addr, verifier_addr, pk, sk)
}

fn transfer_context(env: &Env) -> Context {
    Context::Contract(ContractContext {
        contract: Address::generate(env),
        fn_name: symbol_short!("transfer"),
        args: vec![env],
    })
}

/// Full `__check_auth` flow with an ML-DSA signer on the Default rule.
#[test]
fn smart_account_check_auth_with_ml_dsa_signer() {
    let env = Env::default();
    let (account_addr, verifier_addr, pk, sk) = deploy_ml_dsa_account(&env);
    let pk_bytes = pk.into_bytes();

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xAB; 32]));
    let context_rule_ids = vec![&env, 0u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    let sig_data = build_ml_dsa_sig_data(&env, &sk, &pk_bytes, &auth_digest);

    let signer = Signer::External(verifier_addr, key_commitment(&env, &pk_bytes));
    let mut sig_map: Map<Signer, Bytes> = Map::new(&env);
    sig_map.set(signer, sig_data);
    let signatures = AuthPayload {
        signers: sig_map,
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
}

/// A signature from a different ML-DSA key (commitment mismatch) is rejected.
#[test]
#[allow(clippy::similar_names)]
fn smart_account_check_auth_rejects_wrong_ml_dsa_key() {
    let env = Env::default();
    let (account_addr, verifier_addr, pk, _sk) = deploy_ml_dsa_account(&env);
    let (wrong_pk, wrong_sk) = ml_dsa_test_key(8);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0xEF; 32]));
    let context_rule_ids = vec![&env, 0u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);
    let sig_data = build_ml_dsa_sig_data(&env, &wrong_sk, &wrong_pk.into_bytes(), &auth_digest);

    // Registered signer identity (original key's commitment).
    let signer = Signer::External(verifier_addr, key_commitment(&env, &pk.into_bytes()));
    let mut sig_map: Map<Signer, Bytes> = Map::new(&env);
    sig_map.set(signer, sig_data);
    let signatures = AuthPayload {
        signers: sig_map,
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
    assert!(result.is_err(), "wrong ML-DSA key must be rejected");
}

/// One flipped signature byte is rejected.
#[test]
fn smart_account_check_auth_rejects_tampered_ml_dsa_signature() {
    let env = Env::default();
    let (account_addr, verifier_addr, pk, sk) = deploy_ml_dsa_account(&env);
    let pk_bytes = pk.into_bytes();

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x11; 32]));
    let context_rule_ids = vec![&env, 0u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);

    let mut signature = sk
        .try_sign(&auth_digest, SIG_CONTEXT)
        .expect("ML-DSA signing");
    signature[100] ^= 0x01;
    let sig_data = MlDsaSigData {
        public_key: Bytes::from_slice(&env, &pk_bytes),
        signature: Bytes::from_slice(&env, &signature),
    }
    .to_xdr(&env);

    let signer = Signer::External(verifier_addr, key_commitment(&env, &pk_bytes));
    let mut sig_map: Map<Signer, Bytes> = Map::new(&env);
    sig_map.set(signer, sig_data);
    let signatures = AuthPayload {
        signers: sig_map,
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
        "tampered ML-DSA signature must be rejected"
    );
}

/// Hybrid quantum-hedge rule: a Default rule holding BOTH a passkey and an
/// ML-DSA signer is a strict AND (policy-less OZ rule) — both must sign.
#[test]
fn hybrid_rule_requires_both_passkey_and_ml_dsa() {
    let env = Env::default();

    let webauthn_addr = env.register(WEBAUTHN_VERIFIER_WASM, ());
    let ml_dsa_addr = env.register(ML_DSA_VERIFIER_WASM, ());

    let p256_key = nido_integration_tests::test_key(2);
    let p256_key_data = Bytes::from_slice(&env, &p256_key.verifying_key().to_sec1_bytes());
    let (pk, sk) = ml_dsa_test_key(9);
    let pk_bytes = pk.into_bytes();

    let passkey_signer = Signer::External(webauthn_addr, p256_key_data);
    let ml_dsa_signer = Signer::External(ml_dsa_addr, key_commitment(&env, &pk_bytes));

    let signers = vec![&env, passkey_signer.clone(), ml_dsa_signer.clone()];
    let policies: Map<Address, Val> = Map::new(&env);
    let account_addr = env.register(SMART_ACCOUNT_WASM, (&signers, &policies, None::<Address>));

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x77; 32]));
    let context_rule_ids: Vec<u32> = vec![&env, 0u32];
    let auth_digest = compute_auth_digest(&env, &hash, &context_rule_ids);

    // Both signatures over the same auth digest.
    let assertion = build_contract_assertion(&p256_key, &env, &auth_digest);
    let webauthn_sig = WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    }
    .to_xdr(&env);
    let ml_dsa_sig = build_ml_dsa_sig_data(&env, &sk, &pk_bytes, &auth_digest);

    let mut both: Map<Signer, Bytes> = Map::new(&env);
    both.set(passkey_signer.clone(), webauthn_sig.clone());
    both.set(ml_dsa_signer, ml_dsa_sig);
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

    // Passkey alone must NOT satisfy the rule.
    let mut only_passkey: Map<Signer, Bytes> = Map::new(&env);
    only_passkey.set(passkey_signer, webauthn_sig);
    let signatures = AuthPayload {
        signers: only_passkey,
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
        "hybrid rule must reject a passkey-only auth"
    );
}

/// Direct verifier checks: commitment mismatch and malformed `sig_data` return
/// `false` (no trap), matching the graceful-failure contract of `verify`.
#[test]
fn verifier_rejects_commitment_mismatch_and_garbage() {
    let env = Env::default();
    let verifier_addr = env.register(ML_DSA_VERIFIER_WASM, ());
    let client = MlDsaVerifierClient::new(&env, &verifier_addr);

    let (pk, sk) = ml_dsa_test_key(3);
    let pk_bytes = pk.into_bytes();
    let digest = [0x42u8; 32];
    let payload = Bytes::from_array(&env, &digest);
    let sig_data = build_ml_dsa_sig_data(&env, &sk, &pk_bytes, &digest);

    // Happy path sanity.
    assert!(client.verify(&payload, &key_commitment(&env, &pk_bytes), &sig_data));

    // key_data committing to a DIFFERENT key: signature is valid for the
    // presented key, but the commitment check must fail.
    let (other_pk, _) = ml_dsa_test_key(4);
    assert!(!client.verify(
        &payload,
        &key_commitment(&env, &other_pk.into_bytes()),
        &sig_data
    ));

    // Undecodable sig_data XDR traps at the host layer (the
    // `deserialize_from_bytes` host fn escalates to a VM trap before
    // `from_xdr` can return Err) — surfaces as Err from try_verify.
    let garbage = Bytes::from_array(&env, &[0xFF; 16]);
    assert!(client
        .try_verify(&payload, &key_commitment(&env, &pk_bytes), &garbage)
        .is_err());

    // Wrong payload length (the auth framework always passes 32 bytes).
    let short_payload = Bytes::from_array(&env, &[0x42; 16]);
    assert!(!client.verify(&short_payload, &key_commitment(&env, &pk_bytes), &sig_data));
}
