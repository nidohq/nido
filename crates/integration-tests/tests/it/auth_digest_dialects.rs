//! Both external-signer auth-digest dialects, on real account wasm — NO
//! `mock_all_auths`, so the account's own `__check_auth` runs.
//!
//! A redeployed account (`addr_oz_v1`) folds its own address into the signed
//! payload; an account minted before the redeploy (`oz_rule_ids`) does not. The
//! wallet reads `capabilities().auth_digest` and signs the matching digest
//! (`passkey-sdk`'s `authDigestScheme` + `computeAuthDigest`). This proves, on
//! chain, that each account authorizes its own dialect and refuses the other —
//! so re-pinning does not strand accounts minted before the redeploy.

use nido_integration_tests::world::{world, Passkey};
use nido_integration_tests::OLD_PERCH_ACCOUNT_WASM;
use perch_account::PerchAccountClient;
use soroban_sdk::{vec, IntoVal, Symbol, Val, Vec};

#[test]
fn an_account_authorizes_only_its_own_auth_digest_dialect() {
    let w = world();
    let protected = Symbol::new(&w.env, "protected");

    // A redeployed account reports addr_oz_v1 and verifies the account-bound
    // digest; the unbound (pre-redeploy) digest is refused.
    let alice = w.mint("alice", Passkey::new(1), std::vec![]);
    assert_eq!(
        w.account(&alice).capabilities().auth_digest,
        Symbol::new(&w.env, "addr_oz_v1"),
    );
    let alice_rule = w.rule_id(&alice.address, "admin");
    let alice_args: Vec<Val> = vec![&w.env, alice.address.clone().into_val(&w.env)];
    let alice_root = w.invocation(
        &alice.address,
        "execute",
        std::vec![w.sc(w.target.clone()), w.sc(protected.clone()), w.sc(alice_args.clone())],
    );

    let bound = w.passkey_entry(&alice.address, &[alice.key("owner")], alice_rule, alice_root.clone());
    w.with_auths(&[bound], || {
        w.account(&alice).execute(&w.target, &protected, &alice_args);
    });

    let unbound = w.passkey_entry_unbound(&alice.address, &[alice.key("owner")], alice_rule, alice_root);
    let refused = w.with_auths(&[unbound], || {
        w.account(&alice).try_execute(&w.target, &protected, &alice_args)
    });
    assert!(
        refused.is_err(),
        "the unbound oz_rule_ids digest must not authorize a redeployed (addr_oz_v1) account",
    );

    // An account minted before the redeploy reports oz_rule_ids and verifies the
    // unbound digest; the account-bound digest is refused. Deployed from the
    // committed pre-redeploy wasm, with its passkey naming this world's verifier.
    let old_key = Passkey::new(2);
    let signer = old_key.signer(&w.env, &w.verifier);
    let old = w.env.register(OLD_PERCH_ACCOUNT_WASM, (vec![&w.env, signer],));
    let old_client = PerchAccountClient::new(&w.env, &old);
    assert_eq!(
        old_client.capabilities().auth_digest,
        Symbol::new(&w.env, "oz_rule_ids"),
    );
    let old_rule = w.rule_id(&old, "admin");
    let old_args: Vec<Val> = vec![&w.env, old.clone().into_val(&w.env)];
    let old_root = w.invocation(
        &old,
        "execute",
        std::vec![w.sc(w.target.clone()), w.sc(protected.clone()), w.sc(old_args.clone())],
    );

    let unbound = w.passkey_entry_unbound(&old, &[&old_key], old_rule, old_root.clone());
    w.with_auths(&[unbound], || {
        old_client.execute(&w.target, &protected, &old_args);
    });

    let bound = w.passkey_entry(&old, &[&old_key], old_rule, old_root);
    let refused = w.with_auths(&[bound], || {
        old_client.try_execute(&w.target, &protected, &old_args)
    });
    assert!(
        refused.is_err(),
        "the account-bound addr_oz_v1 digest must not authorize a pre-redeploy (oz_rule_ids) account",
    );
}
