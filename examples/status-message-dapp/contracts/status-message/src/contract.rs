//! Status message contract.
//!
//! Each account stores a single on-chain status `String`, keyed by its own
//! address. `update_message` requires the author's authorization, so a g2c
//! passkey smart account (a C-address) signs it via the WebAuthn ceremony just
//! like any classic G-address wallet would.
//!
//! Vendored copy of `contracts/status-message` from the g2c repo root, kept
//! self-contained so this example is a standalone stellar-scaffold project.
//! The only intentional change is the `update_message` spelling (the canonical
//! contract still has the historical `udpate_message` typo).

use soroban_sdk::{contract, contractimpl, Address, Env, String};
use soroban_sdk_tools::{contractstorage, PersistentMap};

#[contractstorage]
pub struct Config {
    messages: PersistentMap<Address, String>,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    /// Set the calling account's status message. Requires `author`'s auth.
    pub fn update_message(e: &Env, message: &String, author: &Address) {
        author.require_auth();
        let messages = Config::new(e).messages;
        messages.set(author, message);
    }

    /// Read an account's status message, if any has been set.
    pub fn get_message(e: &Env, author: &Address) -> Option<String> {
        Config::new(e).messages.get(author)
    }
}
