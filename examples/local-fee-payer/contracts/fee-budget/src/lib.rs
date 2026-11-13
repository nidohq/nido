#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};
#[contract]
pub struct DemoAction;
#[contractimpl]
impl DemoAction {
    pub fn __constructor(e: Env, controller: Address, policy: Address) {
        e.storage()
            .instance()
            .set(&symbol_short!("owner"), &controller);
        e.storage()
            .instance()
            .set(&symbol_short!("policy"), &policy);
        e.storage().instance().set(&symbol_short!("uses"), &0u64);
    }
    pub fn refill(e: Env) -> u64 {
        let c: Address = e.storage().instance().get(&symbol_short!("owner")).unwrap();
        c.require_auth();
        let policy: Address = e
            .storage()
            .instance()
            .get(&symbol_short!("policy"))
            .unwrap();
        perch_fee_budget::FeeBudgetClient::new(&e, &policy).refill()
    }
    pub fn uses(e: Env) -> u64 {
        e.storage().instance().get(&symbol_short!("uses")).unwrap()
    }
    pub fn touch(e: Env) -> u64 {
        let c: Address = e.storage().instance().get(&symbol_short!("owner")).unwrap();
        c.require_auth();
        let n = Self::uses(e.clone()).checked_add(1).unwrap();
        e.storage().instance().set(&symbol_short!("uses"), &n);
        n
    }
}
