#![no_std]
// Spike #161 part2/C: composite invocation wrapper.
// Purpose: make the SAC transfer a NESTED (sub-)invocation instead of the root,
// mirroring production T shape (factory deploy + genesis + transfer).
use soroban_sdk::{contract, contractimpl, token, vec, Address, BytesN, Env, IntoVal, Symbol};

#[contract]
pub struct CompositeWrapper;

#[contractimpl]
impl CompositeWrapper {
    /// Simple nesting: wrapper root -> SAC transfer sub-invocation.
    /// The SAC's transfer() does require_auth(from) one level below root.
    pub fn nested_transfer(e: Env, token: Address, from: Address, to: Address, amount: i128) {
        token::Client::new(&e, &token).transfer(&from, &to, &amount);
    }

    /// Full composite: factory.create_account(salt, key) -> C address,
    /// then SAC transfer(from -> C, amount). Two sub-invocations under one root.
    pub fn onboard(
        e: Env,
        factory: Address,
        salt: BytesN<32>,
        key: BytesN<65>,
        token: Address,
        from: Address,
        amount: i128,
    ) {
        let c: Address = e.invoke_contract(
            &factory,
            &Symbol::new(&e, "create_account"),
            vec![&e, salt.into_val(&e), key.into_val(&e)],
        );
        token::Client::new(&e, &token).transfer(&from, &c, &amount);
    }
}
