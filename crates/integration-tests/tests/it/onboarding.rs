//! Onboarding and recovery configuration through the shared `apply_doc`
//! path (nidohq/nido#224): the factory mints the account with only its
//! passkey admin rule, and the wallet's first document carries the
//! `recovery` member. One `apply_doc` then compiles the document, has the
//! controller record the configuration (`rcv_sync`), installs the rules and
//! the zero-signer recovery rule, and inserts the ZK leaf into the pool
//! (`rcv_insert`).
//!
//! Atomicity: these steps run in one invocation, and the pool insertion is a
//! plain (non-`try_`) call, so any failure reverts all of them. There is no
//! state in which the account is enrolled at the controller without its leaf,
//! or holds a leaf without the configuration — the two-transaction
//! wire-then-enroll window of the previous design does not exist.

// `#[contractimpl]`'s generated wrappers bind every parameter of
// `FailingPool`, which clippy counts as a use of the `_`-prefixed ones.
#![allow(clippy::used_underscore_binding)]

use nido_integration_tests::world::{contract_at, err, strkey, world, Mode, Passkey, Profile};
use nido_integration_tests::zk::ZkCredential;
use perch_account::PerchAccountError;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

/// A pool whose insertion always fails, at the depth the adapter proves, so
/// the controller's wiring check accepts it and the failure happens at the
/// last step of `apply_doc`.
#[contract]
pub struct FailingPool;

#[contractimpl]
impl FailingPool {
    pub fn depth(_e: Env) -> u32 {
        perch_zk_pool::TREE_DEPTH
    }

    pub fn rcv_insert(
        _e: Env,
        _account: Address,
        _enrollment_id: BytesN<32>,
        _commitment: BytesN<32>,
    ) {
        panic!("pool unavailable");
    }
}

/// The wallet's first document enrolls ZK recovery and inserts the leaf in
/// the same `apply_doc`; guardian-only enrollment touches no pool.
#[test]
fn the_first_document_enrolls_recovery_in_one_apply_doc() {
    let w = world();
    let zk = w.enrolled("onboard-zk", Profile::Loss, Mode::Zk);
    let cred = zk.zk.clone().unwrap();
    assert_eq!(
        w.account(&zk.account).recovery_controller(),
        Some(w.controller.clone())
    );
    assert!(w.ctl().config(&zk.account.address).is_some());
    let at = w
        .pool_client()
        .enrollment(
            &zk.account.address,
            &BytesN::from_array(&w.env, &cred.enrollment_id),
        )
        .expect("leaf inserted by the enrolling apply_doc");
    assert_eq!(at.tree_id, 0);
    assert!(w
        .account(&zk.account)
        .is_enrolled_id(&BytesN::from_array(&w.env, &cred.enrollment_id)));

    let size = w.pool_client().tree(&0).size;
    let guardians = w.enrolled("onboard-guardians", Profile::Protected, Mode::Guardian);
    assert!(w.ctl().config(&guardians.account.address).is_some());
    assert_eq!(
        w.pool_client().tree(&0).size,
        size,
        "guardian-only recovery needs no ZK enrollment, proof, or pool access"
    );
}

/// If the pool insertion fails, the whole `apply_doc` reverts: no document,
/// no recovery rule, no controller configuration, no enrolled id. Retrying
/// with a working pool succeeds from the same starting state.
#[test]
fn a_failed_pool_insertion_reverts_the_whole_apply_doc() {
    let w = world();
    let alice = w.mint("atomic", Passkey::labelled("atomic/owner"), std::vec![]);
    let broken = contract_at(&w.env, "failing-pool");
    w.env.register_at(&broken, FailingPool, ());
    let cred = ZkCredential::new("atomic");
    let recovery = w.recovery(
        Profile::Loss,
        Mode::Zk,
        &[],
        1,
        Some(cred.enrollment(&w.env)),
    );
    let doc = w.doc(&alice, Some(recovery));
    let json = doc.json(&w).replace(&strkey(&w.pool), &strkey(&broken));

    let r = w.apply_bytes_as(
        &alice,
        "owner",
        &Bytes::from_slice(&w.env, json.as_bytes()),
        0,
    );
    assert!(r.is_err());
    let id = BytesN::from_array(&w.env, &cred.enrollment_id);
    assert_eq!(w.account(&alice).applied_doc_hash(), None);
    assert_eq!(w.account(&alice).recovery_controller(), None);
    assert_eq!(
        w.account(&alice).get_context_rules_count(),
        1,
        "constructor rule only"
    );
    assert_eq!(w.ctl().config(&alice.address), None);
    assert_eq!(w.ctl().epoch(&alice.address), 0);
    assert!(!w.account(&alice).is_enrolled_id(&id));

    w.apply(&alice, &doc, 0)
        .expect("the same enrollment with a working pool");
    assert!(w.pool_client().enrollment(&alice.address, &id).is_some());
}

/// A ZK credential is never changed in place and an enrollment id is never
/// reused, even after recovery is removed: a retired or consumed leaf can
/// never become valid again (spec §3.4).
#[test]
fn zk_enrollments_are_fresh_and_never_reused() {
    let w = world();
    let e = w.enrolled("fresh-ids", Profile::Loss, Mode::Zk);
    let first = e.zk.clone().unwrap();

    let mut in_place = e.recovery.clone();
    in_place.enrollment.as_mut().unwrap().commitment =
        BytesN::from_array(&w.env, &ZkCredential::new("fresh-ids/other").commitment());
    assert_eq!(
        err(w.apply(&e.account, &w.doc(&e.account, Some(in_place)), 0)),
        PerchAccountError::ZkFactorChangedInPlace
    );

    let second = ZkCredential::new("fresh-ids/second");
    let mut rotated = e.recovery.clone();
    rotated.enrollment = Some(second.enrollment(&w.env));
    w.apply(&e.account, &w.doc(&e.account, Some(rotated)), 0)
        .expect("rotation to a fresh id");
    w.apply(&e.account, &w.doc(&e.account, None), 0)
        .expect("remove recovery");
    let mut back = e.recovery.clone();
    back.enrollment = Some(first.enrollment(&w.env));
    assert_eq!(
        err(w.apply(&e.account, &w.doc(&e.account, Some(back)), 0)),
        PerchAccountError::EnrollmentReused
    );
}
