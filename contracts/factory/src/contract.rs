use admin_sep::Administratable;
use soroban_sdk::{
    address_payload::AddressPayload, contract, contractevent, contractimpl,
    deploy::DeployerWithAddress, Address, Bytes, BytesN, Env, String, Symbol,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

// A pinned name is resolved directly from the pin without consulting the
// registry (`Self::resolve`), so there is no "registry disagrees with the
// pin" condition to report. Every way `create_account` can fail (no
// manager authorization, a setup signature that does not verify, a setup
// key already used, an unresolvable registry name for an unpinned name)
// surfaces as the host's or the registry's own error, so the factory
// defines no error type.

// The Perch smart-account wasm (`perch-account`) every account is deployed
// from, pinned by hash at build time from the committed
// `wasm/perch-account.sha256` (a missing or malformed pin fails the build).
// `just perch-infra` writes that file from Perch's deployment manifest,
// `vendor/perch/deployments/<STELLAR_NETWORK>.json` (default testnet), and
// `just check-vendor-drift` fails when the two differ.
//
// The factory carries only the 32-byte hash. `deploy_v2` resolves it against
// installed code, so the wasm with exactly this hash must be installed on the
// network before the factory creates an account (`scripts/deploy-factory.sh`
// installs it, refuses a factory wasm pinning another hash, and reads the pin
// back).
perch_registry_resolve::registry_contract! {
    mod: perch_account,
    wasm_name: "perch-account",
    hash_file: "wasm/perch-account.sha256",
}

/// Stellar Registry "unverified" testnet contract — the one that holds
/// bare-name → contract-id mappings. Calling `fetch_contract_id("verifier")`
/// on it returns the registered `WebAuthn` verifier; `resolve` below relies on
/// that for unpinned names.
///
/// For mainnet or an alternate registry build, change this constant and
/// redeploy the factory.
const REGISTRY: &str = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";

/// An account's deploy salt is `sha256(SETUP_DOMAIN || setup_pk)`.
const SETUP_DOMAIN: &[u8] = b"nido/setup/v1";

/// The setup key signs `sha256(BIND_DOMAIN || network_id || factory_id ||
/// key)`: the passkey `key` for this network and this factory only.
const BIND_DOMAIN: &[u8] = b"nido/bind/v1";

mod registry {
    use soroban_sdk::*;
    #[contractclient(name = "RegistryClient")]
    pub trait RegistryInterface {
        fn fetch_contract_id(name: String) -> Address;
    }
}

/// An account was created at `account` for the passkey `key`, bound by the
/// setup key `setup_pk`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountCreated {
    #[topic]
    pub account: Address,
    pub setup_pk: BytesN<32>,
    pub key: BytesN<65>,
}

/// The factory's wasm was replaced; the new wasm runs from the next
/// invocation, and with it the account wasm hash that wasm pins.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Upgraded {
    pub wasm_hash: BytesN<32>,
}

/// Accounts created from now on name this `WebAuthn` verifier.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifierPinned {
    pub verifier: Address,
}

/// Who must authorize `create_account` from now on; `None` lets anyone.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagerChanged {
    pub manager: Option<Address>,
}

/// The admin was set, at construction or by `set_admin`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChanged {
    pub admin: Address,
}

#[contractstorage]
pub struct Config {
    // The `admin` is not stored here: admin/set_admin come from the shared
    // `admin-sep` crate, which owns its own `ADMIN` key.
    /// The address for the `"verifier"` registry name. `None` = unpinned:
    /// resolve from the registry and trust it. Once set (by the constructor
    /// or `pin_verifier`), `resolve("verifier")` returns this address
    /// directly and never consults the registry, so a repointed, broken, or
    /// unreachable registry can neither swap the passkey verifier under new
    /// accounts nor block their creation.
    pinned_verifier: InstanceItem<Address>,
    /// The address that must authorize every `create_account`. `None` =
    /// anyone may create an account.
    manager: InstanceItem<Address>,
}

#[contract]
pub struct Contract;

// admin/set_admin come from the shared `admin-sep` crate
// (`Administratable`). Only the WebAuthn verifier moved to Perch (its
// constructorless `perch-webauthn-verifier`, which this factory pins); the
// factory stays Nido's, because Perch's factory derives an address from the
// admin signers and a Nido passkey's RP ID is the account's own subdomain, so
// the address has to exist before the passkey does. The address commits to a
// one-time setup key instead, whose signature binds the passkey.
//
// The admin upgrades the factory, pins the verifier, sets the manager, and
// rotates itself, each at once and each announced by an event. It has no
// authority over any deployed account. Any delay or quorum on those changes
// belongs to the admin, which is meant to be a smart account that enforces
// them; the factory stays as small as it can.
#[contractimpl(contracttrait)]
impl Administratable for Contract {
    /// admin-sep's default, plus an `AdminChanged` event so watchers see who
    /// can change the factory.
    fn set_admin(e: &Env, new_admin: Address) {
        let store = e.storage().instance();
        if let Some(current) = store.get::<_, Address>(admin_sep::STORAGE_KEY) {
            current.require_auth();
        }
        store.set(admin_sep::STORAGE_KEY, &new_admin);
        AdminChanged { admin: new_admin }.publish(e);
    }
}

#[contractimpl]
impl Contract {
    /// `verifier` pins the `WebAuthn` verifier from the first account on
    /// (`None` leaves it to the registry). `manager` must authorize every
    /// `create_account` (`None` lets anyone).
    // `#[contractimpl]` entry point: the SDK's XDR-based ABI takes owned
    // `Address` by value. `set_admin` on first call (no admin yet) skips the
    // auth check.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(
        e: &Env,
        admin: Address,
        verifier: Option<Address>,
        manager: Option<Address>,
    ) {
        Self::set_admin(e, admin);
        if let Some(verifier) = verifier {
            Self::store_verifier(e, verifier);
        }
        if manager.is_some() {
            Self::store_manager(e, manager);
        }
    }

    /// Replace the factory's wasm with the installed wasm `wasm_hash`, and
    /// with it the account wasm hash new accounts are deployed from. Admin
    /// only.
    pub fn upgrade(e: &Env, wasm_hash: BytesN<32>) {
        Self::admin(e).require_auth();
        Upgraded {
            wasm_hash: wasm_hash.clone(),
        }
        .publish(e);
        e.deployer().update_current_contract_wasm(wasm_hash);
    }

    /// Pin `verifier` for every account created afterwards. Admin only.
    pub fn pin_verifier(e: &Env, verifier: Address) {
        Self::admin(e).require_auth();
        Self::store_verifier(e, verifier);
    }

    /// Require `manager`'s authorization on every `create_account` from now
    /// on, or nobody's with `None`. Admin only.
    pub fn set_manager(e: &Env, manager: Option<Address>) {
        Self::admin(e).require_auth();
        Self::store_manager(e, manager);
    }

    /// The pinned `verifier` address, or `None` if unpinned.
    pub fn pinned_verifier(e: &Env) -> Option<Address> {
        Config::get_pinned_verifier(e)
    }

    /// The address that must authorize `create_account`, or `None` if anyone
    /// may.
    pub fn manager(e: &Env) -> Option<Address> {
        Config::get_manager(e)
    }

    /// Deploy a Perch smart account at `get_c_address(setup_pk)` whose
    /// constructor rule ("admin", scoped to the account itself) is the passkey
    /// `key`, checked by the `WebAuthn` verifier. Everything else — further
    /// signers, rules, and recovery — arrives through the account's first
    /// `apply_doc`.
    ///
    /// `setup_sig` is the setup key's Ed25519 signature over
    /// `sha256("nido/bind/v1" || network_id || factory_id || key)`, so only
    /// the holder of the setup key chooses the passkey at its address; the
    /// manager, if one is set, decides only whether the account is created.
    // `#[contractimpl]` entry point; SDK ABI requires owned arguments.
    #[allow(clippy::needless_pass_by_value)]
    pub fn create_account(
        e: &Env,
        setup_pk: BytesN<32>,
        key: BytesN<65>,
        setup_sig: BytesN<64>,
    ) -> Address {
        if let Some(manager) = Config::get_manager(e) {
            manager.require_auth();
        }
        e.crypto()
            .ed25519_verify(&setup_pk, &Self::binding(e, &key).into(), &setup_sig);
        let verifier = Self::resolve(e, "verifier");
        let admin_signers = soroban_sdk::vec![e, Signer::External(verifier, key.to_bytes())];
        let account =
            Self::deployer(e, &setup_pk).deploy_v2(Self::account_wasm_hash(e), (&admin_signers,));
        AccountCreated {
            account: account.clone(),
            setup_pk,
            key,
        }
        .publish(e);
        account
    }

    /// The address `create_account` deploys to for `setup_pk`.
    pub fn get_c_address(e: &Env, setup_pk: &BytesN<32>) -> Address {
        Self::deployer(e, setup_pk).deployed_address()
    }

    /// The installed `perch-account` wasm hash `create_account` deploys,
    /// pinned when this wasm was built.
    pub fn account_wasm_hash(e: &Env) -> BytesN<32> {
        perch_account::hash(e)
    }

    fn store_verifier(e: &Env, verifier: Address) {
        Config::set_pinned_verifier(e, &verifier);
        VerifierPinned { verifier }.publish(e);
    }

    fn store_manager(e: &Env, manager: Option<Address>) {
        let config = Config::new(e);
        match &manager {
            Some(manager) => config.manager.set(manager),
            None => config.manager.remove(),
        }
        ManagerChanged { manager }.publish(e);
    }

    /// What the setup key signs for `key`:
    /// `sha256(BIND_DOMAIN || network_id || factory_id || key)`.
    fn binding(e: &Env, key: &BytesN<65>) -> BytesN<32> {
        let Some(AddressPayload::ContractIdHash(factory_id)) =
            e.current_contract_address().to_payload()
        else {
            unreachable!("a contract's own address is a contract id")
        };
        let mut message = Bytes::from_slice(e, BIND_DOMAIN);
        message.append(&e.ledger().network_id().into());
        message.append(&factory_id.into());
        message.append(&key.clone().into());
        e.crypto().sha256(&message).to_bytes()
    }

    /// The deployer for `setup_pk`'s account: salt
    /// `sha256(SETUP_DOMAIN || setup_pk)`.
    fn deployer(e: &Env, setup_pk: &BytesN<32>) -> DeployerWithAddress {
        let mut preimage = Bytes::from_slice(e, SETUP_DOMAIN);
        preimage.append(&setup_pk.clone().into());
        e.deployer()
            .with_current_contract(e.crypto().sha256(&preimage).to_bytes())
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

    /// The pinned address for `name`, or `None` if unpinned. Only
    /// `"verifier"` is pinnable (the only name `resolve` looks up).
    fn pinned_for(env: &Env, name: &str) -> Option<Address> {
        match name {
            "verifier" => Config::get_pinned_verifier(env),
            _ => None,
        }
    }
}

#[cfg(test)]
mod test {
    // `#[contractimpl]`'s generated invoke wrappers bind every non-`Env`
    // param, which clippy counts as a use of the `_`-prefixed stub params.
    #![allow(clippy::used_underscore_binding)]

    extern crate std;

    use super::*;
    use ed25519_dalek::{Signer as _, SigningKey};
    use soroban_sdk::testutils::{
        Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    };
    use soroban_sdk::{
        contract, contractclient, contractimpl, Env, Event as _, Executable, IntoVal, TryFromVal,
    };

    /// The bytes of the account wasm the factory pins, as `just perch-infra`
    /// fetched them. The pin (`perch_account::hash`) is only a hash, and
    /// `deploy_v2` resolves it against installed code, so the tests need
    /// the bytes for one thing: installing that code (`install_account`).
    const ACCOUNT_WASM: &[u8] =
        include_bytes!("../../../target/wasm32v1-none/contract/perch_account.wasm");

    /// An earlier Perch account wasm (the integration suite's committed
    /// copy), installed beside the pinned one.
    const PREVIOUS_ACCOUNT_WASM: &[u8] =
        include_bytes!("../../../crates/integration-tests/fixtures/old-perch-account.wasm");

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

    /// Install the pinned account code, checking the fetched bytes are it
    /// (the host keys installed code by its sha256), and return the pin.
    fn install_account(env: &Env) -> BytesN<32> {
        assert_eq!(
            env.deployer().upload_contract_wasm(ACCOUNT_WASM),
            perch_account::hash(env),
            "the fetched perch_account.wasm is not the pinned account: run `just perch-infra`"
        );
        perch_account::hash(env)
    }

    /// A permissionless factory administered by `admin`, unpinned.
    fn factory(env: &Env, admin: &Address) -> Address {
        env.register(Contract, (admin.clone(), None::<Address>, None::<Address>))
    }

    /// A permissionless factory whose registry resolves `"verifier"` to a
    /// stub verifier, with the pinned account wasm installed. Returns the
    /// factory, the verifier, and the admin.
    fn setup(env: &Env) -> (Address, Address, Address) {
        env.mock_all_auths();
        let verifier = env.register(StubVerifier, ());
        env.register_at(
            &Address::from_str(env, REGISTRY),
            MockRegistry,
            (verifier.clone(),),
        );
        install_account(env);
        let admin = Address::generate(env);
        (factory(env, &admin), verifier, admin)
    }

    /// The verifier named by the admin rule of an account the factory made.
    fn verifier_of(env: &Env, account: &Address) -> Address {
        let rule = AccountClient::new(env, account).get_context_rule(&0);
        match rule.signers.get(0).unwrap() {
            Signer::External(verifier, _) => verifier,
            Signer::Delegated(_) => panic!("not a passkey signer"),
        }
    }

    /// The one-time setup key the browser generates.
    fn setup_key(n: u8) -> SigningKey {
        SigningKey::from_bytes(&[n; 32])
    }

    fn setup_pk(env: &Env, setup: &SigningKey) -> BytesN<32> {
        BytesN::from_array(env, &setup.verifying_key().to_bytes())
    }

    fn key(env: &Env, n: u8) -> BytesN<65> {
        BytesN::from_array(env, &[n; 65])
    }

    /// `setup`'s signature binding `key` to `factory` on the ledger's
    /// network, computed independently of the factory's own code.
    fn sign(env: &Env, setup: &SigningKey, factory: &Address, key: &BytesN<65>) -> BytesN<64> {
        let Some(AddressPayload::ContractIdHash(id)) = factory.to_payload() else {
            panic!("not a contract")
        };
        let mut message = Bytes::from_slice(env, b"nido/bind/v1");
        message.extend_from_array(&env.ledger().network_id().to_array());
        message.extend_from_array(&id.to_array());
        message.extend_from_array(&key.to_array());
        let digest = env.crypto().sha256(&message).to_array();
        BytesN::from_array(env, &setup.sign(&digest).to_bytes())
    }

    /// Create the account for setup key `n` with passkey `n`.
    fn mint(env: &Env, factory: &Address, n: u8) -> Address {
        let setup = setup_key(n);
        let key = key(env, n);
        ContractClient::new(env, factory).create_account(
            &setup_pk(env, &setup),
            &key,
            &sign(env, &setup, factory, &key),
        )
    }

    /// Give `env` the testnet network id.
    fn on_testnet(env: &Env) {
        let testnet = env
            .crypto()
            .sha256(&Bytes::from_slice(
                env,
                b"Test SDF Network ; September 2015",
            ))
            .to_array();
        env.ledger().with_mut(|l| l.network_id = testnet);
    }

    fn hex<const N: usize>(s: &str) -> [u8; N] {
        core::array::from_fn(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
    }

    fn factory_at(env: &Env, n: u8) -> Address {
        AddressPayload::ContractIdHash(BytesN::from_array(env, &[n; 32])).to_address(env)
    }

    /// `address`'s authorization of exactly `invoke`.
    fn by<'a>(address: &'a Address, invoke: &'a MockAuthInvoke<'a>) -> [MockAuth<'a>; 1] {
        [MockAuth { address, invoke }]
    }

    /// `factory.fn_name(args)`, for a `MockAuth` that authorizes exactly it.
    fn call<'a>(
        factory: &'a Address,
        fn_name: &'a str,
        args: soroban_sdk::Vec<soroban_sdk::Val>,
    ) -> MockAuthInvoke<'a> {
        MockAuthInvoke {
            contract: factory,
            fn_name,
            args,
            sub_invokes: &[],
        }
    }

    #[test]
    fn resolve_caches_after_first_lookup() {
        let env = Env::default();
        env.mock_all_auths();
        let registry_addr = Address::from_str(&env, REGISTRY);
        let expected = Address::generate(&env);
        env.register_at(&registry_addr, MockRegistry, (expected.clone(),));

        let factory_addr = factory(&env, &Address::generate(&env));
        let first = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        env.register_at(&registry_addr, PanicRegistry, ());
        let second = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        assert_eq!(first, expected);
        assert_eq!(first, second, "the second lookup is served from the cache");
    }

    /// The address is the deploy address for salt
    /// `sha256("nido/setup/v1" || setup_pk)`: one address per setup key,
    /// known before any passkey exists.
    #[test]
    fn get_c_address_derives_from_the_setup_key() {
        let env = Env::default();
        let factory_addr = factory(&env, &Address::generate(&env));
        let client = ContractClient::new(&env, &factory_addr);
        let a = setup_pk(&env, &setup_key(1));
        let b = setup_pk(&env, &setup_key(2));

        let mut preimage = Bytes::from_slice(&env, b"nido/setup/v1");
        preimage.extend_from_array(&a.to_array());
        let salt = env.crypto().sha256(&preimage).to_bytes();
        let expected = env.as_contract(&factory_addr, || {
            env.deployer()
                .with_current_contract(salt)
                .deployed_address()
        });

        assert_eq!(client.get_c_address(&a), expected);
        assert_eq!(client.get_c_address(&a), client.get_c_address(&a));
        assert_ne!(client.get_c_address(&a), client.get_c_address(&b));
    }

    /// The binding message, pinned so the wallet's copy
    /// (passkey-sdk `perch/setupKey.ts`) is checked against the same bytes:
    /// factory id `[7; 32]`, the testnet network id, passkey `[4; 65]`.
    #[test]
    fn the_binding_message_is_pinned() {
        let env = Env::default();
        on_testnet(&env);
        let factory = factory_at(&env, 7);
        env.register_at(
            &factory,
            Contract,
            (Address::generate(&env), None::<Address>, None::<Address>),
        );
        let binding = env.as_contract(&factory, || Contract::binding(&env, &key(&env, 4)));
        let mut hex = std::string::String::new();
        for byte in binding.to_array() {
            core::fmt::Write::write_fmt(&mut hex, format_args!("{byte:02x}")).unwrap();
        }
        assert_eq!(
            hex,
            "793c7c4bc48f6158c2edd30df3657752b6dc540fb7457e043cd5727d33c0e12c"
        );
    }

    /// The factory accepts the setup signature the wallet makes
    /// (passkey-sdk `perch/setupKey.ts`, pinned there too): setup secret
    /// `[1; 32]`, the binding above.
    #[test]
    fn the_wallets_setup_signature_creates_the_account() {
        let env = Env::default();
        on_testnet(&env);
        install_account(&env);
        let verifier = env.register(StubVerifier, ());
        let factory = factory_at(&env, 7);
        env.register_at(
            &factory,
            Contract,
            (Address::generate(&env), Some(verifier), None::<Address>),
        );
        let pk = BytesN::from_array(
            &env,
            &hex("8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c"),
        );
        let setup_sig = BytesN::from_array(
            &env,
            &hex(concat!(
                "0e52483241d7fa56f55b04231fedc9794b2e014881b066471d112f02789deba3",
                "f3f6e6c1a042e1ff8d5322c4c36c023e14668b3e22b1f9b9e85102d12cf64001"
            )),
        );
        assert_eq!(pk, setup_pk(&env, &setup_key(1)));
        let client = ContractClient::new(&env, &factory);
        assert_eq!(
            client.create_account(&pk, &key(&env, 4), &setup_sig),
            client.get_c_address(&pk)
        );
    }

    /// `create_account` deploys a Perch account at the predicted address with
    /// exactly one rule: "admin", scoped to the account itself, whose only
    /// signer is the passkey checked by the resolved verifier. No document,
    /// no recovery controller: both arrive with the first `apply_doc`. It
    /// announces the account with its setup key and passkey.
    #[test]
    fn create_account_deploys_a_perch_account_with_the_passkey_admin_rule() {
        let env = Env::default();
        let (factory, verifier, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let setup = setup_key(9);
        let pk = setup_pk(&env, &setup);
        let key = key(&env, 3);

        let predicted = client.get_c_address(&pk);
        let account = client.create_account(&pk, &key, &sign(&env, &setup, &factory, &key));
        assert_eq!(predicted, account);
        assert_eq!(
            env.events().all().filter_by_contract(&factory),
            [AccountCreated {
                account: account.clone(),
                setup_pk: pk,
                key: key.clone(),
            }
            .to_xdr(&env, &factory)]
        );

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
    fn create_account_twice_with_the_same_setup_key_is_rejected() {
        let env = Env::default();
        let (factory, _, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let setup = setup_key(10);
        let pk = setup_pk(&env, &setup);
        let key = key(&env, 4);
        let sig = sign(&env, &setup, &factory, &key);
        client.create_account(&pk, &key, &sig);
        assert!(client.try_create_account(&pk, &key, &sig).is_err());
    }

    /// Whoever sees a pending user's setup public key, as the relayer and
    /// anyone reading the mempool do, cannot put their own passkey at its
    /// address: the user's signature covers the user's passkey only, and a
    /// signature from any other key does not verify under the user's setup
    /// key. The user's own call still succeeds afterwards.
    #[test]
    fn a_front_runner_cannot_put_another_passkey_at_the_address() {
        let env = Env::default();
        let (factory, verifier, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let setup = setup_key(11);
        let pk = setup_pk(&env, &setup);
        let owner_key = key(&env, 5);
        let owner_sig = sign(&env, &setup, &factory, &owner_key);
        let front_runner_key = key(&env, 6);

        assert!(client
            .try_create_account(&pk, &front_runner_key, &owner_sig)
            .is_err());
        let own_sig = sign(&env, &setup_key(12), &factory, &front_runner_key);
        assert!(client
            .try_create_account(&pk, &front_runner_key, &own_sig)
            .is_err());

        let address = client.create_account(&pk, &owner_key, &owner_sig);
        assert_eq!(address, client.get_c_address(&pk));
        assert_eq!(
            AccountClient::new(&env, &address)
                .get_context_rule(&0)
                .signers,
            soroban_sdk::vec![&env, Signer::External(verifier, owner_key.to_bytes())],
        );
    }

    /// A setup signature that is not the setup key's over this exact binding
    /// is refused: random bytes, a signature for another factory, and one for
    /// another network.
    #[test]
    fn a_setup_signature_for_anything_else_is_refused() {
        let env = Env::default();
        let (factory, _, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let setup = setup_key(13);
        let pk = setup_pk(&env, &setup);
        let key = key(&env, 7);
        let other_factory = factory_at(&env, 99);

        let forged = BytesN::from_array(&env, &[1; 64]);
        let elsewhere = sign(&env, &setup, &other_factory, &key);
        let network = env.ledger().network_id().to_array();
        env.ledger().with_mut(|l| l.network_id = [9; 32]);
        let other_network = sign(&env, &setup, &factory, &key);
        env.ledger().with_mut(|l| l.network_id = network);
        for sig in [forged, elsewhere, other_network] {
            assert!(client.try_create_account(&pk, &key, &sig).is_err());
        }
        client.create_account(&pk, &key, &sign(&env, &setup, &factory, &key));
    }

    /// With a manager set, `create_account` needs the manager's
    /// authorization of exactly that call: none, a stranger's, or the
    /// manager's for another setup key or passkey is refused.
    #[test]
    fn with_a_manager_create_account_needs_its_authorization_of_that_call() {
        let env = Env::default();
        let (factory, _, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let manager = Address::generate(&env);
        let stranger = Address::generate(&env);
        client.set_manager(&Some(manager.clone()));
        assert_eq!(client.manager(), Some(manager.clone()));

        let setup = setup_key(14);
        let pk = setup_pk(&env, &setup);
        let passkey = key(&env, 8);
        let sig = sign(&env, &setup, &factory, &passkey);
        let other = setup_key(15);
        let other_pk = setup_pk(&env, &other);
        let other_passkey = key(&env, 9);
        let other_sig = sign(&env, &other, &factory, &other_passkey);
        let this_call = call(
            &factory,
            "create_account",
            (pk.clone(), passkey.clone(), sig.clone()).into_val(&env),
        );

        env.set_auths(&[]);
        assert!(
            client.try_create_account(&pk, &passkey, &sig).is_err(),
            "no auth"
        );
        assert!(client
            .mock_auths(&by(&stranger, &this_call))
            .try_create_account(&pk, &passkey, &sig)
            .is_err());
        assert!(
            client
                .mock_auths(&by(&manager, &this_call))
                .try_create_account(&other_pk, &other_passkey, &other_sig)
                .is_err(),
            "an approval for one account creates no other"
        );

        let account = client
            .mock_auths(&by(&manager, &this_call))
            .create_account(&pk, &passkey, &sig);
        assert_eq!(account, client.get_c_address(&pk));
    }

    /// The constructor sets the admin, the pin, and the manager, and
    /// announces each.
    #[test]
    fn the_constructor_sets_the_admin_the_pin_and_the_manager() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);
        let manager = Address::generate(&env);
        let id = env.register(
            Contract,
            (admin.clone(), Some(verifier.clone()), Some(manager.clone())),
        );
        let client = ContractClient::new(&env, &id);
        assert_eq!(client.admin(), admin);
        assert_eq!(client.pinned_verifier(), Some(verifier.clone()));
        assert_eq!(client.manager(), Some(manager.clone()));

        let open = factory(&env, &admin);
        let open_client = ContractClient::new(&env, &open);
        assert_eq!(open_client.pinned_verifier(), None);
        assert_eq!(open_client.manager(), None);
    }

    #[test]
    fn set_admin_rotates_admin_and_announces_it() {
        let env = Env::default();
        env.mock_all_auths();
        let new_admin = Address::generate(&env);
        let id = factory(&env, &Address::generate(&env));
        let client = ContractClient::new(&env, &id);
        client.set_admin(&new_admin);
        assert_eq!(
            env.events().all().filter_by_contract(&id),
            [AdminChanged {
                admin: new_admin.clone()
            }
            .to_xdr(&env, &id)]
        );
        assert_eq!(client.admin(), new_admin);
    }

    /// Nobody but the admin can upgrade, repin, set the manager, or rotate
    /// the admin; a refused call changes nothing.
    #[test]
    fn only_the_admin_can_upgrade_pin_set_the_manager_or_set_the_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let imposter = Address::generate(&env);
        let id = factory(&env, &admin);
        let client = ContractClient::new(&env, &id);
        let code = id.executable();
        let wasm = install_account(&env);
        let verifier = Address::generate(&env);
        let manager = Some(Address::generate(&env));
        let new_admin = Address::generate(&env);

        for who in [&imposter, &new_admin] {
            let upgrade = call(&id, "upgrade", (wasm.clone(),).into_val(&env));
            assert!(client
                .mock_auths(&by(who, &upgrade))
                .try_upgrade(&wasm)
                .is_err());
            let pin = call(&id, "pin_verifier", (verifier.clone(),).into_val(&env));
            assert!(client
                .mock_auths(&by(who, &pin))
                .try_pin_verifier(&verifier)
                .is_err());
            let set = call(&id, "set_manager", (manager.clone(),).into_val(&env));
            assert!(client
                .mock_auths(&by(who, &set))
                .try_set_manager(&manager)
                .is_err());
            let rotate = call(&id, "set_admin", (new_admin.clone(),).into_val(&env));
            assert!(client
                .mock_auths(&by(who, &rotate))
                .try_set_admin(&new_admin)
                .is_err());
        }
        env.set_auths(&[]);
        assert!(client.try_upgrade(&wasm).is_err(), "no auth");
        assert!(client.try_pin_verifier(&verifier).is_err(), "no auth");
        assert!(client.try_set_manager(&manager).is_err(), "no auth");
        assert!(client.try_set_admin(&new_admin).is_err(), "no auth");

        assert_eq!(id.executable(), code);
        assert_eq!(client.pinned_verifier(), None);
        assert_eq!(client.manager(), None);
        assert_eq!(client.admin(), admin);

        let pin = call(&id, "pin_verifier", (verifier.clone(),).into_val(&env));
        client.mock_auths(&by(&admin, &pin)).pin_verifier(&verifier);
        let set = call(&id, "set_manager", (manager.clone(),).into_val(&env));
        client.mock_auths(&by(&admin, &set)).set_manager(&manager);
        assert_eq!(client.pinned_verifier(), Some(verifier));
        assert_eq!(client.manager(), manager);
    }

    /// A repin reaches only accounts created after it, and is announced.
    #[test]
    fn a_verifier_pin_applies_to_accounts_created_afterwards() {
        let env = Env::default();
        let (factory, registry_verifier, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let pinned = env.register(StubVerifier, ());

        let before = mint(&env, &factory, 20);
        assert_eq!(verifier_of(&env, &before), registry_verifier);

        client.pin_verifier(&pinned);
        assert_eq!(
            env.events().all().filter_by_contract(&factory),
            [VerifierPinned {
                verifier: pinned.clone()
            }
            .to_xdr(&env, &factory)]
        );
        assert_eq!(client.pinned_verifier(), Some(pinned.clone()));
        assert_eq!(verifier_of(&env, &mint(&env, &factory, 21)), pinned);
        assert_eq!(
            verifier_of(&env, &before),
            registry_verifier,
            "an existing account keeps its verifier"
        );
    }

    /// Setting a manager gates creation from then on, and clearing it opens
    /// creation again; each is announced.
    #[test]
    fn set_manager_gates_creation_and_none_opens_it() {
        let env = Env::default();
        let (factory, _, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let manager = Some(Address::generate(&env));

        client.set_manager(&manager);
        assert_eq!(
            env.events().all().filter_by_contract(&factory),
            [ManagerChanged {
                manager: manager.clone()
            }
            .to_xdr(&env, &factory)]
        );
        env.set_auths(&[]);
        let setup = setup_key(22);
        let key = key(&env, 22);
        let sig = sign(&env, &setup, &factory, &key);
        assert!(client
            .try_create_account(&setup_pk(&env, &setup), &key, &sig)
            .is_err());

        env.mock_all_auths();
        client.set_manager(&None);
        assert_eq!(
            env.events().all().filter_by_contract(&factory),
            [ManagerChanged { manager: None }.to_xdr(&env, &factory)]
        );
        assert_eq!(client.manager(), None);
        env.set_auths(&[]);
        client.create_account(&setup_pk(&env, &setup), &key, &sig);
    }

    /// An upgrade installs exactly the given wasm, and is announced.
    #[test]
    fn an_upgrade_replaces_the_factory_wasm_and_is_announced() {
        let env = Env::default();
        let (factory, _, _) = setup(&env);
        let client = ContractClient::new(&env, &factory);
        let next = install_account(&env);
        client.upgrade(&next);
        assert_eq!(
            env.events().all().filter_by_contract(&factory),
            [Upgraded {
                wasm_hash: next.clone()
            }
            .to_xdr(&env, &factory)]
        );
        assert_eq!(factory.executable(), Some(Executable::Wasm(next)));
    }

    /// The pin is the `perch-account` hash in the manifest `just
    /// perch-infra` writes it from (`STELLAR_NETWORK`, default testnet), the
    /// hash the factory reports, and the hash of the code `install_account`
    /// installs, so `deploy_v2` resolves it.
    #[test]
    fn the_pinned_account_hash_is_the_manifests_and_the_fetched_wasms() {
        let env = Env::default();
        let client = ContractClient::new(&env, &factory(&env, &Address::generate(&env)));
        let network = std::env::var("STELLAR_NETWORK").unwrap_or_else(|_| "testnet".into());
        let path = std::format!(
            "{}/../../vendor/perch/deployments/{network}.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let manifest: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut pin = std::string::String::new();
        for byte in perch_account::WASM_HASH {
            core::fmt::Write::write_fmt(&mut pin, format_args!("{byte:02x}")).unwrap();
        }
        assert_eq!(
            pin, manifest["contracts"]["perch-account"]["sha256"],
            "wasm/perch-account.sha256 is not {path}'s perch-account: run `just perch-infra`"
        );
        assert_eq!(client.account_wasm_hash(), perch_account::hash(&env));
        install_account(&env);
    }

    /// Every account is deployed from exactly the pinned hash, even with
    /// other account code installed and a hash left in the instance under
    /// the key an earlier factory build cached one in.
    #[test]
    fn create_account_deploys_exactly_the_pinned_account_wasm() {
        let env = Env::default();
        let (factory, _, _) = setup(&env);
        let previous = env.deployer().upload_contract_wasm(PREVIOUS_ACCOUNT_WASM);
        env.as_contract(&factory, || {
            env.storage()
                .instance()
                .set(&Symbol::new(&env, "Account"), &previous);
        });
        assert_eq!(
            mint(&env, &factory, 30).executable(),
            Some(Executable::Wasm(perch_account::hash(&env)))
        );
    }

    /// The factory never deploys anything but the pinned wasm: until that
    /// exact code is installed, `create_account` fails, whatever other
    /// account code is installed.
    #[test]
    fn without_the_pinned_account_wasm_installed_create_account_fails() {
        let env = Env::default();
        env.mock_all_auths();
        env.deployer().upload_contract_wasm(PREVIOUS_ACCOUNT_WASM);
        let verifier = env.register(StubVerifier, ());
        let factory = env.register(
            Contract,
            (Address::generate(&env), Some(verifier), None::<Address>),
        );
        let setup = setup_key(31);
        let key = key(&env, 31);
        let client = ContractClient::new(&env, &factory);
        let sig = sign(&env, &setup, &factory, &key);
        assert!(client
            .try_create_account(&setup_pk(&env, &setup), &key, &sig)
            .is_err());

        install_account(&env);
        client.create_account(&setup_pk(&env, &setup), &key, &sig);
    }

    /// With the verifier pinned, `create_account` never constructs the
    /// registry client: a registry that panics on any lookup is unreachable,
    /// and the account's passkey signer names the pinned verifier.
    #[test]
    fn pinned_resolve_never_consults_registry() {
        let env = Env::default();
        env.register_at(&Address::from_str(&env, REGISTRY), PanicRegistry, ());
        install_account(&env);
        let pinned = env.register(StubVerifier, ());
        let factory = env.register(
            Contract,
            (
                Address::generate(&env),
                Some(pinned.clone()),
                None::<Address>,
            ),
        );

        assert_eq!(verifier_of(&env, &mint(&env, &factory, 43)), pinned);
    }
}
