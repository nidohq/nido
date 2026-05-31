use soroban_sdk::{
    contract, contractimpl, deploy::DeployerWithAddress, Address, Bytes, BytesN, Env, String,
    Symbol,
};
use soroban_sdk_tools::{contractstorage, InstanceItem};
use stellar_accounts::smart_account::Signer;

use crate::xlm;

const ACCOUNT_HASH: &[u8; 32] = b"\x49\xc7\x4a\x0c\xd3\xa9\xc3\x9c\xe1\xb3\x88\x1e\xe8\x1a\x05\x57\xca\xba\x49\x92\x21\x66\xc4\xdf\x41\x93\x34\x14\xd9\x2d\x0d\xd8";

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
        let client = registry::RegistryClient::new(
            env,
            &Address::from_str(env, REGISTRY),
        );
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
        Self::deployer(e, funder)
            .deploy_v2(BytesN::from_array(e, ACCOUNT_HASH), (&signers, &policies))
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
        let first =
            env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        let second =
            env.as_contract(&factory_addr, || Contract::resolve(&env, "verifier"));
        assert_eq!(first, expected);
        assert_eq!(first, second);
    }
}
