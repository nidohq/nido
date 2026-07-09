use soroban_sdk::{
    contract, contractimpl, deploy::DeployerWithAddress, Address, Bytes, BytesN, Env, String,
    Symbol, U256,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

mod smart_account {
    //! Embeds the smart-account contract wasm so the factory no longer
    //! hardcodes its wasm hash. The mechanism:
    //!
    //!  1. `build.rs` stages the `just build-contracts` output
    //!     (`nido_smart_account.wasm`) and emits `STELLAR_ACCOUNT_WASM` pointing
    //!     at it.
    //!  2. `include_bytes!(env!("STELLAR_ACCOUNT_WASM"))` embeds those exact
    //!     bytes into the factory wasm as `WASM` below.
    //!  3. At runtime the factory computes `sha256(WASM)` (see
    //!     `super::Contract::account_wasm_hash`) and passes that hash to
    //!     `deploy_v2`. So the deploy hash tracks the embedded bytes
    //!     automatically — no more hand-recomputed `ACCOUNT_HASH`.
    //!
    //! For `deploy_v2` to resolve, those same bytes must already be installed
    //! on-chain. The deploy script's smart-account publish step
    //! (`scripts/deploy-policy-builder-v1.sh`) installs the locally-built wasm
    //! and asserts its sha256 matches what the factory embeds, so the
    //! embed==installed invariant holds.
    //!
    //! NOTE: an earlier approach used
    //! `stellar_registry::import_contract_client!("unverified/smart-account@0.1.0")`,
    //! which expands to `soroban_sdk::contractimport!` and also generates a
    //! typed contract `Client`. The smart-account's
    //! `__check_auth(..., auth_contexts: Vec<Context>)` signature makes the
    //! generator emit a bare `Context` type that it neither defines nor imports
    //! (the same soroban-spec gap `scripts/fix-bindings.sh` patches for the TS
    //! bindings), so the generated client fails to compile inside the
    //! macro-created module — which we cannot edit. We therefore embed only the
    //! wasm bytes (no client), avoiding the gap while still eliminating the
    //! hardcoded hash. The registry `ACCOUNT_VERSION` is now just a label under
    //! which the bytes are published; nothing enforces it equals the embedded
    //! wasm — the sha256 comparison in the deploy script does that.
    //!
    //! `STELLAR_ACCOUNT_WASM` is an absolute path emitted by `build.rs`; the
    //! built-in `include_bytes!` macro expands `env!` eagerly.

    /// Raw smart-account contract wasm, embedded at build time. `sha256` of
    /// these bytes is the hash the factory hands to `deploy_v2`.
    pub const WASM: &[u8] = include_bytes!(env!("STELLAR_ACCOUNT_WASM"));
}

/// Stellar Registry "unverified" testnet contract — the one that holds
/// bare-name → contract-id mappings. The verified registry's address is
/// `CAMLHKQHNZO2IOIBFUF5BGZ2V62BMS5QCWFFGRCB4NOB3G5OMDA7SGZN`; it doesn't
/// dispatch prefixed names natively (the CLI does that client-side). Calling
/// `fetch_contract_id("verifier")` directly on the unverified registry
/// returns the registered contract id; that's what `resolve` below relies on.
///
/// For mainnet or an alternate registry build, change this constant and
/// redeploy the factory.
const REGISTRY: &str = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";

mod registry {
    use soroban_sdk::*;
    #[contractclient(name = "RegistryClient")]
    pub trait RegistryInterface {
        fn fetch_contract_id(name: String) -> Address;
    }
}

/// Minimal cross-call stub for `nido-zk-recovery`'s pool `insert` (the
/// GENESIS entry point, `contracts/zk-recovery/src/pool.rs::insert`).
///
/// This crate deliberately does NOT depend on `nido-zk-recovery` as a normal
/// Cargo dependency: both are `#[contract]` crates, and linking one into the
/// other's cdylib would collide their identically-named `#[no_mangle]`
/// exports (`__constructor`, `install`, `enforce`, …) at wasm link time.
/// `#[contractclient]` on a local trait, by contrast, generates ONLY a
/// caller stub (a struct wrapping `invoke_contract` calls) — no exported
/// symbols — so it does not collide. Mirrors the exact pattern
/// `contracts/smart-account/src/contract.rs`'s `RecoveryControllerClient`
/// uses for the same reason (M2 Task 4).
mod zk_recovery {
    use soroban_sdk::*;
    #[contractclient(name = "ZkRecoveryClient")]
    pub trait ZkRecoveryInterface {
        fn insert(e: Env, account: Address, commitment: BytesN<32>) -> u32;
    }
}

#[contractstorage]
pub struct Config {
    account: InstanceItem<BytesN<32>>,
    passkey: InstanceItem<Address>,
    admin: InstanceItem<Address>,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn __constructor(e: &Env, admin: Address) {
        Config::new(e).admin.set(&admin);
    }

    /// The factory admin — the only address allowed to rotate the admin or
    /// upgrade the factory wasm. Set at construct time.
    pub fn admin(e: &Env) -> Address {
        Config::new(e)
            .admin
            .get()
            .expect("factory admin not set; deploy a fresh factory (old instances predate admin)")
    }

    /// Rotate the admin. Requires the current admin's auth.
    pub fn set_admin(e: &Env, new_admin: Address) {
        Self::admin(e).require_auth();
        Config::new(e).admin.set(&new_admin);
    }

    /// Upgrade the factory's own wasm to `new_wasm_hash` (an already-installed
    /// wasm hash). Requires admin auth.
    pub fn upgrade(e: &Env, new_wasm_hash: BytesN<32>) {
        Self::admin(e).require_auth();
        e.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Deploy an account contract and add its initial passkey signer. Legacy
    /// entry point, kept for existing callers -- routes through the exact
    /// same deploy+genesis-insert path as `create_account_v2`, using a
    /// DETERMINISTIC DUMMY commitment (`dummy_commitment`) instead of a real
    /// one. This is the anonymity-set property (M2 Task 5): every account
    /// this factory creates gets exactly one genesis leaf inserted into the
    /// recovery pool, atomically with its own deployment, whether or not its
    /// owner actually enrolled in ZK recovery -- so an observer of the pool
    /// (or of the factory's transaction shapes) cannot distinguish an
    /// enrolled account from a non-enrolled one.
    pub fn create_account(e: &Env, salt: &BytesN<32>, key: BytesN<65>) -> Address {
        let dummy = Self::dummy_commitment(e, salt);
        Self::deploy_and_insert(e, salt, key.to_bytes(), dummy)
    }

    /// Deploy an account contract, add its initial passkey signer, AND
    /// insert `commitment` as its genesis leaf in the recovery pool --
    /// atomically with the deploy, in the same transaction (M2 Task 5). If
    /// the insert fails (pool unresolvable, tree full, wrong `commitment`,
    /// ...) the whole call reverts, so there is never an account without a
    /// leaf, nor a leaf without an account. Returns the deployed account's
    /// address, which is always `get_c_address(salt)` -- the deterministic
    /// address depends only on the deployer (this factory) and `salt`, never
    /// on the constructor args or the genesis insert added here.
    pub fn create_account_v2(
        e: &Env,
        salt: &BytesN<32>,
        key: BytesN<65>,
        commitment: BytesN<32>,
    ) -> Address {
        Self::deploy_and_insert(e, salt, key.to_bytes(), commitment)
    }

    pub fn get_c_address(e: &Env, salt: &BytesN<32>) -> Address {
        Self::deployer(e, salt).deployed_address()
    }

    fn deployer(e: &Env, salt: &BytesN<32>) -> DeployerWithAddress {
        e.deployer().with_current_contract(salt.clone())
    }

    /// Builds the `Symbol` cache key for `resolve`'s instance-storage cache.
    /// Registry names may contain `-` (e.g. `"zk-recovery"`), which `Symbol`
    /// rejects (its charset is `[a-zA-Z0-9_]` only, no hyphen) -- this maps
    /// `-` -> `_` for the CACHE KEY ONLY; the registry lookup itself still
    /// uses `name` unchanged (`fetch_contract_id` takes a plain `String`, no
    /// charset restriction), so this changes nothing about which name is
    /// resolved, only what the resulting address is cached under. No `alloc`
    /// needed (this crate is `#![no_std]`): names are short static literals,
    /// comfortably under the 32-byte stack buffer.
    fn cache_key(env: &Env, name: &str) -> Symbol {
        const MAX: usize = 32;
        let bytes = name.as_bytes();
        assert!(bytes.len() <= MAX, "resolve() name too long for cache key");
        let mut buf = [0u8; MAX];
        for (i, &b) in bytes.iter().enumerate() {
            buf[i] = if b == b'-' { b'_' } else { b };
        }
        let s = core::str::from_utf8(&buf[..bytes.len()])
            .unwrap_or_else(|_| panic!("resolve() name must be valid UTF-8"));
        Symbol::new(env, s)
    }

    fn resolve(env: &Env, name: &str) -> Address {
        let key = Self::cache_key(env, name);
        if let Some(addr) = env.storage().instance().get::<_, Address>(&key) {
            return addr;
        }
        let client = registry::RegistryClient::new(env, &Address::from_str(env, REGISTRY));
        let addr = client.fetch_contract_id(&String::from_str(env, name));
        env.storage().instance().set(&key, &addr);
        addr
    }

    /// Deploys the account contract at `get_c_address(salt)`, installing the
    /// resolved recovery controller as its recovery rule. Returns
    /// `(account_address, recovery_controller_address)` so callers can
    /// immediately cross-call the controller's genesis `insert` (M2 Task 5)
    /// without re-resolving "zk-recovery" a second time.
    fn deploy_account_contract(e: &Env, salt: &BytesN<32>, key: Bytes) -> (Address, Address) {
        let verifier_addr = Self::resolve(e, "verifier");
        let signer = Signer::External(verifier_addr, key);
        let signers = soroban_sdk::vec![e, signer];
        let policies: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> =
            soroban_sdk::Map::new(e);
        // Production deploys always install the M1 zk-recovery controller as
        // the account's recovery rule policy (uniform across the anonymity
        // set) — resolved the same cached way as "verifier".
        let recovery_controller = Self::resolve(e, "zk-recovery");
        let account = Self::deployer(e, salt).deploy_v2(
            Self::account_wasm_hash(e),
            (&signers, &policies, &Some(recovery_controller.clone())),
        );
        (account, recovery_controller)
    }

    /// Shared tail of `create_account`/`create_account_v2` (M2 Task 5):
    /// deploy the account contract, then -- in the SAME transaction --
    /// cross-call the resolved recovery controller's genesis `insert` to
    /// bind `commitment` to the freshly deployed account. `insert` requires
    /// the pool's configured `factory` to authorize; since this factory
    /// contract is the direct caller, that auth is satisfied via "invoker
    /// contract auth" (no signature needed) as long as the pool was
    /// configured with THIS factory's address. If the insert fails for any
    /// reason (wrong factory configured, non-canonical commitment, tree
    /// full, ...) the whole call -- including the just-deployed account --
    /// reverts atomically: there is never an account without a leaf.
    fn deploy_and_insert(
        e: &Env,
        salt: &BytesN<32>,
        key: Bytes,
        commitment: BytesN<32>,
    ) -> Address {
        let (account, controller) = Self::deploy_account_contract(e, salt, key);
        zk_recovery::ZkRecoveryClient::new(e, &controller).insert(&account, &commitment);
        account
    }

    /// The BN254 scalar field order `r`, identical to
    /// `contracts/zk-recovery/src/pool.rs::FIELD_ORDER_BE` -- duplicated
    /// here (rather than imported) for the same reason
    /// `zk_recovery::ZkRecoveryInterface` above is a local stub trait rather
    /// than a real dependency on `nido-zk-recovery`: this crate must not
    /// link that crate's `#[contract]` exports into its own cdylib. Value:
    /// `21888242871839275222246405745257275088548364400416034343698204186575808495617`.
    const DUMMY_FIELD_ORDER_BE: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00,
        0x00, 0x01,
    ];

    /// Deterministic dummy commitment for the legacy `create_account` path
    /// (M2 Task 5): `sha256("nido-zk-dummy" || salt) mod r`. Reducing mod
    /// `r` (rather than rejecting like the pool's own `require_canonical`
    /// does for real commitments) guarantees this always lands as a
    /// canonical `< r` value the pool accepts, without ever needing the
    /// caller to retry -- there is no security property riding on this
    /// value's exact bits, only that it is present, canonical, and
    /// indistinguishable in shape from a real commitment.
    fn dummy_commitment(e: &Env, salt: &BytesN<32>) -> BytesN<32> {
        let mut preimage = Bytes::from_slice(e, b"nido-zk-dummy");
        preimage.extend_from_array(&salt.to_array());
        let digest = e.crypto().sha256(&preimage).to_bytes();
        let value = U256::from_be_bytes(e, &Bytes::from_array(e, &digest.to_array()));
        let field_order =
            U256::from_be_bytes(e, &Bytes::from_array(e, &Self::DUMMY_FIELD_ORDER_BE));
        let reduced = value.rem_euclid(&field_order);
        let mut out = [0u8; 32];
        reduced.to_be_bytes().copy_into_slice(&mut out);
        BytesN::from_array(e, &out)
    }

    /// SHA-256 of the embedded smart-account wasm — equal to the installed
    /// wasm hash that `deploy_v2` expects. Derived from `smart_account::WASM`
    /// (embedded at build time) so it tracks the wasm automatically instead of
    /// a hand-maintained constant.
    ///
    /// Hashing the full ~33 KB wasm inside the host is not free, so the result
    /// is cached in instance storage (`Config::account`) and computed only on
    /// the first call. Subsequent `create_account` calls read the cached value.
    fn account_wasm_hash(e: &Env) -> BytesN<32> {
        if let Some(cached) = Config::get_account(e) {
            return cached;
        }
        let hash = Self::compute_account_wasm_hash(e);
        Config::set_account(e, &hash);
        hash
    }

    /// Freshly compute `sha256(smart_account::WASM)` without consulting the
    /// cache. Used to populate the cache and as the source of truth in tests.
    fn compute_account_wasm_hash(e: &Env) -> BytesN<32> {
        e.crypto()
            .sha256(&Bytes::from_slice(e, smart_account::WASM))
            .to_bytes()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::auth::Context;
    use soroban_sdk::testutils::{Address as _, Events as _};
    use soroban_sdk::{
        contract, contractclient, contractimpl, contracttype, Env, Event, IntoVal, TryFromVal,
    };
    use stellar_accounts::policies::Policy;
    use stellar_accounts::smart_account::ContextRule;

    // Minimal mock: every `fetch_contract_id` call returns a fixed address.
    #[contract]
    struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        pub fn __constructor(env: &Env, fixed: Address) {
            env.storage()
                .instance()
                .set(&Symbol::new(env, "fixed"), &fixed);
        }
        pub fn fetch_contract_id(env: &Env, _name: String) -> Address {
            env.storage()
                .instance()
                .get::<_, Address>(&Symbol::new(env, "fixed"))
                .unwrap()
        }
    }

    /// Install-param shape matching `nido_zk_recovery::types::
    /// ZkRecoveryInstallParams` structurally (a single `version: u32` field)
    /// without adding a real dependency on that crate here — `#[contracttype]`
    /// structs encode purely by field name/order on the ledger, so this
    /// decodes identically to the real type's `Val`.
    #[contracttype]
    #[derive(Clone)]
    struct StubInstallParams {
        pub version: u32,
    }

    /// Minimal stub implementing OZ's `Policy`, standing in for the real
    /// `nido-zk-recovery` controller so `deploy_account_contract`'s
    /// `add_context_rule` cross-call into `Policy::install` has somewhere
    /// real to land. ALSO doubles as the "verifier" `fetch_contract_id`
    /// result in `get_c_address_unaffected_by_recovery_controller_arg` below
    /// -- registering an `External` signer (the Default rule's passkey
    /// signer) cross-calls the verifier's `batch_canonicalize_key`
    /// (`stellar-accounts` `storage.rs::validate_no_canonical_duplicates`),
    /// so this contract implements that entry point too (trivially, via the
    /// inherent-method `impl` block below -- not the real `Verifier` trait,
    /// which needs an associated `KeyData`/`SigData` type this test doesn't
    /// care about). ALSO stands in for the pool's genesis `insert` (M2 Task
    /// 5): `deploy_and_insert` now cross-calls it unconditionally, so this
    /// trivial `insert` (below, no auth/canonicality checks -- this test
    /// doesn't exercise pool security, only the deterministic-address
    /// invariant) gives that cross-call somewhere real to land too.
    #[contract]
    struct StubController;

    #[contractimpl]
    impl Policy for StubController {
        type AccountParams = StubInstallParams;

        fn install(
            _e: &Env,
            _install_params: Self::AccountParams,
            _context_rule: ContextRule,
            smart_account: Address,
        ) {
            smart_account.require_auth();
        }

        fn enforce(
            _e: &Env,
            _context: Context,
            _authenticated_signers: soroban_sdk::Vec<stellar_accounts::smart_account::Signer>,
            _context_rule: ContextRule,
            smart_account: Address,
        ) {
            smart_account.require_auth();
        }

        fn uninstall(_e: &Env, _context_rule: ContextRule, smart_account: Address) {
            smart_account.require_auth();
        }
    }

    #[contractimpl]
    impl StubController {
        /// Trivial "canonicalization": returns the raw key bytes unchanged.
        /// Good enough for a single-signer registration (this test's Default
        /// rule has exactly one signer, so `validate_no_canonical_duplicates`
        /// never compares two canonical outputs against each other).
        pub fn batch_canonicalize_key(
            e: &Env,
            key_data: soroban_sdk::Vec<soroban_sdk::Val>,
        ) -> soroban_sdk::Vec<Bytes> {
            let mut out = soroban_sdk::Vec::new(e);
            for k in key_data.iter() {
                out.push_back(Bytes::try_from_val(e, &k).unwrap_or_else(|_| Bytes::new(e)));
            }
            out
        }

        /// Trivial genesis-insert stub: no factory auth check, no
        /// canonicality check, no actual Merkle pool. Just gives
        /// `deploy_and_insert`'s `ZkRecoveryClient::insert` cross-call
        /// somewhere real to land in tests that don't care about pool
        /// security (see the `insert`-specific tests below for that).
        pub fn insert(_e: &Env, _account: Address, _commitment: BytesN<32>) -> u32 {
            0
        }
    }

    #[test]
    fn resolve_caches_after_first_lookup() {
        let env = Env::default();
        env.mock_all_auths();

        // Deploy MockRegistry at the exact address `REGISTRY` points at so
        // the factory's hardcoded constant resolves to the mock during the
        // test.
        let registry_addr = Address::from_str(&env, REGISTRY);
        let expected = Address::generate(&env);
        env.register_at(&registry_addr, MockRegistry, (expected.clone(),));

        let admin = Address::generate(&env);
        let factory_addr = env.register(Contract, (admin,));
        let first = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        let second = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        assert_eq!(first, expected);
        assert_eq!(first, second);
    }

    #[test]
    fn get_c_address_uses_random_salt() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let factory_addr = env.register(Contract, (admin,));
        let salt_a = BytesN::from_array(&env, &[1; 32]);
        let salt_b = BytesN::from_array(&env, &[2; 32]);

        let first = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt_a));
        let second = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt_b));
        let first_again = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt_a));

        assert_ne!(first, second);
        assert_eq!(first, first_again);
    }

    /// The deterministic-address invariant: threading the new
    /// `recovery_controller` argument through `deploy_account_contract` into
    /// the smart-account constructor must NOT change the deployer-derived
    /// address. `get_c_address` (== `deployed_address()`) is a pure function
    /// of deployer + salt + wasm-hash, computed before the constructor ever
    /// runs, so it must equal the address `create_account` (which now passes
    /// a resolved `Some(controller)`) actually deploys to.
    #[test]
    fn get_c_address_unaffected_by_recovery_controller_arg() {
        let env = Env::default();
        env.mock_all_auths();

        // "verifier" and "zk-recovery" both resolve to the same stub
        // controller (a real `Policy` implementer, so the constructor's
        // `add_context_rule` -> `Policy::install` cross-call has somewhere
        // real to land; never actually invoked as a verifier here).
        let controller_addr = env.register(StubController, ());

        // Install the embedded smart-account wasm on-chain at its own
        // sha256, mirroring `account_wasm_hash_equals_uploaded_wasm_hash` --
        // `deploy_v2` needs the wasm actually installed at the hash
        // `account_wasm_hash` derives, which the real deploy script (not
        // this unit test) is normally responsible for.
        env.deployer().upload_contract_wasm(smart_account::WASM);

        let registry_addr = Address::from_str(&env, REGISTRY);
        env.register_at(&registry_addr, MockRegistry, (controller_addr.clone(),));

        let admin = Address::generate(&env);
        let factory_addr = env.register(Contract, (admin,));
        let salt = BytesN::from_array(&env, &[9; 32]);
        let key = BytesN::from_array(&env, &[3; 65]);

        let predicted = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt));
        let deployed =
            env.as_contract(&factory_addr, || Contract::create_account(&env, &salt, key));

        assert_eq!(
            predicted, deployed,
            "recovery_controller ctor arg must not affect the deployer-derived address"
        );
    }

    /// The property that actually matters: the hash the factory hands to
    /// `deploy_v2` must equal the hash the host assigns when the *same* bytes
    /// are installed/uploaded on-chain. `upload_contract_wasm` returns exactly
    /// the hash `deploy_v2` later demands, so proving they're equal proves the
    /// embedded wasm will resolve at deploy time (not just that we recomputed
    /// our own function body).
    #[test]
    fn account_wasm_hash_equals_uploaded_wasm_hash() {
        let env = Env::default();
        env.mock_all_auths();

        // The embedded wasm is staged by build.rs and must be non-empty
        // (catches a mis-staged / empty file).
        assert!(
            !smart_account::WASM.is_empty(),
            "embedded smart-account wasm is empty"
        );

        // Hash the host assigns when these exact bytes are installed on-chain —
        // i.e. the hash `deploy_v2` will look up.
        let uploaded = env.deployer().upload_contract_wasm(smart_account::WASM);

        // The admin arg is irrelevant here; this test only exercises the
        // wasm-hash derivation, but the constructor requires one.
        let factory_addr = env.register(Contract, (Address::generate(&env),));
        let derived = env.as_contract(&factory_addr, || Contract::account_wasm_hash(&env));

        assert_eq!(
            derived, uploaded,
            "factory deploy hash must match the installed-wasm hash"
        );
        assert_eq!(derived.to_array().len(), 32);
    }

    /// The cached hash (read back from instance storage on the second call)
    /// must equal the freshly-computed hash. Guards the lazy-cache path added
    /// to avoid rehashing the ~33 KB wasm on every `create_account`.
    #[test]
    fn account_wasm_hash_caches_first_computation() {
        let env = Env::default();
        env.mock_all_auths();
        // The admin arg is irrelevant here; this test only exercises the
        // wasm-hash cache, but the constructor requires one.
        let factory_addr = env.register(Contract, (Address::generate(&env),));

        env.as_contract(&factory_addr, || {
            // Nothing cached yet.
            assert!(Config::get_account(&env).is_none());

            let fresh = Contract::compute_account_wasm_hash(&env);

            // First call computes and caches.
            let first = Contract::account_wasm_hash(&env);
            assert_eq!(first, fresh);
            assert_eq!(Config::get_account(&env), Some(fresh.clone()));

            // Second call reads the cache and returns the identical value.
            let second = Contract::account_wasm_hash(&env);
            assert_eq!(second, fresh);
        });
    }

    /// The admin passed to `__constructor` is stored and returned by `admin`.
    /// (`mock_all_auths` is needed because the constructor registers the XLM
    /// SAC and mints, which requires auth.)
    #[test]
    fn admin_is_set_at_construct_time() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(Contract, (admin.clone(),));
        let client = ContractClient::new(&env, &id);
        assert_eq!(client.admin(), admin);
    }

    /// `set_admin` rotates the admin (requires the current admin's auth).
    #[test]
    fn set_admin_rotates_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let id = env.register(Contract, (admin.clone(),));
        let client = ContractClient::new(&env, &id);

        client.set_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);
    }

    /// `set_admin` requires the current admin's authorization. With auth
    /// cleared the call must fail.
    #[test]
    fn set_admin_requires_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let id = env.register(Contract, (admin.clone(),));
        let client = ContractClient::new(&env, &id);

        // Clear all authorizations: the require_auth on the current admin
        // must now reject, and the admin must be unchanged.
        env.set_auths(&[]);
        assert!(client.try_set_admin(&new_admin).is_err());
        assert_eq!(client.admin(), admin);
    }

    /// `set_admin` checks the *current* admin specifically — auth from a
    /// non-admin address is not sufficient.
    #[test]
    fn set_admin_requires_current_admin_auth() {
        use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};

        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let imposter = Address::generate(&env);
        let new_admin = Address::generate(&env);
        let id = env.register(Contract, (admin.clone(),));
        let client = ContractClient::new(&env, &id);

        // Only the imposter authorizes — the contract requires `admin`.
        let res = client
            .mock_auths(&[MockAuth {
                address: &imposter,
                invoke: &MockAuthInvoke {
                    contract: &id,
                    fn_name: "set_admin",
                    args: (new_admin.clone(),).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .try_set_admin(&new_admin);
        assert!(res.is_err());
        assert_eq!(client.admin(), admin);
    }

    /// `upgrade` requires admin auth and (with auth mocked + an installed wasm)
    /// succeeds. We install the embedded smart-account wasm to obtain a valid,
    /// already-uploaded wasm hash for `update_current_contract_wasm`.
    #[test]
    fn upgrade_requires_admin_auth_and_succeeds() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(Contract, (admin.clone(),));
        let client = ContractClient::new(&env, &id);

        // A valid, installed wasm hash for the host to upgrade to.
        let wasm_hash = env
            .deployer()
            .upload_contract_wasm(Bytes::from_slice(&env, smart_account::WASM));

        // With auth cleared the upgrade is rejected.
        env.set_auths(&[]);
        assert!(client.try_upgrade(&wasm_hash).is_err());

        // With the admin's auth mocked it goes through.
        env.mock_all_auths();
        client.upgrade(&wasm_hash);
    }

    // ---------------------------------------------------------------------
    // M2 Task 5: factory genesis-insert tests. These deploy a REAL
    // `nido-zk-recovery` pool/controller (a dev-dependency, see
    // `Cargo.toml`'s note) rather than a stub, so assertions can check the
    // pool's actual `next_index`/`LeafInserted` event/`wrap_leaf` output --
    // not just that some cross-call landed somewhere.
    // ---------------------------------------------------------------------

    /// Name-aware mock registry: `"verifier"` resolves to `verifier`;
    /// anything else (in practice only `"zk-recovery"`) resolves to
    /// `zk_recovery`. Needed because the tests below (unlike the earlier
    /// ones) require TWO DIFFERENT resolved addresses in the same test.
    #[contract]
    struct NamedRegistry;

    #[contractimpl]
    impl NamedRegistry {
        pub fn __constructor(env: &Env, verifier: Address, zk_recovery: Address) {
            env.storage()
                .instance()
                .set(&Symbol::new(env, "verifier"), &verifier);
            env.storage()
                .instance()
                .set(&Symbol::new(env, "zk_recovery"), &zk_recovery);
        }

        pub fn fetch_contract_id(env: &Env, name: String) -> Address {
            if name == String::from_str(env, "verifier") {
                env.storage()
                    .instance()
                    .get::<_, Address>(&Symbol::new(env, "verifier"))
                    .unwrap()
            } else {
                env.storage()
                    .instance()
                    .get::<_, Address>(&Symbol::new(env, "zk_recovery"))
                    .unwrap()
            }
        }
    }

    /// Minimal probe client for the smart account's `recovery_rule_id` view
    /// (`contracts/smart-account/src/contract.rs`), used only to prove "no
    /// contract landed at this address" in the atomicity test below: calling
    /// ANY entry point against an address with no contract deployed fails.
    #[contractclient(name = "ProbeClient")]
    trait Probe {
        fn recovery_rule_id(e: Env) -> Option<u32>;
    }

    /// Deploys a factory + a REAL `nido-zk-recovery` pool/controller,
    /// registered under `"zk-recovery"`, alongside a trivial `"verifier"`
    /// stub (`StubController`, reused purely for its
    /// `batch_canonicalize_key`). The pool's configured `factory` authority
    /// is the deployed factory's own address UNLESS `wrong_factory` is
    /// `true`, in which case it's an unrelated generated address -- used by
    /// the atomicity test to prove `insert`'s factory-auth check actually
    /// gates the genesis insert (rather than everything just being mocked
    /// through). No `mock_all_auths()`/`mock_auths` is used anywhere in this
    /// block of tests: every real auth check along the deploy+insert path
    /// (the recovery policy's `install`, the pool's genesis `insert`) is
    /// satisfied purely via "invoker contract auth" (the direct caller IS
    /// the address being auth'd), exactly as it will be on a real network --
    /// so these tests double as proof that no signature/mock is needed for
    /// the happy path, and that the auth check is real (not vacuously
    /// mocked-through) in the failure path.
    ///
    /// Returns `(factory_addr, pool_addr)`.
    fn setup_factory_and_pool(env: &Env, wrong_factory: bool) -> (Address, Address) {
        let admin = Address::generate(env);
        let factory_addr = env.register(Contract, (admin,));

        let configured_factory = if wrong_factory {
            Address::generate(env)
        } else {
            factory_addr.clone()
        };

        // The pool's OWN "verifier" (for real recovery proofs, unrelated to
        // the smart-account's passkey verifier below) and webauthn verifier
        // are never exercised by `insert` -- placeholder addresses suffice.
        let pool_proof_verifier = Address::generate(env);
        let webauthn_verifier = Address::generate(env);
        let network_passphrase = Bytes::from_slice(env, b"Test SDF Network ; September 2015");
        let pool_addr = env.register(
            nido_zk_recovery::pool::ZkRecovery,
            (
                configured_factory,
                pool_proof_verifier,
                3u64 * 24 * 3600,
                7u64 * 24 * 3600,
                3u32,
                24u64 * 3600,
                network_passphrase,
                webauthn_verifier,
            ),
        );

        let verifier_stub = env.register(StubController, ());
        let registry_addr = Address::from_str(env, REGISTRY);
        env.register_at(
            &registry_addr,
            NamedRegistry,
            (verifier_stub, pool_addr.clone()),
        );

        env.deployer().upload_contract_wasm(smart_account::WASM);

        (factory_addr, pool_addr)
    }

    /// A canonical (`< r`) 32-byte commitment with the given low byte --
    /// trivially satisfies `require_canonical` for any test that just needs
    /// *some* valid, distinguishable real commitment.
    fn small_commitment(env: &Env, low_byte: u8) -> BytesN<32> {
        let mut bytes = [0u8; 32];
        bytes[31] = low_byte;
        BytesN::from_array(env, &bytes)
    }

    /// `create_account_v2` deploys to `get_c_address(salt)`, and -- in the
    /// SAME transaction -- inserts `wrap_leaf(account, commitment)` as the
    /// pool's genesis leaf (index 0, `next_index` now `1`).
    #[test]
    fn create_account_v2_inserts_real_genesis_leaf_at_deterministic_address() {
        let env = Env::default();
        let (factory_addr, pool_addr) = setup_factory_and_pool(&env, false);
        let client = ContractClient::new(&env, &factory_addr);
        let pool_client = nido_zk_recovery::pool::ZkRecoveryClient::new(&env, &pool_addr);

        let salt = BytesN::from_array(&env, &[11; 32]);
        let key = BytesN::from_array(&env, &[4; 65]);
        let commitment = small_commitment(&env, 42);

        let predicted = client.get_c_address(&salt);
        let account = client.create_account_v2(&salt, &key, &commitment);

        // Captured immediately after the call under test -- `Env::events()`
        // reflects only the MOST RECENT top-level invocation, so any
        // further client calls (`next_index`, `is_known_root`, ...) below
        // would otherwise clobber it before we get to inspect it.
        let pool_events = env.events().all().filter_by_contract(&pool_addr);

        assert_eq!(
            account, predicted,
            "create_account_v2 must deploy to get_c_address(salt) -- the commitment/insert \
             must not affect the deployer-derived address"
        );
        assert_eq!(pool_client.next_index(), 1);

        let expected_leaf = nido_zk_recovery::hash::wrap_leaf(&env, &account, &commitment);
        let expected_event = nido_zk_recovery::types::LeafInserted {
            index: &0,
            leaf: &expected_leaf,
        };
        assert_eq!(
            pool_events,
            [expected_event.to_xdr(&env, &pool_addr)],
            "create_account_v2 must insert wrap_leaf(account, real commitment) as the \
             genesis leaf"
        );
        assert!(pool_client.is_known_root(&pool_client.current_root()));
    }

    /// Legacy `create_account` routes through the exact same deploy+insert
    /// path, but with the deterministic DUMMY commitment
    /// (`sha256("nido-zk-dummy" || salt) mod r`) instead of a caller-supplied
    /// real one. Same shape: deploys to `get_c_address(salt)`, inserts
    /// exactly one genesis leaf.
    #[test]
    fn create_account_inserts_dummy_genesis_leaf_at_deterministic_address() {
        let env = Env::default();
        let (factory_addr, pool_addr) = setup_factory_and_pool(&env, false);
        let client = ContractClient::new(&env, &factory_addr);
        let pool_client = nido_zk_recovery::pool::ZkRecoveryClient::new(&env, &pool_addr);

        let salt = BytesN::from_array(&env, &[12; 32]);
        let key = BytesN::from_array(&env, &[5; 65]);

        let predicted = client.get_c_address(&salt);
        let account = client.create_account(&salt, &key);

        // Captured immediately -- see the note in the `create_account_v2`
        // test above on why this must happen before any further client call.
        let pool_events = env.events().all().filter_by_contract(&pool_addr);

        assert_eq!(
            account, predicted,
            "legacy create_account must still deploy to get_c_address(salt)"
        );
        assert_eq!(pool_client.next_index(), 1);

        let dummy = Contract::dummy_commitment(&env, &salt);
        let field_order = U256::from_be_bytes(
            &env,
            &Bytes::from_array(&env, &Contract::DUMMY_FIELD_ORDER_BE),
        );
        let dummy_value = U256::from_be_bytes(&env, &Bytes::from_array(&env, &dummy.to_array()));
        assert!(
            dummy_value < field_order,
            "dummy commitment must be canonical (< r), or the real pool would reject it"
        );

        let expected_leaf = nido_zk_recovery::hash::wrap_leaf(&env, &account, &dummy);
        let expected_event = nido_zk_recovery::types::LeafInserted {
            index: &0,
            leaf: &expected_leaf,
        };
        assert_eq!(
            pool_events,
            [expected_event.to_xdr(&env, &pool_addr)],
            "legacy create_account must insert wrap_leaf(account, dummy) as the genesis leaf"
        );
    }

    /// `dummy_commitment` is a pure function of `salt`: deterministic for
    /// the same salt, different across salts, and always canonical (`< r`)
    /// -- checked directly, independent of any deploy.
    #[test]
    fn dummy_commitment_is_canonical_and_deterministic() {
        let env = Env::default();
        let salt_a = BytesN::from_array(&env, &[1; 32]);
        let salt_b = BytesN::from_array(&env, &[2; 32]);

        let a1 = Contract::dummy_commitment(&env, &salt_a);
        let a2 = Contract::dummy_commitment(&env, &salt_a);
        let b = Contract::dummy_commitment(&env, &salt_b);

        assert_eq!(
            a1, a2,
            "dummy_commitment must be deterministic for the same salt"
        );
        assert_ne!(
            a1, b,
            "dummy_commitment must differ across salts (salt is part of the sha256 preimage)"
        );

        let field_order = U256::from_be_bytes(
            &env,
            &Bytes::from_array(&env, &Contract::DUMMY_FIELD_ORDER_BE),
        );
        for d in [&a1, &b] {
            let value = U256::from_be_bytes(&env, &Bytes::from_array(&env, &d.to_array()));
            assert!(
                value < field_order,
                "dummy commitment must be canonical (< r)"
            );
        }
    }

    /// Byte-shape uniformity (M2 Task 5's whole point): `create_account`
    /// (dummy) and `create_account_v2` (real) both deploy an account and
    /// insert EXACTLY one genesis leaf via the identical `wrap_leaf(account,
    /// commitment)` construction -- the only thing that differs between the
    /// two calls is the 32-byte commitment value itself, not the shape of
    /// what happens on-chain (one deploy, one insert, one `LeafInserted`
    /// event each).
    #[test]
    fn create_account_and_create_account_v2_are_uniform_except_commitment() {
        let env = Env::default();
        let (factory_addr, pool_addr) = setup_factory_and_pool(&env, false);
        let client = ContractClient::new(&env, &factory_addr);

        let salt_dummy = BytesN::from_array(&env, &[21; 32]);
        let key_dummy = BytesN::from_array(&env, &[7; 65]);
        let salt_real = BytesN::from_array(&env, &[22; 32]);
        let key_real = BytesN::from_array(&env, &[8; 65]);
        let real_commitment = small_commitment(&env, 99);

        // Each call's events are captured immediately, before the next
        // top-level client call -- `Env::events()` reflects only the most
        // recent invocation (see the note in the tests above).
        let dummy_account = client.create_account(&salt_dummy, &key_dummy);
        let dummy_events = env.events().all().filter_by_contract(&pool_addr);

        let real_account = client.create_account_v2(&salt_real, &key_real, &real_commitment);
        let real_events = env.events().all().filter_by_contract(&pool_addr);

        let dummy_commitment = Contract::dummy_commitment(&env, &salt_dummy);
        let dummy_leaf = nido_zk_recovery::hash::wrap_leaf(&env, &dummy_account, &dummy_commitment);
        let real_leaf = nido_zk_recovery::hash::wrap_leaf(&env, &real_account, &real_commitment);

        assert_eq!(
            dummy_events,
            [nido_zk_recovery::types::LeafInserted {
                index: &0,
                leaf: &dummy_leaf,
            }
            .to_xdr(&env, &pool_addr)],
            "create_account (dummy) must emit exactly one LeafInserted event, shaped \
             identically to create_account_v2's"
        );
        assert_eq!(
            real_events,
            [nido_zk_recovery::types::LeafInserted {
                index: &1,
                leaf: &real_leaf,
            }
            .to_xdr(&env, &pool_addr)],
            "create_account_v2 (real) must emit exactly one LeafInserted event, shaped \
             identically to create_account's -- the only difference between the two \
             calls' effect on the pool is the commitment byte value inside `leaf`"
        );
    }

    /// Atomicity: if the pool is configured with a DIFFERENT factory than
    /// the one actually calling it, the genesis `insert`'s
    /// `config.factory.require_auth()` fails (no invoker-auth match, no
    /// mocked signature) -- and because that failure happens inside the
    /// SAME top-level `create_account` invocation as the account deploy,
    /// the WHOLE call reverts: no account is left behind at
    /// `get_c_address(salt)` either.
    #[test]
    fn create_account_reverts_atomically_when_pool_factory_mismatched() {
        let env = Env::default();
        let (factory_addr, _pool_addr) = setup_factory_and_pool(&env, true);
        let client = ContractClient::new(&env, &factory_addr);

        let salt = BytesN::from_array(&env, &[13; 32]);
        let key = BytesN::from_array(&env, &[6; 65]);
        let predicted = client.get_c_address(&salt);

        let result = client.try_create_account(&salt, &key);
        assert!(
            result.is_err(),
            "create_account must revert when the pool's configured factory != this factory"
        );

        // No contract landed at the predicted address: any cross-call into
        // it fails.
        let probe = ProbeClient::new(&env, &predicted);
        assert!(
            probe.try_recovery_rule_id().is_err(),
            "no account should be deployed at get_c_address(salt) after the reverted call"
        );
    }
}
