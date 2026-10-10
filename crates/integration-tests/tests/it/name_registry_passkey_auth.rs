//! Full-stack auth for the name-registry claim — NO `mock_all_auths`.
//!
//! `name_registry.rs` mocks every authorization, which bypasses the account's
//! `__check_auth` entirely; that is how a claim-flow auth bug once escaped to
//! the testnet e2e. These tests drive `register` through the host with a real
//! passkey assertion (`world::World::passkey_entry`), the same sequence the
//! chain runs, against a factory-minted Perch account.
//!
//! A Perch account's constructor rule is scoped to the account itself, so a
//! fresh account claims its name through `execute` (the account becomes the
//! invoker of `register`). An account whose document grants a rule scoped to
//! the registry can also authorize `register` directly.

use nido_integration_tests::world::{world, Doc, Passkey, World};
use soroban_sdk::{vec, Address, IntoVal, String, Symbol, Val, Vec};

const NAME_REGISTRY_WASM: &[u8] =
    include_bytes!("../../../../target/wasm32v1-none/contract/nido_name_registry.wasm");

#[soroban_sdk::contractclient(name = "NameRegistryClient")]
#[allow(dead_code)]
trait NameRegistryInterface {
    fn register(env: soroban_sdk::Env, owner: soroban_sdk::Address, name: String);
    fn resolve(env: soroban_sdk::Env, name: String) -> Option<soroban_sdk::Address>;
}

fn registry(w: &World) -> Address {
    w.env.register(
        NAME_REGISTRY_WASM,
        (nido_integration_tests::world::contract_at(
            &w.env,
            "registry-admin",
        ),),
    )
}

/// A fresh account (constructor rule only) claims its name through
/// `execute`, signed by its passkey.
#[test]
fn a_fresh_account_claims_its_name_through_execute() {
    let w = world();
    let alice = w.mint("alice", Passkey::new(1), std::vec![]);
    let registry = registry(&w);
    let name = String::from_str(&w.env, "alice");

    let f = Symbol::new(&w.env, "register");
    let args: Vec<Val> = vec![
        &w.env,
        alice.address.clone().into_val(&w.env),
        name.clone().into_val(&w.env),
    ];
    let root = w.invocation(
        &alice.address,
        "execute",
        std::vec![w.sc(registry.clone()), w.sc(f.clone()), w.sc(args.clone())],
    );
    let entry = w.signed(&alice, "owner", "admin", root);
    w.with_auths(&[entry], || {
        w.account(&alice).execute(&registry, &f, &args);
    });

    assert_eq!(
        NameRegistryClient::new(&w.env, &registry).resolve(&name),
        Some(alice.address)
    );
}

/// An account whose document scopes a rule to the registry authorizes
/// `register` directly; a passkey no rule names does not.
#[test]
fn a_document_rule_scoped_to_the_registry_authorizes_register() {
    let w = world();
    let alice = w.mint("alice", Passkey::new(1), std::vec![]);
    let registry = registry(&w);
    let doc = Doc {
        signers: std::vec![("owner", alice.key("owner").pubkey())],
        rules: std::vec![("names", registry.clone())],
        recovery: None,
    };
    w.apply(&alice, &doc, 0).unwrap();
    let client = NameRegistryClient::new(&w.env, &registry);
    let name = String::from_str(&w.env, "alice");
    let root = w.invocation(
        &registry,
        "register",
        std::vec![w.sc(alice.address.clone()), w.sc(name.clone())],
    );

    let mut mallory = alice.clone();
    mallory.keys = std::vec![("owner", Passkey::new(66))];
    let forged = w.signed(&mallory, "owner", "names", root.clone());
    let refused = w.with_auths(&[forged], || client.try_register(&alice.address, &name));
    assert!(refused.is_err(), "an unknown passkey authorizes nothing");

    let entry = w.signed(&alice, "owner", "names", root);
    w.with_auths(&[entry], || client.register(&alice.address, &name));
    assert_eq!(client.resolve(&name), Some(alice.address));
}
