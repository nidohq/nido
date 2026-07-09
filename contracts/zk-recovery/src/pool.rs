//! The `#[contract]` entry point for `contracts/zk-recovery`: constructor +
//! the two account-bound insert paths (spec §3.3 "insert"/"insert_for").
//!
//! This is where a client-supplied `commitment` (the circuit's `inner` leaf,
//! `main.nr:36`) becomes bound to an on-chain `Address` via `hash::wrap_leaf`
//! -- and the ONLY place that binding happens. Both entry points compute
//! `stored = wrap_leaf(account, commitment)` themselves from the `account`
//! argument that was just `require_auth`'d; a caller can never hand the
//! contract a pre-wrapped `stored` value and have it trusted. That is the
//! entire security property this module exists to enforce (spec §2.2): a
//! leaf can only ever be usable to recover the account whose authority
//! (factory at genesis, or the account itself for later re-enrollment)
//! signed off on the insert.

// `#[contractimpl]`'s macro-generated `__constructor` invoke wrapper (used
// by the `testutils` client) is emitted at the `#[contractimpl]` attribute's
// own span, not `__constructor`'s -- so the per-fn `#[allow(clippy::
// too_many_arguments)]` below doesn't reach it, and clippy warns at the
// attribute site instead. Only surfaced by M1 Task 7's `webauthn_verifier`
// field, appended to `RecoveryConfig`/`__constructor`.
#![allow(clippy::too_many_arguments)]

use crate::hash::wrap_leaf;
use crate::merkle;
use crate::types::{LeafInserted, RecoveryConfig, RecoveryError, RecoveryKey};
use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Bytes, BytesN, Env, U256};

// `controller.rs` (M1 Task 5) is declared as a *submodule of `pool`* (not a
// sibling top-level module in `lib.rs`) even though it physically lives at
// `src/controller.rs` (`#[path]` points there). This is required, not
// stylistic: `soroban_sdk::contractimpl`'s generated per-function client
// methods (under the `testutils` feature) read private fields
// (`set_auths`/`mock_auths`/`mock_all_auths`/`allow_non_root_auth`) on
// `ZkRecoveryClient`, which `#[contract]` (below) declares as
// module-private -- visible to `pool` and its descendants only. A sibling
// top-level `mod controller` cannot see them and fails to compile under
// `testutils`; a `pool::controller` submodule can.
#[path = "controller.rs"]
pub mod controller;

// `policy.rs` (M1 Task 7) is declared as a submodule of `pool` for the same
// reason `controller` is (see the doc comment above): the OZ `Policy` impl
// below is a THIRD `#[contractimpl]` block on the same `ZkRecovery`
// `#[contract]` struct, and `soroban_sdk::contractimpl`'s generated
// `testutils`-feature client methods need to see `ZkRecoveryClient`'s
// module-private fields.
#[path = "policy.rs"]
pub mod policy;

/// The BN254 scalar field order `r` (spec §2.2): every real `inner` leaf is
/// a Poseidon2 output, hence already `< r` by construction; `r` itself and
/// anything above it can never be produced by the circuit and is rejected
/// as a non-canonical/malformed leaf rather than silently reduced mod `r`
/// (which would let a caller collide two different-looking commitments onto
/// the same wrapped leaf). Big-endian bytes of
/// `21888242871839275222246405745257275088548364400416034343698204186575808495617`.
const FIELD_ORDER_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

fn field_order(env: &Env) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, &FIELD_ORDER_BE))
}

/// Panics with `RecoveryError::NonCanonicalCommitment` if `commitment`,
/// interpreted as a big-endian `U256`, is `>= r`. Rejects rather than
/// `rem_euclid`s (spec §2.2) -- see `FIELD_ORDER_BE`'s doc comment.
fn require_canonical(env: &Env, commitment: &BytesN<32>) {
    let value = U256::from_be_bytes(env, &Bytes::from_array(env, &commitment.to_array()));
    if value >= field_order(env) {
        panic_with_error!(env, RecoveryError::NonCanonicalCommitment);
    }
}

/// `pub(crate)` so `controller.rs` (M1 Task 5) can read the same config.
pub(crate) fn config(env: &Env) -> RecoveryConfig {
    env.storage()
        .instance()
        .get(&RecoveryKey::Config)
        .expect("zk-recovery: __constructor must run before any other entry point")
}

/// Shared tail of `insert`/`insert_for`, once the caller-appropriate
/// `require_auth()` has already succeeded: reject non-canonical
/// commitments, wrap `commitment` under `account` (the on-chain binding),
/// append it to the Merkle pool, emit `LeafInserted`, and return its index.
fn insert_bound(env: &Env, account: &Address, commitment: &BytesN<32>) -> u32 {
    require_canonical(env, commitment);
    let stored = wrap_leaf(env, account, commitment);
    let index = merkle::insert_leaf(env, &stored);
    LeafInserted {
        index: &index,
        leaf: &stored,
    }
    .publish(env);
    index
}

#[contract]
pub struct ZkRecovery;

#[contractimpl]
impl ZkRecovery {
    /// Stores the immutable `RecoveryConfig` (spec §3.3 "Defaults"). Must
    /// run once, at deploy time, before any other entry point.
    #[allow(clippy::too_many_arguments)]
    pub fn __constructor(
        env: Env,
        factory: Address,
        verifier: Address,
        delay_secs: u64,
        completion_window_secs: u64,
        max_cancels: u32,
        timelock_floor_secs: u64,
        network_passphrase: Bytes,
        webauthn_verifier: Address,
    ) {
        let cfg = RecoveryConfig {
            factory,
            verifier,
            delay_secs,
            completion_window_secs,
            max_cancels,
            timelock_floor_secs,
            network_passphrase,
            webauthn_verifier,
        };
        env.storage().instance().set(&RecoveryKey::Config, &cfg);
    }

    /// GENESIS insert: the factory creates `account` and, in the same
    /// transaction, enrolls its recovery `commitment`. Only `config.factory`
    /// may call this -- it is the sole authority permitted to assert an
    /// arbitrary account binding, because it is the entity that just
    /// created `account` and therefore knows the binding is legitimate
    /// (spec's Task-4 genesis note). Returns the new leaf's index.
    pub fn insert(env: Env, account: Address, commitment: BytesN<32>) -> u32 {
        config(&env).factory.require_auth();
        insert_bound(&env, &account, &commitment)
    }

    /// MIGRATION/re-enroll insert: `account` authorizes its own visible
    /// insert (e.g. adding a fresh recovery secret after rotating away from
    /// a leaked one). Returns the new leaf's index.
    pub fn insert_for(env: Env, account: Address, commitment: BytesN<32>) -> u32 {
        account.require_auth();
        insert_bound(&env, &account, &commitment)
    }

    /// The current Merkle root over all inserted leaves (thin wrapper over
    /// `merkle::current_root`, exposed for off-chain clients/later tasks).
    pub fn current_root(env: Env) -> BytesN<32> {
        merkle::current_root(&env)
    }

    /// Whether `root` is still retained in the historic-root ring (or is the
    /// empty-tree root).
    pub fn is_known_root(env: Env, root: BytesN<32>) -> bool {
        merkle::is_known_root(&env, &root)
    }

    /// The number of leaves inserted so far.
    pub fn next_index(env: Env) -> u32 {
        merkle::next_index(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events as _};
    use soroban_sdk::Event;

    // A minimal second contract, entirely independent of `ZkRecovery`'s
    // entry points, used purely to host `merkle::insert_leaf`'s persistent
    // storage for the reference recompute in
    // `insert_for_binds_leaf_to_authed_account` below.
    #[contract]
    struct RefContract;

    #[contractimpl]
    impl RefContract {}

    fn setup(env: &Env) -> (Address, RecoveryConfig) {
        let factory = Address::generate(env);
        let verifier = Address::generate(env);
        let webauthn_verifier = Address::generate(env);
        let cfg = RecoveryConfig {
            factory: factory.clone(),
            verifier,
            delay_secs: 3 * 24 * 3600,
            completion_window_secs: 7 * 24 * 3600,
            max_cancels: 3,
            timelock_floor_secs: 24 * 3600,
            network_passphrase: Bytes::from_slice(env, b"Test SDF Network ; September 2015"),
            webauthn_verifier,
        };
        let id = env.register(
            ZkRecovery,
            (
                cfg.factory.clone(),
                cfg.verifier.clone(),
                cfg.delay_secs,
                cfg.completion_window_secs,
                cfg.max_cancels,
                cfg.timelock_floor_secs,
                cfg.network_passphrase.clone(),
                cfg.webauthn_verifier.clone(),
            ),
        );
        (id, cfg)
    }

    fn commitment_from_u64(env: &Env, x: u64) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[24..32].copy_from_slice(&x.to_be_bytes());
        BytesN::from_array(env, &bytes)
    }

    /// `insert_for(account, commitment)` (with the account's own auth
    /// satisfied): the tree advances, `current_root` is known, and --
    /// crucially -- both the published `LeafInserted` event and the
    /// resulting root match what independently `wrap_leaf(account,
    /// commitment)`-then-`merkle::insert_leaf` (called directly, NOT
    /// through `pool::insert_bound`) would produce. That second check is
    /// the security-critical one: it proves the leaf the contract actually
    /// stored is the on-chain wrap of the auth'd `account`, not a
    /// caller-supplied value trusted as-is.
    #[test]
    fn insert_for_binds_leaf_to_authed_account() {
        let env = Env::default();
        env.mock_all_auths();
        let (id, _cfg) = setup(&env);
        let account = Address::generate(&env);
        let commitment = commitment_from_u64(&env, 42);
        let client = ZkRecoveryClient::new(&env, &id);

        let idx = client.insert_for(&account, &commitment);
        assert_eq!(idx, 0, "first insert must land at index 0");

        let expected_leaf = wrap_leaf(&env, &account, &commitment);

        let expected_event = LeafInserted {
            index: &idx,
            leaf: &expected_leaf,
        };
        assert_eq!(
            env.events().all().filter_by_contract(&id),
            [expected_event.to_xdr(&env, &id)],
            "LeafInserted.leaf must equal wrap_leaf(authed account, commitment)"
        );

        let root = client.current_root();
        assert!(
            client.is_known_root(&root),
            "root after insert_for must be known"
        );
        assert_eq!(client.next_index(), 1);

        // Independent reference: insert the same expected wrapped leaf into
        // a second, unrelated contract's Merkle pool directly via
        // `merkle::insert_leaf` and check the roots agree.
        let ref_id = env.register(RefContract, ());
        let ref_root = env.as_contract(&ref_id, || {
            merkle::insert_leaf(&env, &expected_leaf);
            merkle::current_root(&env)
        });
        assert_eq!(
            root, ref_root,
            "insert_for's resulting root must match independently inserting \
             wrap_leaf(account, commitment) via merkle::insert_leaf"
        );
    }

    /// `commitment == r` or `> r` must panic `NonCanonicalCommitment`;
    /// `commitment == r - 1` (the largest canonical value) must be accepted.
    #[test]
    fn rejects_commitment_at_or_above_field_order() {
        let env = Env::default();
        env.mock_all_auths();
        let (id, _cfg) = setup(&env);
        let account = Address::generate(&env);

        let r = BytesN::from_array(&env, &FIELD_ORDER_BE);
        let mut r_plus_1_bytes = FIELD_ORDER_BE;
        // FIELD_ORDER_BE ends in ..._f0_00_00_01; +1 -> ..._f0_00_00_02.
        r_plus_1_bytes[31] = r_plus_1_bytes[31].wrapping_add(1);
        let r_plus_1 = BytesN::from_array(&env, &r_plus_1_bytes);
        let mut r_minus_1_bytes = FIELD_ORDER_BE;
        r_minus_1_bytes[31] = r_minus_1_bytes[31].wrapping_sub(1);
        let r_minus_1 = BytesN::from_array(&env, &r_minus_1_bytes);

        let client = ZkRecoveryClient::new(&env, &id);

        assert!(
            client.try_insert_for(&account, &r).is_err(),
            "commitment == r must be rejected"
        );
        assert!(
            client.try_insert_for(&account, &r_plus_1).is_err(),
            "commitment == r + 1 must be rejected"
        );
        assert!(
            client.try_insert_for(&account, &r_minus_1).is_ok(),
            "commitment == r - 1 (largest canonical value) must be accepted"
        );
    }

    /// `insert` (the genesis/factory path) requires `config.factory`'s auth,
    /// not the account's: with all authorizations cleared it panics; with
    /// the factory's auth mocked it succeeds.
    #[test]
    fn insert_requires_factory_auth() {
        let env = Env::default();
        let (id, cfg) = setup(&env);
        let account = Address::generate(&env);
        let commitment = commitment_from_u64(&env, 7);
        let client = ZkRecoveryClient::new(&env, &id);

        // No authorizations mocked at all -- the factory's require_auth must
        // reject.
        assert!(
            client.try_insert(&account, &commitment).is_err(),
            "insert without the factory's auth must fail"
        );

        // Only the account (not the factory) authorizes -- still must fail,
        // proving `insert` checks the factory specifically.
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        use soroban_sdk::IntoVal;
        let res = client
            .mock_auths(&[MockAuth {
                address: &account,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "insert",
                    args: (account.clone(), commitment.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_insert(&account, &commitment);
        assert!(
            res.is_err(),
            "insert authorized only by the account (not the factory) must fail"
        );

        // With the factory's auth mocked, it succeeds.
        env.mock_all_auths();
        let idx = client.insert(&account, &commitment);
        assert_eq!(idx, 0);
        let _ = cfg;
    }

    /// `insert_for` (the account's re-enroll path) requires the `account`'s
    /// auth, not a caller-supplied or unrelated address. Without the account's
    /// auth it panics; with it mocked it succeeds.
    #[test]
    fn insert_for_requires_account_auth() {
        let env = Env::default();
        let (id, _cfg) = setup(&env);
        let account = Address::generate(&env);
        let other = Address::generate(&env);
        let commitment = commitment_from_u64(&env, 42);
        let client = ZkRecoveryClient::new(&env, &id);

        // No authorizations mocked at all -- the account's require_auth must
        // reject.
        assert!(
            client.try_insert_for(&account, &commitment).is_err(),
            "insert_for without the account's auth must fail"
        );

        // Only an unrelated address authorizes (not the account) -- still must
        // fail, proving `insert_for` checks the account specifically.
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
        use soroban_sdk::IntoVal;
        let res = client
            .mock_auths(&[MockAuth {
                address: &other,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "insert_for",
                    args: (account.clone(), commitment.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_insert_for(&account, &commitment);
        assert!(
            res.is_err(),
            "insert_for authorized only by unrelated address (not the account) must fail"
        );

        // With the account's auth mocked, it succeeds.
        let res = client
            .mock_auths(&[MockAuth {
                address: &account,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "insert_for",
                    args: (account.clone(), commitment.clone()).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_insert_for(&account, &commitment);
        assert!(
            res.is_ok(),
            "insert_for authorized by the account must succeed"
        );
    }

    /// Task 11 (M2 residual): cross-crate constant drift guard, the half of
    /// it that can only live here -- `FIELD_ORDER_BE` is private to this
    /// module, so this is the ONLY place a compiled test can compare it
    /// directly. `CANONICAL_FIELD_ORDER_BE` below is the single literal
    /// source of truth; `contracts/factory/src/contract.rs`'s
    /// `DUMMY_FIELD_ORDER_BE` is guarded separately (it cannot see this
    /// private const either) both against the identical literal AND,
    /// behaviorally, against this real pool's `require_canonical` --  see
    /// `factory::contract::test::dummy_field_order_matches_canonical` and
    /// `dummy_field_order_matches_pool_behavior`.
    ///
    /// Also pins `merkle::DEPTH == 24` (spec §3.4's depth-24 pool).
    #[test]
    fn field_order_and_merkle_depth_match_canonical() {
        // BN254 scalar field order r =
        // 21888242871839275222246405745257275088548364400416034343698204186575808495617,
        // big-endian. Must byte-match `contracts/zk-recovery/src/pool.rs`'s
        // `FIELD_ORDER_BE` doc comment and the plan's Global Constraints.
        const CANONICAL_FIELD_ORDER_BE: [u8; 32] = [
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81,
            0x58, 0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93,
            0xf0, 0x00, 0x00, 0x01,
        ];
        assert_eq!(
            FIELD_ORDER_BE, CANONICAL_FIELD_ORDER_BE,
            "pool.rs FIELD_ORDER_BE drifted from the canonical BN254 scalar order r"
        );
        assert_eq!(
            merkle::DEPTH,
            24,
            "merkle::DEPTH drifted from the spec's depth-24 incremental pool"
        );
    }
}
