use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use stellar_accounts::policies::simple_threshold::{self, SimpleThresholdAccountParams};
use stellar_accounts::policies::Policy;
use stellar_accounts::smart_account::{ContextRule, Signer};
use soroban_sdk::auth::Context;

#[contract]
pub struct MultisigPolicy;
