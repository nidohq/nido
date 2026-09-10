//! Issue #87: a policy-less multi-signer DEFAULT rule is N-of-N.
//!
//! The recovery rotation's `add_signer` used to leave rule 0 with two passkeys
//! and no policy. OZ's `get_validated_context_by_id` then requires EVERY rule
//! signer to authenticate in the same ceremony, so the wallet's single-passkey
//! `__check_auth` fails forever with #3002 `UnvalidatedContext`.
//!
//! These tests pin down the brick and prove both fixes:
//!   - repro: two external signers, no policy, ONE signature → rejected;
//!   - multi-passkey ceremony: BOTH signatures in one `AuthPayload` → accepted
//!     (validates the payload shape `walletSign`'s multi-passkey ceremony
//!     assembles);
//!   - repair path: `add_policy(0, multisig, threshold=1)` on the bricked rule
//!     → single signature accepted again;
//!   - rotation ordering: installing the 1-of-1 policy BEFORE `add_signer`
//!     (the order `planRotation` emits) never passes through a bricked state.

use nido_integration_tests::{
    add_policy_direct, add_signer_direct, build_contract_assertion, compute_auth_digest,
    deploy_multisig_policy, deploy_smart_account, test_key, SmartAccountClient,
};
use p256::ecdsa::SigningKey;
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, vec, Address, Bytes, Env, IntoVal, Map, Val, Vec};
use stellar_accounts::policies::simple_threshold::SimpleThresholdAccountParams;
use stellar_accounts::smart_account::{do_check_auth, AuthPayload, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

fn external_signer(env: &Env, verifier: &Address, key: &SigningKey) -> Signer {
    let pubkey = key.verifying_key().to_sec1_bytes();
    Signer::External(verifier.clone(), Bytes::from_slice(env, &pubkey))
}

/// Sign the default-rule auth digest for `hash` with `key`, returning the
/// `(signer, sig_data)` map entry.
fn rule0_signature(
    env: &Env,
    verifier: &Address,
    key: &SigningKey,
    hash: &soroban_sdk::crypto::Hash<32>,
) -> (Signer, Bytes) {
    let context_rule_ids = vec![env, 0u32];
    let auth_digest = compute_auth_digest(env, hash, &context_rule_ids);
    let a = build_contract_assertion(key, env, &auth_digest);
    let sd = WebAuthnSigData {
        signature: a.signature,
        authenticator_data: a.authenticator_data,
        client_data: a.client_data,
    };
    (external_signer(env, verifier, key), sd.to_xdr(env))
}

/// Run `do_check_auth` against rule 0 with the given signature map and an
/// arbitrary external-contract context (the Default rule matches everything).
fn check_auth_rule0(
    env: &Env,
    account_addr: &Address,
    hash: &soroban_sdk::crypto::Hash<32>,
    entries: &[(Signer, Bytes)],
) -> std::thread::Result<()> {
    let mut sig_map: Map<Signer, Bytes> = Map::new(env);
    for (signer, sig) in entries {
        sig_map.set(signer.clone(), sig.clone());
    }
    let signatures = AuthPayload {
        signers: sig_map,
        context_rule_ids: vec![env, 0u32],
    };
    let context = Context::Contract(ContractContext {
        contract: Address::generate(env),
        fn_name: symbol_short!("transfer"),
        args: vec![env],
    });
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(account_addr, || {
            do_check_auth(env, hash, &signatures, &vec![env, context]).unwrap();
        });
    }))
}

/// Deploy an account and add a second passkey to rule 0 WITHOUT any policy —
/// the exact post-rotation state issue #87 describes.
fn deploy_two_signer_account(
    env: &Env,
) -> (
    SmartAccountClient<'_>,
    Address,
    Address,
    SigningKey,
    SigningKey,
) {
    let (client, account_addr, verifier_addr, key1) = deploy_smart_account(env);
    env.mock_all_auths();
    let key2 = test_key(7);
    // DOC-ONLY: staged via the library backdoor (no add_signer entry point).
    let _ = add_signer_direct(
        env,
        &account_addr,
        0,
        &external_signer(env, &verifier_addr, &key2),
    );
    (client, account_addr, verifier_addr, key1, key2)
}

/// Repro of the brick: rule 0 has two external signers and no policy, so a
/// single passkey signature must be rejected (`UnvalidatedContext`, #3002).
#[test]
fn policyless_two_signer_default_rule_rejects_single_signature() {
    let env = Env::default();
    let (_client, account_addr, verifier_addr, _key1, key2) = deploy_two_signer_account(&env);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x87; 32]));
    let s2 = rule0_signature(&env, &verifier_addr, &key2, &hash);

    let result = check_auth_rule0(&env, &account_addr, &hash, &[s2]);
    assert!(
        result.is_err(),
        "one signature must not satisfy a policy-less 2-signer (N-of-N) rule"
    );
}

/// The same rule accepts BOTH signatures bundled into one `AuthPayload` —
/// the on-chain proof of the multi-passkey ceremony's payload shape.
#[test]
fn policyless_two_signer_default_rule_accepts_both_signatures() {
    let env = Env::default();
    let (_client, account_addr, verifier_addr, key1, key2) = deploy_two_signer_account(&env);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x88; 32]));
    let s1 = rule0_signature(&env, &verifier_addr, &key1, &hash);
    let s2 = rule0_signature(&env, &verifier_addr, &key2, &hash);

    check_auth_rule0(&env, &account_addr, &hash, &[s1, s2])
        .expect("both signatures together must satisfy the N-of-N rule");
}

/// Repair path: installing the 1-of-N simple-threshold policy on the bricked
/// rule restores single-signature authorization for EITHER passkey.
#[test]
fn threshold_policy_repair_restores_single_signature() {
    let env = Env::default();
    let (_client, account_addr, verifier_addr, key1, key2) = deploy_two_signer_account(&env);

    let policy_addr = deploy_multisig_policy(&env);
    let install: Val = SimpleThresholdAccountParams { threshold: 1 }.into_val(&env);
    let _ = add_policy_direct(&env, &account_addr, 0, &policy_addr, install);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x89; 32]));
    let s1 = rule0_signature(&env, &verifier_addr, &key1, &hash);
    check_auth_rule0(&env, &account_addr, &hash, &[s1])
        .expect("first passkey alone must pass once the 1-of-N policy is installed");

    let hash2 = env.crypto().sha256(&Bytes::from_array(&env, &[0x8A; 32]));
    let s2 = rule0_signature(&env, &verifier_addr, &key2, &hash2);
    check_auth_rule0(&env, &account_addr, &hash2, &[s2])
        .expect("second passkey alone must pass once the 1-of-N policy is installed");
}

/// Rotation ordering (`planRotation`): install the threshold policy FIRST
/// (1-of-1 on the single-signer rule — valid and harmless), THEN add the
/// second signer. Single-signature auth keeps working at every step.
#[test]
fn policy_first_rotation_never_bricks() {
    let env = Env::default();
    let (client, account_addr, verifier_addr, key1) = deploy_smart_account(&env);
    env.mock_all_auths();

    // Step 1: add_policy(0, multisig, threshold=1) while the rule still has
    // one signer.
    let policy_addr = deploy_multisig_policy(&env);
    let install: Val = SimpleThresholdAccountParams { threshold: 1 }.into_val(&env);
    let _ = add_policy_direct(&env, &account_addr, 0, &policy_addr, install);

    let hash = env.crypto().sha256(&Bytes::from_array(&env, &[0x8B; 32]));
    let s1 = rule0_signature(&env, &verifier_addr, &key1, &hash);
    check_auth_rule0(&env, &account_addr, &hash, &[s1])
        .expect("1-of-1 policy on a single-signer rule must not block signing");

    // Step 2: add the second passkey. The rule is now 1-of-2, not 2-of-2.
    let key2 = test_key(8);
    let _ = add_signer_direct(
        &env,
        &account_addr,
        0,
        &external_signer(&env, &verifier_addr, &key2),
    );

    let rule: stellar_accounts::smart_account::ContextRule = client.get_context_rule(&0u32);
    assert_eq!(rule.signers.len(), 2, "rule 0 must now carry both passkeys");
    let policies: Vec<Address> = rule.policies;
    assert_eq!(policies.len(), 1, "rule 0 must carry the threshold policy");

    let hash2 = env.crypto().sha256(&Bytes::from_array(&env, &[0x8C; 32]));
    let s2 = rule0_signature(&env, &verifier_addr, &key2, &hash2);
    check_auth_rule0(&env, &account_addr, &hash2, &[s2])
        .expect("either single passkey must authorize under the 1-of-2 rule");

    let hash3 = env.crypto().sha256(&Bytes::from_array(&env, &[0x8D; 32]));
    let s1b = rule0_signature(&env, &verifier_addr, &key1, &hash3);
    check_auth_rule0(&env, &account_addr, &hash3, &[s1b])
        .expect("the original passkey must also authorize under the 1-of-2 rule");
}
