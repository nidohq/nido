//! M1 Task 5: `ZkRecovery::initiate_recovery` end-to-end, against a REAL
//! `bb prove` proof.
//!
//! The recovery circuit's `auth_hash` public input binds the account and
//! controller *contract addresses* (`circuits/zk_recovery/src/main.nr:40-42`),
//! so the committed lifecycle fixture proof
//! (`crates/integration-tests/src/zk_fixture.rs`) is only valid against a
//! deploy that pins the smart account/controller at the EXACT addresses the
//! proof was generated for (`zk_fixture::ACCOUNT`/`CONTROLLER`, via
//! `env.register_at`). Every test below deploys `ZkRecovery` at
//! `CONTROLLER` for this reason.
//!
//! `real_proof_initiates_recovery_with_timelocked_pending` is the keystone
//! honesty check for M1 Task 5: it proves the REAL fixture proof verifies
//! through `initiate_recovery`'s cross-call to the M0 verifier contract,
//! using an `auth_hash` this contract recomputes itself from the call's own
//! arguments -- not one fed to it directly. The current_root ==
//! fixture.root assertion inside `setup_with_leaf` cross-checks that this
//! contract's on-chain Merkle frontier agrees with the Noir circuit's own
//! root computation for the identical leaf.

use nido_integration_tests::zk_fixture::{self, LifecycleFixture};
use nido_zk_recovery::hash::leaf_inner;
use nido_zk_recovery::pool::{ZkRecovery, ZkRecoveryClient};
use nido_zk_recovery::types::{NullifierState, RecoveryError, RecoveryInitiated, RecoveryKey};
use soroban_sdk::address_payload::AddressPayload;
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{Address, Bytes, BytesN, Env, Error as SdkError, Event};

mod zk_verifier_contract {
    // Path is relative to CARGO_MANIFEST_DIR (crates/integration-tests/).
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/contract/nido_zk_verifier.wasm"
    );
}

/// The `ZkRecoveryConfig` fixed for every test below. `DELAY_SECS` must
/// equal `zk_fixture::TIMELOCK_SECS` -- the fixture's proof was generated
/// with `timelock_secs = 1_209_600` bound into `auth_hash`, and
/// `initiate_recovery` requires `timelock_secs == config.delay_secs`
/// exactly (spec §3.3 check 5).
const DELAY_SECS: u64 = zk_fixture::TIMELOCK_SECS as u64;
const COMPLETION_WINDOW_SECS: u64 = 30 * 24 * 3600;
const MAX_CANCELS: u32 = 2;
const TIMELOCK_FLOOR_SECS: u64 = 7 * 24 * 3600;

fn addr_from(env: &Env, id: &[u8; 32]) -> Address {
    AddressPayload::ContractIdHash(BytesN::from_array(env, id)).to_address(env)
}

fn hex32(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    assert_eq!(s.len(), 64, "expected a 32-byte hex string, got {s:?}");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

/// Deploys the M0 verifier (real wasm + M0 vk) and `ZkRecovery` pinned at
/// `zk_fixture::CONTROLLER` (so `auth_hash`'s `ctrl_hi/lo` binds to this
/// exact address). Does NOT insert the fixture leaf -- callers that need a
/// known root call `insert_fixture_leaf` afterwards.
fn deploy(env: &Env) -> (ZkRecoveryClient<'_>, Address, LifecycleFixture) {
    let fixture = zk_fixture::lifecycle_fixture(env);

    let vk_bytes = Bytes::from_slice(env, include_bytes!("../../fixtures/zk/vk"));
    let verifier_id = env.register(zk_verifier_contract::WASM, (vk_bytes,));

    let controller_addr = addr_from(env, &fixture.controller);
    let factory = Address::generate(env);
    let network_passphrase = Bytes::from_slice(env, fixture.network_passphrase.as_bytes());

    let contract_id = env.register_at(
        &controller_addr,
        ZkRecovery,
        (
            factory,
            verifier_id,
            DELAY_SECS,
            COMPLETION_WINDOW_SECS,
            MAX_CANCELS,
            TIMELOCK_FLOOR_SECS,
            network_passphrase,
        ),
    );
    let client = ZkRecoveryClient::new(env, &contract_id);

    let account = addr_from(env, &fixture.account);
    (client, account, fixture)
}

/// Inserts the fixture's leaf (`leaf_inner(secret)`, wrapped by the pool
/// under `account`) and asserts the resulting on-chain frontier root equals
/// the circuit-computed `fixture.root` -- the required cross-check proving
/// the on-chain frontier algorithm agrees with the Noir circuit's root for
/// this exact leaf.
fn insert_fixture_leaf(
    env: &Env,
    client: &ZkRecoveryClient<'_>,
    account: &Address,
    fixture: &LifecycleFixture,
) {
    let secret = BytesN::from_array(env, &hex32(fixture.secret_hex));
    let commitment = leaf_inner(env, &secret);

    env.mock_all_auths();
    client.insert_for(account, &commitment);

    let root = client.current_root();
    assert_eq!(
        root.to_array(),
        fixture.root,
        "on-chain frontier root after inserting the fixture leaf must equal \
         the Noir circuit's independently-computed root -- a mismatch here \
         means the on-chain frontier algorithm disagrees with the circuit"
    );
}

/// Full setup: `deploy` + `insert_fixture_leaf`.
fn setup(env: &Env) -> (ZkRecoveryClient<'_>, Address, LifecycleFixture) {
    let (client, account, fixture) = deploy(env);
    insert_fixture_leaf(env, &client, &account, &fixture);
    (client, account, fixture)
}

fn contract_error(
    res: &Result<Result<u64, SdkError>, Result<SdkError, soroban_sdk::InvokeError>>,
) -> RecoveryError {
    match res {
        Err(Ok(err)) => {
            let code = err.get_code();
            for known in [
                RecoveryError::PendingExists,
                RecoveryError::UnknownRoot,
                RecoveryError::NullifierReserved,
                RecoveryError::NullifierSpent,
                RecoveryError::InvalidNonce,
                RecoveryError::TimelockTooShort,
                RecoveryError::TimelockMismatch,
                RecoveryError::RateLimited,
                RecoveryError::VerificationFailed,
            ] {
                if known as u32 == code {
                    return known;
                }
            }
            panic!("unrecognized RecoveryError code {code}");
        }
        other => panic!("expected a contract error, got {other:?}"),
    }
}

/// The keystone honesty check for M1 Task 5: the REAL fixture proof
/// verifies through `initiate_recovery`'s cross-call to the M0 verifier,
/// against an `auth_hash` this contract recomputes itself from the call's
/// own arguments (not fed to it directly).
#[test]
fn real_proof_initiates_recovery_with_timelocked_pending() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (client, account, fixture) = setup(&env);

    let new_pubkey = BytesN::from_array(&env, &fixture.new_pubkey);
    let root = BytesN::from_array(&env, &fixture.root);
    let nullifier = BytesN::from_array(&env, &fixture.nullifier);
    let proof = Bytes::from_slice(&env, &fixture.proof);

    let now = env.ledger().timestamp();
    let executable_after = client.initiate_recovery(
        &account,
        &new_pubkey,
        &fixture.nonce,
        &fixture.timelock_secs,
        &root,
        &nullifier,
        &proof,
    );

    assert_eq!(
        executable_after,
        now + DELAY_SECS,
        "initiate_recovery must return now + config.delay_secs"
    );

    // `events().all()` (soroban-sdk testutils) only returns events from the
    // LAST contract invocation, so this must be captured before any further
    // client calls (e.g. `get_pending` below) become "the last invocation".
    let new_pubkey_hash = env
        .crypto()
        .sha256(&Bytes::from_array(&env, &new_pubkey.to_array()))
        .to_bytes();
    let expected_event = RecoveryInitiated {
        account: &account,
        new_pubkey_hash: &new_pubkey_hash,
        executable_after: &executable_after,
    };
    assert_eq!(
        env.events().all().filter_by_contract(&client.address),
        [expected_event.to_xdr(&env, &client.address)],
        "RecoveryInitiated must be emitted with account/new_pubkey_hash/executable_after"
    );

    let pending = client
        .get_pending(&account)
        .expect("get_pending must be Some after a successful initiate_recovery");
    assert_eq!(pending.nullifier, nullifier);
    assert_eq!(pending.new_pubkey, new_pubkey);
    assert_eq!(pending.initiated_at, now);
    assert_eq!(pending.executable_after, executable_after);
    assert_eq!(
        pending.expires_at,
        executable_after + COMPLETION_WINDOW_SECS
    );

    // The nullifier must now be Reserved(account).
    let state: Option<NullifierState> = env.as_contract(&client.address, || {
        env.storage()
            .persistent()
            .get(&RecoveryKey::Nullifier(nullifier.clone()))
    });
    assert_eq!(
        state,
        Some(NullifierState::Reserved(account.clone())),
        "nullifier must be reserved to the recovering account"
    );
}

/// An unknown root (never produced by this contract's frontier, since no
/// leaf was ever inserted) must be rejected before any proof verification
/// is attempted.
#[test]
fn unknown_root_is_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (client, account, fixture) = deploy(&env); // no leaf inserted

    let new_pubkey = BytesN::from_array(&env, &fixture.new_pubkey);
    let root = BytesN::from_array(&env, &fixture.root); // never produced on-chain here
    let nullifier = BytesN::from_array(&env, &fixture.nullifier);
    let proof = Bytes::from_slice(&env, &fixture.proof);

    let res = client.try_initiate_recovery(
        &account,
        &new_pubkey,
        &fixture.nonce,
        &fixture.timelock_secs,
        &root,
        &nullifier,
        &proof,
    );
    assert_eq!(contract_error(&res), RecoveryError::UnknownRoot);
}

/// Initiating twice for the same account: the second call must fail. With
/// no ledger time advanced between calls, the first initiation's pending
/// record is still live, so the ordered checks reject at `PendingExists`
/// (check 1) before ever reaching the nullifier check -- this still proves
/// the contract does not allow a second concurrent initiation to reuse the
/// same nullifier/account.
#[test]
fn reinitiating_with_a_live_pending_is_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (client, account, fixture) = setup(&env);

    let new_pubkey = BytesN::from_array(&env, &fixture.new_pubkey);
    let root = BytesN::from_array(&env, &fixture.root);
    let nullifier = BytesN::from_array(&env, &fixture.nullifier);
    let proof = Bytes::from_slice(&env, &fixture.proof);

    let executable_after = client.initiate_recovery(
        &account,
        &new_pubkey,
        &fixture.nonce,
        &fixture.timelock_secs,
        &root,
        &nullifier,
        &proof,
    );
    assert!(executable_after > 0);

    // Second call, same account/nullifier, nonce bumped (as if a caller
    // tried to race a second initiation): still must fail.
    let res = client.try_initiate_recovery(
        &account,
        &new_pubkey,
        &(fixture.nonce + 1),
        &fixture.timelock_secs,
        &root,
        &nullifier,
        &proof,
    );
    let err = contract_error(&res);
    assert!(
        matches!(
            err,
            RecoveryError::PendingExists | RecoveryError::NullifierReserved
        ),
        "reinitiating over a live pending must fail with PendingExists or \
         NullifierReserved, got {err:?}"
    );
}

/// `nonce != stored_nonce + 1` must be rejected (`InvalidNonce`), before any
/// proof verification is attempted.
#[test]
fn wrong_nonce_is_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (client, account, fixture) = setup(&env);

    let new_pubkey = BytesN::from_array(&env, &fixture.new_pubkey);
    let root = BytesN::from_array(&env, &fixture.root);
    let nullifier = BytesN::from_array(&env, &fixture.nullifier);
    let proof = Bytes::from_slice(&env, &fixture.proof);

    let wrong_nonce = fixture.nonce + 1; // stored nonce starts at 0, expects 1
    let res = client.try_initiate_recovery(
        &account,
        &new_pubkey,
        &wrong_nonce,
        &fixture.timelock_secs,
        &root,
        &nullifier,
        &proof,
    );
    assert_eq!(contract_error(&res), RecoveryError::InvalidNonce);
}

/// `timelock_secs < config.timelock_floor_secs` must be rejected
/// (`TimelockTooShort`), before any proof verification is attempted.
#[test]
fn timelock_below_floor_is_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (client, account, fixture) = setup(&env);

    let new_pubkey = BytesN::from_array(&env, &fixture.new_pubkey);
    let root = BytesN::from_array(&env, &fixture.root);
    let nullifier = BytesN::from_array(&env, &fixture.nullifier);
    let proof = Bytes::from_slice(&env, &fixture.proof);

    let too_short: u32 = 100; // well under TIMELOCK_FLOOR_SECS (7 days)
    let res = client.try_initiate_recovery(
        &account,
        &new_pubkey,
        &fixture.nonce,
        &too_short,
        &root,
        &nullifier,
        &proof,
    );
    assert_eq!(contract_error(&res), RecoveryError::TimelockTooShort);
}

/// Tampering with `new_pubkey` (any single byte) changes the recomputed
/// `auth_hash`, which no longer matches the proof's `auth_hash` public
/// input -- the real UltraHonk verifier cross-call must then reject,
/// surfacing as `VerificationFailed`. This proves `initiate_recovery`
/// genuinely binds the proof to ITS OWN recomputed arguments rather than
/// trusting the caller.
#[test]
fn tampered_new_pubkey_fails_proof_verification() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let (client, account, fixture) = setup(&env);

    let mut tampered_pubkey_bytes = fixture.new_pubkey;
    tampered_pubkey_bytes[1] ^= 0xff; // flip a byte inside the x-coordinate
    let tampered_pubkey = BytesN::from_array(&env, &tampered_pubkey_bytes);

    let root = BytesN::from_array(&env, &fixture.root);
    let nullifier = BytesN::from_array(&env, &fixture.nullifier);
    let proof = Bytes::from_slice(&env, &fixture.proof);

    let res = client.try_initiate_recovery(
        &account,
        &tampered_pubkey,
        &fixture.nonce,
        &fixture.timelock_secs,
        &root,
        &nullifier,
        &proof,
    );
    assert_eq!(contract_error(&res), RecoveryError::VerificationFailed);
}
