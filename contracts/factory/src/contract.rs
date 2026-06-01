use soroban_sdk::{
    contract, contractimpl, deploy::DeployerWithAddress, Address, Bytes, BytesN, Env, String,
    Symbol,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

use crate::xlm;

mod smart_account {
    //! Embeds the smart-account wasm so the factory no longer hardcodes its
    //! wasm hash. The bytes are staged by `build.rs` (which copies the
    //! `just build-contracts` output, `g2c_smart_account.wasm`, into the
    //! location `import_contract_client!` resolves) and pulled in here via
    //! `include_bytes!`. The deploy hash is derived at runtime from these bytes
    //! (see `super::Contract::account_wasm_hash`), so it tracks the wasm
    //! automatically — no more hand-recomputed `ACCOUNT_HASH`.
    //!
    //! NOTE: the issue asked for
    //! `stellar_registry::import_contract_client!("unverified/smart-account@0.1.0")`.
    //! That macro expands to `soroban_sdk::contractimport!`, which also
    //! generates a typed contract `Client`. The smart-account's
    //! `__check_auth(..., auth_contexts: Vec<Context>)` signature makes the
    //! generator emit a bare `Context` type that it neither defines nor
    //! imports (the same soroban-spec gap `scripts/fix-bindings.sh` patches for
    //! the TS bindings), so the generated client fails to compile inside the
    //! macro-created module — which we cannot edit. We therefore embed only the
    //! wasm bytes (no client), avoiding the gap while still eliminating the
    //! hardcoded hash, which is what the issue is about. See the PR body.
    //!
    //! `STELLAR_ACCOUNT_WASM` is an absolute path emitted by `build.rs`; the
    //! built-in `include_bytes!` macro expands `env!` eagerly.

    /// Raw smart-account contract wasm. Equivalent to the `WASM` const that
    /// `contractimport!` would generate.
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
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn __constructor(e: &Env) {
        xlm::register(e, &e.current_contract_address());
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
    fn account_wasm_hash(e: &Env) -> BytesN<32> {
        e.crypto()
            .sha256(&Bytes::from_slice(e, smart_account::WASM))
            .to_bytes()
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, Env};

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

        let factory_addr = env.register(Contract, ());
        let first = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        let second = env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        assert_eq!(first, expected);
        assert_eq!(first, second);
    }

    /// The runtime-derived deploy hash must equal the SHA-256 of the embedded
    /// smart-account wasm — i.e. the installed-wasm hash `deploy_v2` expects.
    /// This is the value that used to be the hand-maintained `ACCOUNT_HASH`
    /// constant; deriving it guarantees it stays in lockstep with the wasm.
    #[test]
    fn account_wasm_hash_matches_sha256_of_embedded_wasm() {
        let env = Env::default();

        // The embedded wasm is staged by build.rs and must be non-empty
        // (catches a mis-staged / empty file).
        assert!(
            !smart_account::WASM.is_empty(),
            "embedded smart-account wasm is empty"
        );

        let hash = Contract::account_wasm_hash(&env);

        // Independent SHA-256 of the same bytes via the host's hash util.
        let expected = env
            .crypto()
            .sha256(&Bytes::from_slice(&env, smart_account::WASM))
            .to_bytes();
        assert_eq!(hash, expected);
        assert_eq!(hash.to_array().len(), 32);
    }
}
