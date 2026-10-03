use admin_sep::{Administratable, Upgradable};
use soroban_sdk::{
    contract, contractimpl, deploy::DeployerWithAddress, Address, Bytes, BytesN, Env, String,
    Symbol,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

// The factory defines no custom error type. A pinned name is resolved
// directly from the pin without consulting the registry (`Self::resolve`),
// so there is no "registry disagrees with the pin" condition to report. The
// remaining failure modes (an unresolvable registry name for an unpinned
// name, a reused salt) surface as the registry's or the host's own errors.

mod perch_account {
    //! Embeds Perch's smart-account wasm (`perch-account`, the deployed bytes
    //! `just perch-infra` fetches by the manifest's hash) so the factory derives
    //! the deploy hash from the bytes instead of hardcoding it:
    //!
    //!  1. `build.rs` stages `target/wasm32v1-none/contract/perch_account.wasm`
    //!     and emits `PERCH_ACCOUNT_WASM` pointing at it.
    //!  2. `include_bytes!(env!("PERCH_ACCOUNT_WASM"))` embeds those bytes.
    //!  3. At runtime the factory computes `sha256(WASM)` (see
    //!     `super::Contract::account_wasm_hash`) and deploys that hash.
    //!
    //! For `deploy_v2` to resolve, the same bytes must already be installed
    //! on-chain. Once Perch's release workstream publishes the account wasm,
    //! this embed is checked against the published hash instead of a local
    //! build.

    /// Raw Perch account wasm, embedded at build time.
    pub const WASM: &[u8] = include_bytes!(env!("PERCH_ACCOUNT_WASM"));
}

/// Stellar Registry "unverified" testnet contract — the one that holds
/// bare-name → contract-id mappings. Calling `fetch_contract_id("verifier")`
/// on it returns the registered `WebAuthn` verifier; `resolve` below relies on
/// that for unpinned names.
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
    /// Cached `sha256(perch_account::WASM)`.
    account: InstanceItem<BytesN<32>>,
    // The upgrade `admin` is not stored here: admin/set_admin/upgrade come
    // from the shared `admin-sep` crate, which owns its own `ADMIN` key.
    /// Admin-pinned address for the `"verifier"` registry name. `None`
    /// (default) = unpinned: resolve from the registry and trust it. Once set
    /// (via `set_registry_pins`), `resolve("verifier")` returns this address
    /// directly and never consults the registry, so a repointed, broken, or
    /// unreachable registry can neither swap the passkey verifier under new
    /// accounts nor block their creation.
    pinned_verifier: InstanceItem<Address>,
}

#[contract]
pub struct Contract;

// admin/set_admin/upgrade come from the shared `admin-sep` crate
// (`Administratable` + `Upgradable`). This factory and the WebAuthn verifier
// move to Perch with its release workstream (stellar-registry/perch#99 WS4),
// which publishes them as constructorless, immutable infrastructure; until
// then the admin is the deployer, and only gates pins and factory upgrades.
// It has no authority over any deployed account.
#[contractimpl(contracttrait)]
impl Administratable for Contract {}

#[contractimpl(contracttrait)]
impl Upgradable for Contract {
    /// admin-sep's default, plus one load-bearing line: clear the cached
    /// account-wasm hash. An in-place upgrade swaps the embedded bytes; a
    /// surviving cache would make every later `create_account` deploy the old
    /// account wasm.
    fn upgrade(e: &soroban_sdk::Env, new_wasm_hash: BytesN<32>) {
        Self::admin(e).require_auth();
        Config::new(e).account.remove();
        e.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[contractimpl]
impl Contract {
    // `#[contractimpl]` entry point: the SDK's XDR-based ABI takes owned
    // `Address` by value. `set_admin` on first call (no admin yet) skips the
    // auth check.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(e: &Env, admin: Address) {
        Self::set_admin(e, admin);
    }

    /// Pin the `verifier` address. After this, every `create_account` uses
    /// exactly this `WebAuthn` verifier without consulting the registry, so a
    /// later registry repoint can neither reroute nor block new accounts.
    /// Requires the current admin's auth.
    // `#[contractimpl]` entry point; SDK ABI requires owned `Address`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_registry_pins(e: &Env, verifier: Address) {
        Self::admin(e).require_auth();
        Config::set_pinned_verifier(e, &verifier);
    }

    /// The pinned `verifier` address, or `None` if unpinned.
    pub fn pinned_verifier(e: &Env) -> Option<Address> {
        Config::get_pinned_verifier(e)
    }

    /// Deploy a Perch smart account at `get_c_address(salt)` whose
    /// constructor rule ("admin", scoped to the account itself) is the passkey
    /// `key`, checked by the `WebAuthn` verifier. Everything else — further
    /// signers, rules, and recovery — arrives through the account's first
    /// `apply_doc`.
    // `#[contractimpl]` entry point; SDK ABI requires owned `BytesN<65>`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create_account(e: &Env, salt: &BytesN<32>, key: BytesN<65>) -> Address {
        let verifier = Self::resolve(e, "verifier");
        let admin_signers = soroban_sdk::vec![e, Signer::External(verifier, key.to_bytes())];
        Self::deployer(e, salt).deploy_v2(Self::account_wasm_hash(e), (&admin_signers,))
    }

    pub fn get_c_address(e: &Env, salt: &BytesN<32>) -> Address {
        Self::deployer(e, salt).deployed_address()
    }

    /// Recompute and store the embedded account-wasm hash, returning it.
    /// Admin-gated companion to the `upgrade` override: after upgrading a
    /// factory whose old code predates that override, the stale cache
    /// survives (the upgrade transaction runs the old code); calling this once
    /// afterwards repairs it.
    pub fn refresh_account_wasm_hash(e: &Env) -> BytesN<32> {
        Self::admin(e).require_auth();
        let hash = Self::compute_account_wasm_hash(e);
        Config::set_account(e, &hash);
        hash
    }

    fn deployer(e: &Env, salt: &BytesN<32>) -> DeployerWithAddress {
        e.deployer().with_current_contract(salt.clone())
    }

    fn resolve(env: &Env, name: &str) -> Address {
        if let Some(pinned) = Self::pinned_for(env, name) {
            return pinned;
        }
        let key = Symbol::new(env, name);
        if let Some(addr) = env.storage().instance().get::<_, Address>(&key) {
            return addr;
        }
        let client = registry::RegistryClient::new(env, &Address::from_str(env, REGISTRY));
        let addr = client.fetch_contract_id(&String::from_str(env, name));
        env.storage().instance().set(&key, &addr);
        addr
    }

    /// The admin-pinned address for `name`, or `None` if unpinned. Only
    /// `"verifier"` is pinnable (the only name `resolve` looks up).
    fn pinned_for(env: &Env, name: &str) -> Option<Address> {
        match name {
            "verifier" => Config::get_pinned_verifier(env),
            _ => None,
        }
    }

    /// SHA-256 of the embedded account wasm — the installed hash `deploy_v2`
    /// expects. Cached in instance storage after the first call.
    fn account_wasm_hash(e: &Env) -> BytesN<32> {
        if let Some(cached) = Config::get_account(e) {
            return cached;
        }
        let hash = Self::compute_account_wasm_hash(e);
        Config::set_account(e, &hash);
        hash
    }

    /// Freshly compute `sha256(perch_account::WASM)` without the cache.
    fn compute_account_wasm_hash(e: &Env) -> BytesN<32> {
        e.crypto()
            .sha256(&Bytes::from_slice(e, perch_account::WASM))
            .to_bytes()
    }
}

#[cfg(test)]
mod test {
    // `#[contractimpl]`'s generated invoke wrappers bind every non-`Env`
    // param, which clippy counts as a use of the `_`-prefixed stub params.
    #![allow(clippy::used_underscore_binding)]

    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractclient, contractimpl, Env, IntoVal, TryFromVal};

    // Minimal mock: every `fetch_contract_id` call returns a fixed address.
    #[contract]
    struct MockRegistry;

    #[contractimpl]
    impl MockRegistry {
        // `#[contractimpl]` entry point; SDK ABI requires owned `Address`.
        #[allow(clippy::needless_pass_by_value)]
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

    /// A registry that panics on every lookup: proves a pinned name never
    /// reaches it.
    #[contract]
    struct PanicRegistry;

    #[contractimpl]
    impl PanicRegistry {
        pub fn fetch_contract_id(_env: &Env, _name: String) -> Address {
            panic!("registry consulted")
        }
    }

    /// Stands in for the `WebAuthn` verifier at account construction: OZ's
    /// `add_context_rule` canonicalizes every External signer's key through
    /// the verifier's `batch_canonicalize_key`.
    #[contract]
    struct StubVerifier;

    #[contractimpl]
    impl StubVerifier {
        // `#[contractimpl]` entry point; SDK ABI requires owned `Vec<Val>`.
        #[allow(clippy::needless_pass_by_value)]
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
    }

    /// The deployed account's read surface (Perch's `PerchSmartAccount`).
    #[contractclient(name = "AccountClient")]
    trait AccountReads {
        fn applied_doc_hash(e: Env) -> Option<BytesN<32>>;
        fn applied_doc(e: Env) -> Option<Bytes>;
        fn recovery_controller(e: Env) -> Option<Address>;
        fn get_context_rules_count(e: Env) -> u32;
        fn get_context_rule(e: Env, id: u32) -> stellar_accounts::smart_account::ContextRule;
    }

    /// A factory whose registry resolves `"verifier"` to a stub verifier,
    /// with the embedded account wasm installed.
    fn setup(env: &Env) -> (Address, Address) {
        env.mock_all_auths();
        let verifier = env.register(StubVerifier, ());
        env.register_at(
            &Address::from_str(env, REGISTRY),
            MockRegistry,
            (verifier.clone(),),
        );
        env.deployer().upload_contract_wasm(perch_account::WASM);
        let factory = env.register(Contract, (Address::generate(env),));
        (factory, verifier)
    }

    #[test]
    fn resolve_caches_after_first_lookup() {
        let env = Env::default();
        env.mock_all_auths();
        let registry_addr = Address::from_str(&env, REGISTRY);
        let expected = Address::generate(&env);
        env.register_at(&registry_addr, MockRegistry, (expected.clone(),));

        let factory_addr = env.register(Contract, (Address::generate(&env),));
        let first = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        env.register_at(&registry_addr, PanicRegistry, ());
        let second = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        assert_eq!(first, expected);
        assert_eq!(first, second, "the second lookup is served from the cache");
    }

    #[test]
    fn get_c_address_uses_random_salt() {
        let env = Env::default();
        env.mock_all_auths();
        let factory_addr = env.register(Contract, (Address::generate(&env),));
        let salt_a = BytesN::from_array(&env, &[1; 32]);
        let salt_b = BytesN::from_array(&env, &[2; 32]);

        let first = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt_a));
        let second = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt_b));
        let first_again = env.as_contract(&factory_addr, || Contract::get_c_address(&env, &salt_a));

        assert_ne!(first, second);
        assert_eq!(first, first_again);
    }

    /// `create_account` deploys a Perch account at the predicted address with
    /// exactly one rule: "admin", scoped to the account itself, whose only
    /// signer is the passkey checked by the resolved verifier. No document,
    /// no recovery controller: both arrive with the first `apply_doc`.
    #[test]
    fn create_account_deploys_a_perch_account_with_the_passkey_admin_rule() {
        let env = Env::default();
        let (factory, verifier) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let salt = BytesN::from_array(&env, &[9; 32]);
        let key = BytesN::from_array(&env, &[3; 65]);

        let predicted = client.get_c_address(&salt);
        let account = client.create_account(&salt, &key);
        assert_eq!(predicted, account);

        let reads = AccountClient::new(&env, &account);
        assert_eq!(reads.applied_doc_hash(), None);
        assert_eq!(reads.applied_doc(), None);
        assert_eq!(reads.recovery_controller(), None);
        assert_eq!(reads.get_context_rules_count(), 1);
        let rule = reads.get_context_rule(&0);
        assert_eq!(rule.name, String::from_str(&env, "admin"));
        assert_eq!(
            rule.context_type,
            stellar_accounts::smart_account::ContextRuleType::CallContract(account.clone())
        );
        assert_eq!(
            rule.signers,
            soroban_sdk::vec![&env, Signer::External(verifier, key.to_bytes())]
        );
        assert!(rule.policies.is_empty());
    }

    #[test]
    fn create_account_twice_with_the_same_salt_is_rejected() {
        let env = Env::default();
        let (factory, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let salt = BytesN::from_array(&env, &[10; 32]);
        let key = BytesN::from_array(&env, &[4; 65]);
        client.create_account(&salt, &key);
        assert!(client.try_create_account(&salt, &key).is_err());
    }

    /// The hash the factory deploys must equal the hash the host assigns when
    /// the same bytes are installed, or `deploy_v2` cannot resolve it.
    #[test]
    fn account_wasm_hash_equals_uploaded_wasm_hash() {
        let env = Env::default();
        env.mock_all_auths();
        assert!(
            !perch_account::WASM.is_empty(),
            "embedded account wasm is empty"
        );
        let uploaded = env.deployer().upload_contract_wasm(perch_account::WASM);
        let factory_addr = env.register(Contract, (Address::generate(&env),));
        let derived = env.as_contract(&factory_addr, || Contract::account_wasm_hash(&env));
        assert_eq!(derived, uploaded);
    }

    #[test]
    fn account_wasm_hash_caches_first_computation() {
        let env = Env::default();
        env.mock_all_auths();
        let factory_addr = env.register(Contract, (Address::generate(&env),));
        env.as_contract(&factory_addr, || {
            assert!(Config::get_account(&env).is_none());
            let fresh = Contract::compute_account_wasm_hash(&env);
            assert_eq!(Contract::account_wasm_hash(&env), fresh);
            assert_eq!(Config::get_account(&env), Some(fresh.clone()));
            assert_eq!(Contract::account_wasm_hash(&env), fresh);
        });
    }

    #[test]
    fn admin_is_set_at_construct_time() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(Contract, (admin.clone(),));
        assert_eq!(ContractClient::new(&env, &id).admin(), admin);
    }

    #[test]
    fn set_admin_rotates_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let new_admin = Address::generate(&env);
        let id = env.register(Contract, (Address::generate(&env),));
        let client = ContractClient::new(&env, &id);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);
    }

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

    #[test]
    fn upgrade_clears_account_wasm_hash_cache() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, (Address::generate(&env),));
        env.as_contract(&id, || {
            let _ = Contract::account_wasm_hash(&env);
            assert!(Config::get_account(&env).is_some());
        });
        let wasm_hash = env.deployer().upload_contract_wasm(perch_account::WASM);
        ContractClient::new(&env, &id).upgrade(&wasm_hash);
        env.as_contract(&id, || assert!(Config::get_account(&env).is_none()));
    }

    #[test]
    fn refresh_account_wasm_hash_repairs_stale_cache() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, (Address::generate(&env),));
        let client = ContractClient::new(&env, &id);
        env.as_contract(&id, || {
            Config::set_account(&env, &BytesN::from_array(&env, &[7u8; 32]));
        });
        let refreshed = client.refresh_account_wasm_hash();
        let expected = env.as_contract(&id, || Contract::compute_account_wasm_hash(&env));
        assert_eq!(refreshed, expected);

        env.set_auths(&[]);
        assert!(client.try_refresh_account_wasm_hash().is_err());
    }

    #[test]
    fn upgrade_requires_admin_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, (Address::generate(&env),));
        let client = ContractClient::new(&env, &id);
        let wasm_hash = env.deployer().upload_contract_wasm(perch_account::WASM);
        env.set_auths(&[]);
        assert!(client.try_upgrade(&wasm_hash).is_err());
        env.mock_all_auths();
        client.upgrade(&wasm_hash);
    }

    #[test]
    fn set_registry_pins_requires_admin_auth() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(Contract, (Address::generate(&env),));
        let client = ContractClient::new(&env, &id);
        assert_eq!(client.pinned_verifier(), None);

        env.set_auths(&[]);
        let verifier = Address::generate(&env);
        assert!(client.try_set_registry_pins(&verifier).is_err());
        assert_eq!(client.pinned_verifier(), None);

        env.mock_all_auths();
        client.set_registry_pins(&verifier);
        assert_eq!(client.pinned_verifier(), Some(verifier));
    }

    /// With the verifier pinned, `create_account` never constructs the
    /// registry client: a registry that panics on any lookup is unreachable,
    /// and the account's passkey signer names the pinned verifier.
    #[test]
    fn pinned_resolve_never_consults_registry() {
        let env = Env::default();
        let (factory, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let pinned = env.register(StubVerifier, ());
        client.set_registry_pins(&pinned);
        env.register_at(&Address::from_str(&env, REGISTRY), PanicRegistry, ());

        let salt = BytesN::from_array(&env, &[43; 32]);
        let key = BytesN::from_array(&env, &[7; 65]);
        let account = client.create_account(&salt, &key);
        let rule = AccountClient::new(&env, &account).get_context_rule(&0);
        assert_eq!(
            rule.signers,
            soroban_sdk::vec![&env, Signer::External(pinned, key.to_bytes())]
        );
    }
}
