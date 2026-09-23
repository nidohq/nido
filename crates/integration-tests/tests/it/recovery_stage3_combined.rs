//! Combined-mode lifecycle: BOTH guardian quorum AND a real ZK proof are
//! required against the SAME frozen attempt commitment before promotion —
//! neither factor alone is sufficient. This is the defining requirement of
//! `AuthMode::Combined`: the combined mode requires both factors, not
//! either one.
//!
//! Reuses the same pinned fixture/addresses as `recovery_stage3_zk_only.rs`
//! (the ZK proof is bound to `ACCOUNT`/`CONTROLLER`, so Combined-mode setup
//! is identical apart from ALSO configuring guardians).

use nido_integration_tests::{
    zk_recovery_doc_fixture, SmartAccountClient, SMART_ACCOUNT_WASM, WEBAUTHN_VERIFIER_WASM,
};
use nido_recovery_controller::types::{
    AttemptState, AuthMode, PendingActivityPolicy, Profile, RecoveryAction, RecoveryConfig,
};
use nido_recovery_controller::{RecoveryController, RecoveryControllerClient};
use nido_recovery_verifier::RecoveryVerifier;
use nido_zk_recovery::hash::leaf_inner;
use nido_zk_recovery::pool::{ZkRecovery, ZkRecoveryClient};
use soroban_sdk::address_payload::AddressPayload;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, Map, Val, Vec as SVec};
use stellar_accounts::smart_account::Signer;

const DELAY_SECS: u64 = zk_recovery_doc_fixture::TIMELOCK_SECS as u64;
const EXPIRY_SECS: u64 = 30 * 24 * 3600;

fn addr_from(env: &Env, id: &[u8; 32]) -> Address {
    AddressPayload::ContractIdHash(BytesN::from_array(env, id)).to_address(env)
}

fn hex32(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

struct CombinedSetup<'a> {
    account_addr: Address,
    controller: RecoveryControllerClient<'a>,
    guardians: SVec<Address>,
    fixture: zk_recovery_doc_fixture::ZkRecoveryDocFixture,
}

fn setup(env: &Env, n: u32, threshold: u32) -> CombinedSetup<'_> {
    let fixture = zk_recovery_doc_fixture::fixture(env);
    let webauthn_verifier = env.register(WEBAUTHN_VERIFIER_WASM, (Address::generate(env),));
    let signing_key = p256::ecdsa::SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let pubkey = signing_key.verifying_key().to_sec1_bytes();
    let signer = Signer::External(webauthn_verifier, Bytes::from_slice(env, &pubkey));
    let signers = soroban_sdk::vec![env, signer];
    let policies: Map<Address, Val> = Map::new(env);
    let account_addr = addr_from(env, &fixture.account);
    let controller_addr = addr_from(env, &fixture.controller);

    env.mock_all_auths();
    env.register_at(&controller_addr, RecoveryController, ());
    let controller = RecoveryControllerClient::new(env, &controller_addr);
    env.register_at(
        &account_addr,
        SMART_ACCOUNT_WASM,
        (signers, policies, Some(controller_addr.clone())),
    );
    let _account = SmartAccountClient::new(env, &account_addr);

    let pool_addr = env.register(
        ZkRecovery,
        (
            Address::generate(env),
            Address::generate(env),
            DELAY_SECS,
            EXPIRY_SECS,
            2u32,
            0u64,
            Bytes::from_slice(env, fixture.network_passphrase.as_bytes()),
            Address::generate(env),
            Address::generate(env),
        ),
    );
    let pool = ZkRecoveryClient::new(env, &pool_addr);
    let secret = BytesN::from_array(env, &hex32(fixture.secret_hex));
    let commitment = leaf_inner(env, &secret);
    pool.insert_for(&account_addr, &commitment);
    assert_eq!(pool.current_root().to_array(), fixture.root);

    let verifier_addr = env.register(RecoveryVerifier, ());

    let mut guardians: SVec<Address> = SVec::new(env);
    for _ in 0..n {
        guardians.push_back(Address::generate(env));
    }

    let cfg = RecoveryConfig {
        mode: AuthMode::Combined,
        profile: Profile::Loss,
        guardians: guardians.clone(),
        guardian_threshold: threshold,
        verifier: Some(verifier_addr),
        zk_pool: Some(pool_addr),
        network_passphrase: Bytes::from_slice(env, fixture.network_passphrase.as_bytes()),
        baseline_doc_hash: BytesN::from_array(env, &zk_recovery_doc_fixture::BASELINE),
        delay_secs: DELAY_SECS,
        expiry_secs: EXPIRY_SECS,
        max_cancels: 3,
        version: 1,
        pending_activity_policy: PendingActivityPolicy::Freeze,
    };
    controller.enroll(&account_addr, &cfg);

    CombinedSetup {
        account_addr,
        controller,
        guardians,
        fixture,
    }
}

/// Neither factor alone promotes a `Combined` attempt: a real ZK proof
/// verifies but leaves the attempt `CollectingEvidence` until guardian
/// quorum is ALSO met, and vice versa.
#[test]
fn combined_mode_requires_both_factors_not_either() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env, 2, 2);
    let f = &setup.fixture;

    let target_hash = BytesN::from_array(&env, &zk_recovery_doc_fixture::TARGET_DOC_HASH);
    let baseline = BytesN::from_array(&env, &zk_recovery_doc_fixture::BASELINE);
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline,
        &SVec::new(&env),
    );

    // ZK proof alone: verifies, but does not promote (guardian quorum missing).
    let root = BytesN::from_array(&env, &f.root);
    let nullifier = BytesN::from_array(&env, &f.nullifier);
    let proof = Bytes::from_slice(&env, &f.proof);
    setup
        .controller
        .submit_zk_proof(&setup.account_addr, &attempt_id, &root, &nullifier, &proof);
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(
        matches!(attempt.state, AttemptState::CollectingEvidence),
        "a verifying ZK proof alone must not promote a Combined attempt"
    );
    assert!(attempt.zk_verified);

    // Guardian quorum alone (1-of-2, still short): still not promoted.
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(matches!(attempt.state, AttemptState::CollectingEvidence));

    // Now BOTH factors satisfied: promotes.
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(
        matches!(attempt.state, AttemptState::AuthorizedPending),
        "both factors together must promote a Combined attempt"
    );
}

/// Guardian quorum alone (no ZK evidence submitted at all) never promotes a
/// `Combined` attempt, no matter how much guardian evidence accumulates.
#[test]
fn combined_mode_guardian_quorum_alone_never_promotes() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env, 2, 2);

    let target_hash = BytesN::from_array(&env, &zk_recovery_doc_fixture::TARGET_DOC_HASH);
    let baseline = BytesN::from_array(&env, &zk_recovery_doc_fixture::BASELINE);
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline,
        &SVec::new(&env),
    );

    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(
        matches!(attempt.state, AttemptState::CollectingEvidence),
        "full guardian quorum without ANY ZK evidence must not promote a Combined attempt"
    );
}
