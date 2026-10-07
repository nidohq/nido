//! A factory-minted Nido account on Perch's shared smart account, driven only
//! by passkey signatures under ENFORCING authorization: the document write
//! path, execution through the account, full document reads, the reserved
//! hook names, and the seven-day upgrade path (Perch `docs/recovery/spec.md`
//! §12, §15).

use nido_integration_tests::world::{err, world, Account, Doc, Passkey, World};
use nido_integration_tests::FACTORY_WASM;
use perch_account::PerchAccountError;
use perch_recovery_interface::account::ACCOUNT_UPGRADE_DELAY_LEDGERS;
use soroban_sdk::{vec, Bytes, BytesN, IntoVal, Symbol, Val, Vec};

fn minted(w: &World) -> Account {
    w.mint(
        "alice",
        Passkey::new(1),
        std::vec![("device", Passkey::new(2))],
    )
}

/// The constructor installs only the passkey admin rule; the first document,
/// signed by that passkey, replaces it and is stored canonically, so anyone
/// can check installed == reviewed and read the full document back.
#[test]
fn the_first_document_signed_by_the_passkey_is_installed_and_readable() {
    let w = world();
    let alice = minted(&w);
    let client = w.account(&alice);
    assert_eq!(client.applied_doc(), None);
    assert_eq!(client.get_context_rules_count(), 1);

    let doc = w.doc(&alice, None);
    let hash = w.apply(&alice, &doc, 0).expect("passkey-signed apply_doc");

    let compiled = w.compiler().compile_doc(&doc.bytes(&w));
    assert_eq!(hash, compiled.doc_hash);
    assert_eq!(client.applied_doc_hash(), Some(hash.clone()));
    assert_eq!(client.applied_doc(), Some(compiled.canonical.clone()));
    assert_eq!(
        w.env.crypto().sha256(&compiled.canonical).to_bytes(),
        hash,
        "the stored bytes hash to the applied doc hash"
    );
    assert_ne!(w.rule_id(&alice.address, "admin"), u32::MAX);
    assert_ne!(w.rule_id(&alice.address, "app"), u32::MAX);
    assert_eq!(client.recovery_controller(), None);
}

/// A document is bound to one network: a testnet document never installs on
/// another chain.
#[test]
fn a_document_for_another_network_is_refused() {
    let w = world();
    let alice = minted(&w);
    let json = w.doc(&alice, None).json(&w).replace(
        "Test SDF Network ; September 2015",
        "Public Global Stellar Network ; September 2015",
    );
    let r = w.apply_bytes_as(
        &alice,
        "owner",
        &Bytes::from_slice(&w.env, json.as_bytes()),
        0,
    );
    assert!(r.is_err());
    assert_eq!(w.account(&alice).applied_doc_hash(), None);
}

/// A document prepared at one revision never overwrites a change made since:
/// an `apply_doc` naming the revision it was prepared at is refused with
/// `StaleRevision` once the account moves, and leaves the revision. Every
/// successful apply advances it by one, a re-apply of the same document
/// included.
#[test]
fn a_document_prepared_at_an_older_revision_is_refused() {
    let w = world();
    let alice = minted(&w);
    let client = w.account(&alice);
    assert_eq!(client.revision(), 0);

    let doc = w.doc(&alice, None);
    w.apply_at(&alice, &doc, 0, 0)
        .expect("prepared at revision 0");
    assert_eq!(client.revision(), 1);

    assert_eq!(
        err(w.apply_at(&alice, &doc, 0, 0)),
        PerchAccountError::StaleRevision
    );
    assert_eq!(client.revision(), 1);

    w.apply_at(&alice, &doc, 0, 1)
        .expect("re-prepared at revision 1");
    assert_eq!(client.revision(), 2);
}

/// Each document replaces the whole rule set: rules the new document does not
/// name are gone, and the stored copy tracks the latest document.
#[test]
fn each_document_replaces_the_whole_rule_set() {
    let w = world();
    let alice = minted(&w);
    let mut doc = w.doc(&alice, None);
    doc.rules.push(("second-app", w.controller.clone()));
    w.apply(&alice, &doc, 0).unwrap();
    assert_ne!(w.rule_id(&alice.address, "second-app"), u32::MAX);
    assert_eq!(w.account(&alice).get_context_rules_count(), 3);

    let second = w.doc(&alice, None);
    let hash = w.apply(&alice, &second, 0).unwrap();
    assert_eq!(w.rule_id(&alice.address, "second-app"), u32::MAX);
    assert_eq!(w.account(&alice).get_context_rules_count(), 2);
    assert_eq!(w.account(&alice).applied_doc_hash(), Some(hash));
}

/// A capped rule installs Perch's interpreter AND Perch's stock spending
/// limit, both at the content addresses the account derives from its
/// build-time pins (never an address the document or an admin supplies).
#[test]
fn a_capped_rule_installs_the_spending_limit_beside_the_interpreter() {
    let w = world();
    let alice = minted(&w);
    let json = w.doc(&alice, None).json(&w).replace(
        r#""name":"app","#,
        r#""name":"app","cap":{"limit":"10","period-ledgers":1000},"#,
    );
    w.apply_bytes_as(
        &alice,
        "owner",
        &Bytes::from_slice(&w.env, json.as_bytes()),
        0,
    )
    .expect("capped document");
    let rule = w
        .account(&alice)
        .get_context_rule(&w.rule_id(&alice.address, "app"));
    assert_eq!(rule.policies.len(), 2, "interpreter + spending limit");
    assert!(rule
        .policies
        .contains(perch_smart_account::infra::perch_spending_limit::address(
            &w.env
        )));
    assert!(rule
        .policies
        .contains(perch_smart_account::infra::perch_interpreter::address(
            &w.env
        )));
}

/// Only the admin rule's signers can change the document: the `device`
/// passkey is declared, but the admin rule names `owner` alone.
#[test]
fn a_passkey_outside_the_admin_rule_cannot_change_the_document() {
    let w = world();
    let alice = minted(&w);
    w.apply(&alice, &w.doc(&alice, None), 0).unwrap();

    let doc = w.doc(&alice, None);
    // `device` signs, selecting the admin rule: OZ refuses the signature set.
    assert!(w
        .apply_bytes_as(&alice, "device", &doc.bytes(&w), 0)
        .is_err());
}

/// A document that leaves no policy-free self-admin rule could lock the
/// owner out; the account refuses it and keeps the applied document.
#[test]
fn a_document_without_a_self_admin_rule_is_refused() {
    let w = world();
    let alice = minted(&w);
    let before = w.apply(&alice, &w.doc(&alice, None), 0).unwrap();

    let doc = Doc {
        signers: std::vec![("owner", alice.key("owner").pubkey())],
        rules: std::vec![],
        recovery: None,
    };
    let json = doc.json(&w).replace(
        r#""scope":{"type":"self-admin"}"#,
        &std::format!(
            r#""scope":{{"type":"contract","address":"{}"}}"#,
            nido_integration_tests::world::strkey(&w.target)
        ),
    );
    let r = w.apply_bytes_as(
        &alice,
        "owner",
        &Bytes::from_slice(&w.env, json.as_bytes()),
        0,
    );
    assert_eq!(err(r), PerchAccountError::AdminLockout);
    assert_eq!(w.account(&alice).applied_doc_hash(), Some(before));
}

/// Ordinary activity: directly through a document rule scoped to the dApp,
/// and through `execute`, where the account becomes the invoker.
#[test]
fn ordinary_activity_runs_through_document_rules_and_execute() {
    let w = world();
    let alice = minted(&w);
    w.apply(&alice, &w.doc(&alice, None), 0).unwrap();

    assert!(w.activity(&alice, "owner"));
    let out = w.execute(&alice, "owner").expect("execute as the account");
    let hits: u32 = soroban_sdk::FromVal::from_val(&w.env, &out);
    assert_eq!(hits, 2, "execute returns the called function's value");

    // A signature from a passkey no rule names authorizes nothing.
    let mallory = Account {
        address: alice.address.clone(),
        keys: std::vec![("owner", Passkey::new(99))],
    };
    assert!(!w.activity(&mallory, "owner"));
}

/// The invoker-only hook names are unreachable by signature on any contract
/// and through `execute` (spec §15): otherwise whoever can authorize the
/// account could write its recovery configuration or pool leaves directly
/// (perch#90, nidohq/nido#217).
#[test]
fn reserved_hook_names_are_never_authorized_or_executed() {
    let w = world();
    let alice = minted(&w);
    w.apply(&alice, &w.doc(&alice, None), 0).unwrap();

    // Through `execute`: refused by name before any call is made.
    for (target, name) in [
        (&w.controller, "rcv_sync"),
        (&w.pool, "rcv_insert"),
        (&w.controller, "install"),
        (&w.target, "enforce"),
    ] {
        let f = Symbol::new(&w.env, name);
        let args: Vec<Val> = vec![&w.env, alice.address.clone().into_val(&w.env)];
        let root = w.invocation(
            &alice.address,
            "execute",
            std::vec![w.sc(target.clone()), w.sc(f.clone()), w.sc(args.clone())],
        );
        let entry = w.signed(&alice, "owner", "admin", root);
        let r = w.with_auths(&[entry], || {
            w.account(&alice)
                .try_execute(target, &f, &args)
                .map(|r| r.unwrap())
        });
        assert_eq!(
            err(r),
            PerchAccountError::ReservedFunction,
            "execute {name}"
        );
    }

    // By signature: the owner's own passkey authorizing the pool's insertion
    // hook directly is refused in `__check_auth`.
    let id = BytesN::from_array(&w.env, &[7; 32]);
    let commitment = BytesN::from_array(&w.env, &[1; 32]);
    let root = w.invocation(
        &w.pool,
        "rcv_insert",
        std::vec![
            w.sc(alice.address.clone()),
            w.sc(id.clone()),
            w.sc(commitment.clone())
        ],
    );
    let entry = w.signed(&alice, "owner", "admin", root);
    let r = w.with_auths(&[entry], || {
        w.pool_client()
            .try_rcv_insert(&alice.address, &id, &commitment)
    });
    assert!(r.is_err(), "a signed rcv_insert is refused");
    assert_eq!(w.pool_client().enrollment(&alice.address, &id), None);
}

/// Upgrades wait [`ACCOUNT_UPGRADE_DELAY_LEDGERS`] (seven days), need the
/// owner, and execute exactly the scheduled Wasm (spec §12).
#[test]
fn an_upgrade_waits_seven_days_and_installs_the_scheduled_wasm() {
    let w = world();
    let alice = minted(&w);
    w.apply(&alice, &w.doc(&alice, None), 0).unwrap();
    let wasm = w.env.deployer().upload_contract_wasm(FACTORY_WASM);

    let id = w
        .schedule_upgrade(&alice, &wasm, 0)
        .expect("owner schedules");
    let pending = w.account(&alice).pending_upgrade().unwrap();
    assert_eq!(pending.wasm_hash, wasm);
    assert_eq!(
        pending.executable_at,
        w.ledger() + ACCOUNT_UPGRADE_DELAY_LEDGERS
    );

    w.advance(ACCOUNT_UPGRADE_DELAY_LEDGERS - 1);
    assert_eq!(
        err(w.execute_upgrade(&alice, id)),
        PerchAccountError::UpgradeNotReady
    );
    w.advance(1);
    assert_eq!(
        err(w.execute_upgrade(&alice, id + 1)),
        PerchAccountError::UpgradeRequestMismatch
    );
    assert_eq!(w.execute_upgrade(&alice, id), Ok(()));
    // The account now runs the scheduled Wasm (the factory's): its
    // entry points answer at the account's address.
    let as_factory = nido_integration_tests::world::FactoryClient::new(&w.env, &alice.address);
    let salt = BytesN::from_array(&w.env, &[1; 32]);
    assert_eq!(
        as_factory.get_c_address(&salt),
        w.env
            .deployer()
            .with_address(alice.address.clone(), salt)
            .deployed_address()
    );
}

/// The owner can cancel, a newer request replaces an older one, and nobody
/// but the owner can schedule.
#[test]
fn upgrades_are_owner_only_cancellable_and_replaceable() {
    let w = world();
    let alice = minted(&w);
    w.apply(&alice, &w.doc(&alice, None), 0).unwrap();
    let wasm = w.env.deployer().upload_contract_wasm(FACTORY_WASM);

    let first = w.schedule_upgrade(&alice, &wasm, 0).unwrap();
    let second = w.schedule_upgrade(&alice, &wasm, 0).unwrap();
    assert_ne!(first, second);
    assert_eq!(
        w.account(&alice).pending_upgrade().unwrap().request_id,
        second
    );
    w.cancel_upgrade(&alice).unwrap();
    assert_eq!(w.account(&alice).pending_upgrade(), None);
    assert_eq!(
        err(w.cancel_upgrade(&alice)),
        PerchAccountError::NoPendingUpgrade
    );

    // `device` is declared but not an admin signer.
    let root = w.invocation(
        &alice.address,
        "schedule_upgrade",
        std::vec![w.sc(wasm.clone()), w.sc(0u32)],
    );
    let entry = w.signed(&alice, "device", "admin", root);
    let r = w.with_auths(&[entry], || {
        w.account(&alice).try_schedule_upgrade(&wasm, &0)
    });
    assert!(r.is_err());
}
