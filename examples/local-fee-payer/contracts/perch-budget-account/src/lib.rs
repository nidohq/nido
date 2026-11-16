#![no_std]
//! Fixed native-Perch owner shell for the local lab. No document mutation or
//! upgrades; production integration uses the document-managed PerchAccount.
use perch_smart_account::{AuthPayload, Signer};
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl, contracttype,
    crypto::Hash,
    Address, Env, Symbol, Val, Vec,
};
#[contract]
pub struct DemoPerchAccount;
#[contracttype]
pub struct Capabilities {
    pub auth_digest: Symbol,
    pub fee_rule: u32,
}
#[contractimpl]
impl DemoPerchAccount {
    pub fn __constructor(e: &Env, signers: Vec<Signer>) {
        perch_smart_account::install_account_rules(e, &signers);
    }
    pub fn capabilities(e: &Env) -> Capabilities {
        Capabilities {
            auth_digest: Symbol::new(e, "addr_oz_v1"),
            fee_rule: 0,
        }
    }
    pub fn execute(e: &Env, target: Address, target_fn: Symbol, target_args: Vec<Val>) -> Val {
        e.current_contract_address().require_auth();
        e.invoke_contract(&target, &target_fn, target_args)
    }
}
#[contractimpl]
impl CustomAccountInterface for DemoPerchAccount {
    type Error = soroban_sdk::Error;
    type Signature = AuthPayload;
    fn __check_auth(
        e: Env,
        payload: Hash<32>,
        signatures: AuthPayload,
        contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        perch_smart_account::check_auth(&e, &payload, &signatures, &contexts)
    }
}
