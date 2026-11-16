#![no_std]
//! Local-chain-only content-addressed verifier deployment. The local build
//! overlays Perch's verifier registry path to this contract. Never a mainnet registry.
use soroban_sdk::{contract, contractimpl, Address, BytesN, ContractExecutable, Env};
#[contract]
pub struct Registry;
#[contractimpl]
impl Registry {
    pub fn deploy(e: Env, wasm_hash: BytesN<32>) -> Address {
        e.deployer()
            .with_current_contract(wasm_hash.clone())
            .deploy_contract(ContractExecutable::Wasm(wasm_hash), ())
    }
}
