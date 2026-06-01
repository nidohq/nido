use soroban_sdk::{
    contract, contractimpl, deploy::DeployerWithAddress, Address, Bytes, BytesN, Env, String,
    Symbol,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

use crate::xlm;

mod smart_account {
    //! Embeds the smart-account contract wasm so the factory no longer
    //! hardcodes its wasm hash. The mechanism:
    //!
    //!  1. `build.rs` stages the `just build-contracts` output
    //!     (`g2c_smart_account.wasm`) and emits `STELLAR_ACCOUNT_WASM` pointing
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
        xlm::register(e, &e.current_contract_address());
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

    ///Deploy an account contract and add a passkey to it. Lastly transfer funds to the contract's account.
    ///
    pub fn create_account(e: &Env, funder: &Address, key: BytesN<65>, amount: &i128) -> Address {
        funder.require_auth();
        let new_account = Self::deploy_account_contract(e, funder, key.to_bytes());
        let xlm_sac = xlm::stellar_asset_client(e);
        xlm_sac.transfer(funder, &new_account, amount);
        new_account
    }

    pub fn get_c_address(e: &Env, funder: &Address) -> Address {
        Self::deployer(e, funder).deployed_address()
    }

    fn deployer(e: &Env, funder: &Address) -> DeployerWithAddress {
        e.deployer()
            .with_address(funder.clone(), BytesN::from_array(e, &[0; 32]))
    }

    fn resolve(env: &Env, name: &str) -> Address {
        let key = Symbol::new(env, name);
        if let Some(addr) = env.storage().instance().get::<_, Address>(&key) {
            return addr;
        }
        let client = registry::RegistryClient::new(env, &Address::from_str(env, REGISTRY));
        let addr = client.fetch_contract_id(&String::from_str(env, name));
        env.storage().instance().set(&key, &addr);
        addr
    }

    fn deploy_account_contract(e: &Env, funder: &Address, key: Bytes) -> Address {
        let verifier_addr = Self::resolve(e, "verifier");
        let signer = Signer::External(verifier_addr, key);
        let signers = soroban_sdk::vec![e, signer];
        let policies: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> =
            soroban_sdk::Map::new(e);
        Self::deployer(e, funder).deploy_v2(Self::account_wasm_hash(e), (&signers, &policies))
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
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, Env, IntoVal};

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
}
