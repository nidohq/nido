//! ZK-only lifecycle: enrollment (real constructorless verifier +
//! real `nido-zk-recovery` Merkle pool, NO guardians configured at all),
//! initiation, and REAL ZK evidence verification (`submit_zk_proof`) through
//! promotion to `AuthorizedPending` — a genuine `bb prove` `UltraHonk` proof,
//! verified on-chain against the adapted `circuits/zk_recovery_doc` circuit.
//!
//! Completion via a real `apply_doc` call is NOT re-tested here — see
//! `crates/integration-tests/src/zk_recovery_doc_fixture.rs`'s module doc
//! comment for why (the fixture's `target_doc_hash` is synthetic; finding a
//! real document with that exact sha256 is a hash-preimage problem).
//! `Policy::enforce`'s completion gate is mode-independent shared code,
//! already proven end-to-end by `recovery_stage3_guardian_only.rs`.

use nido_integration_tests::{
    zk_recovery_doc_fixture, SmartAccountClient, SMART_ACCOUNT_WASM, WEBAUTHN_VERIFIER_WASM,
};
use nido_recovery_controller::types::{
    AttemptState, Error as RecoveryControllerError, PendingActivityPolicy, Profile, RecoveryAction,
    RecoveryConfig,
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

struct ZkOnlySetup<'a> {
    account: SmartAccountClient<'a>,
    account_addr: Address,
    controller: RecoveryControllerClient<'a>,
    fixture: zk_recovery_doc_fixture::ZkRecoveryDocFixture,
}

/// Deploys the smart account pinned at `zk_recovery_doc_fixture::ACCOUNT`,
/// the `RecoveryController` pinned at `CONTROLLER` (both addresses are
/// bound into the circuit's `auth_hash`, per `Prover.toml`'s witness), a
/// real `nido-zk-recovery` Merkle pool, and a real `nido-recovery-verifier`
/// (native registration — no wasm build needed for functional coverage,
/// only `zk-bench`-style cost measurement needs the compiled wasm). Inserts
/// the fixture's leaf and cross-checks the resulting root. Enrolls a
/// `ZkOnly`/`Loss` config. Does NOT call `begin_attempt`.
fn setup(env: &Env) -> ZkOnlySetup<'_> {
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
    // The controller must exist BEFORE the account's constructor runs --
    // `Some(recovery_controller)` cross-calls `Policy::install` on it during
    // construction, which traps if nothing is deployed at that address yet.
    env.register_at(&controller_addr, RecoveryController, ());
    let controller = RecoveryControllerClient::new(env, &controller_addr);

    env.register_at(
        &account_addr,
        SMART_ACCOUNT_WASM,
        (signers, policies, Some(controller_addr.clone())),
    );
    let account = SmartAccountClient::new(env, &account_addr);

    // Real nido-zk-recovery Merkle pool, for root membership only -- its
    // OWN completion/nullifier-reservation machinery (controller.rs/policy.rs)
    // is NOT used here (that machinery belongs to the deprecated
    // raw-signer-rotation vehicle this controller replaces). This pool's own
    // address is not bound into auth_hash, so it need not be pinned.
    let pool_addr = env.register(
        ZkRecovery,
        (
            Address::generate(env), // factory (unused: we call insert_for, not the factory-only insert)
            Address::generate(env), // verifier (unused by pool.rs's insert/root fns)
            DELAY_SECS,
            EXPIRY_SECS,
            2u32,
            0u64,
            Bytes::from_slice(env, fixture.network_passphrase.as_bytes()),
            Address::generate(env), // webauthn_verifier (unused by pool.rs)
            Address::generate(env), // admin
        ),
    );
    let pool = ZkRecoveryClient::new(env, &pool_addr);

    let secret = BytesN::from_array(env, &hex32(fixture.secret_hex));
    let commitment = leaf_inner(env, &secret);
    pool.insert_for(&account_addr, &commitment);
    assert_eq!(
        pool.current_root().to_array(),
        fixture.root,
        "on-chain frontier root after inserting the fixture leaf must equal \
         the circuit's independently-computed root"
    );

    let verifier_addr = env.register(RecoveryVerifier, ());

    let cfg = RecoveryConfig {
        mode: nido_recovery_controller::types::AuthMode::ZkOnly,
        profile: Profile::Loss,
        guardians: SVec::new(env),
        guardian_threshold: 0,
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

    ZkOnlySetup {
        account,
        account_addr,
        controller,
        fixture,
    }
}

fn hex32(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    assert_eq!(s.len(), 64, "expected 32-byte hex string, got {s:?}");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

/// The keystone honesty check: a REAL `bb prove` `UltraHonk` proof, verified
/// on-chain via `nido-recovery-verifier` (the real vendored verifier code,
/// not mocked), promotes a `ZkOnly` attempt to `AuthorizedPending` with no
/// guardian evidence at all.
#[test]
fn real_zk_proof_promotes_zk_only_attempt() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);
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
    assert_eq!(
        attempt_id, f.nonce,
        "attempt id must equal the fixture's pinned nonce"
    );

    let root = BytesN::from_array(&env, &f.root);
    let nullifier = BytesN::from_array(&env, &f.nullifier);
    let proof = Bytes::from_slice(&env, &f.proof);

    setup
        .controller
        .submit_zk_proof(&setup.account_addr, &attempt_id, &root, &nullifier, &proof);

    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(
        matches!(attempt.state, AttemptState::AuthorizedPending),
        "a real, verifying proof must promote the attempt"
    );
    assert!(setup.controller.has_pending(&setup.account_addr));
    let _ = &setup.account;
}

/// A tampered proof (single flipped byte) must be rejected by the REAL
/// on-chain verifier — not a mocked/stubbed rejection.
#[test]
fn tampered_proof_is_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);
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

    let root = BytesN::from_array(&env, &f.root);
    let nullifier = BytesN::from_array(&env, &f.nullifier);
    let mut tampered = f.proof.clone();
    tampered[0] ^= 0xFF;
    let proof = Bytes::from_slice(&env, &tampered);

    let res = setup.controller.try_submit_zk_proof(
        &setup.account_addr,
        &attempt_id,
        &root,
        &nullifier,
        &proof,
    );
    assert!(res.is_err(), "a tampered proof must be rejected");
}

/// A proof generated for a DIFFERENT target document hash must not verify
/// against a different attempt's commitment — `auth_hash` binds
/// `target_doc_hash`, so recomputing it for a different doc hash produces a
/// different `auth_hash`, which the fixture's proof was never proved
/// against.
#[test]
fn proof_does_not_transfer_to_a_different_target_doc_hash() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);
    let f = &setup.fixture;

    let wrong_target = BytesN::from_array(&env, &[0x77; 32]);
    let baseline = BytesN::from_array(&env, &zk_recovery_doc_fixture::BASELINE);
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &wrong_target,
        &baseline,
        &SVec::new(&env),
    );

    let root = BytesN::from_array(&env, &f.root);
    let nullifier = BytesN::from_array(&env, &f.nullifier);
    let proof = Bytes::from_slice(&env, &f.proof);

    let res = setup.controller.try_submit_zk_proof(
        &setup.account_addr,
        &attempt_id,
        &root,
        &nullifier,
        &proof,
    );
    assert!(
        res.is_err(),
        "a proof proved for a DIFFERENT target_doc_hash must not verify here"
    );
}

/// A stale/unknown Merkle root is rejected before the (expensive) verifier
/// cross-call even runs.
#[test]
fn unknown_root_is_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);
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

    let bogus_root = BytesN::from_array(&env, &[0x55; 32]);
    let nullifier = BytesN::from_array(&env, &f.nullifier);
    let proof = Bytes::from_slice(&env, &f.proof);

    let res = setup.controller.try_submit_zk_proof(
        &setup.account_addr,
        &attempt_id,
        &bogus_root,
        &nullifier,
        &proof,
    );
    match res {
        Err(Ok(err)) => assert_eq!(
            err,
            soroban_sdk::Error::from_contract_error(RecoveryControllerError::UnknownRoot as u32),
            "an unknown root must be rejected with UnknownRoot specifically, not the generic \
             VerificationFailed -- see zk::ZkVerifyError's scerr composition"
        ),
        other => panic!("expected contract error UnknownRoot, got {other:?}"),
    }
}
