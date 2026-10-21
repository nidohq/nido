//! Recovery across Perch redeploys. A redeploy puts the recovery controller
//! (and the ZK pool and adapter) at new addresses with no state; an account
//! keeps calling the controller its document names until its owner moves it.
//! The wallet follows the account's controller, not the deployment's
//! (`PerchRecovery`'s wiring), which this suite pins on the real wasm:
//!
//! - An attempt on an account enrolled at the earlier controller exists only
//!   there. The redeployed controller has no record of the account, so a
//!   wallet reading it would show no attempt to veto.
//! - Moving to the redeployed controller is a reconfiguration the controller
//!   being left evaluates (Perch `docs/recovery/spec.md` §10, "Remove or
//!   switch away"): under `Protected` the guardians approve it there, through
//!   their rule scoped to it. Afterwards they approve at the new controller
//!   through a rule scoped to that one, named as the wallet names it.
//! - A ZK factor moves to another pool only with a new credential (§3.4).

use nido_integration_tests::world::{
    err, strkey, world, Account, Doc, Enrolled, Mode, Passkey, Profile, World, DELAY,
};
use nido_integration_tests::zk::ZkCredential;
use nido_integration_tests::PERCH_ZK_POOL_WASM;
use perch_account::PerchAccountError;
use perch_recovery::{EvidenceDomain, PerchRecoveryClient, RecoveryError};
use perch_recovery_interface::statement::ConfigChange;
use perch_recovery_interface::{RecoveryAction, StatementSubject};
use perch_zk_pool::PerchZkPoolClient;
use soroban_sdk::{Address, BytesN};

fn rec(e: RecoveryError) -> PerchAccountError {
    PerchAccountError::Recovery(e)
}

/// The wallet's name for a further guardian rule (`newGuardianRuleName`):
/// `guardian-` and the start of the controller's address, 20 bytes in all.
fn guardian_rule(controller: &Address) -> String {
    format!("guardian-{}", strkey(controller)[..11].to_lowercase())
}

/// Give each guardian a second approval rule, scoped to `controller`.
fn add_guardian_rule(w: &World, e: &Enrolled, controller: &Address, name: &'static str) {
    for g in &e.guardians {
        let doc = Doc {
            signers: vec![("owner", g.key("owner").pubkey())],
            rules: vec![
                ("guardian", w.controller.clone()),
                (name, controller.clone()),
            ],
            recovery: None,
        };
        w.apply(g, &doc, 0).expect("a second guardian rule");
    }
}

fn guardians(e: &Enrolled) -> [&Account; 2] {
    [&e.guardians[0], &e.guardians[1]]
}

#[test]
fn an_attempt_lives_only_at_the_controller_the_account_adopted() {
    let w = world();
    let next = w.redeployed_controller("recovery-controller-next");
    let e = w.enrolled("gen-loss", Profile::Loss, Mode::Guardian);
    assert_eq!(
        w.account(&e.account).recovery_controller(),
        Some(w.controller.clone())
    );

    let replacements = w.replacements(&Passkey::labelled("gen-loss/new"), None);
    let attempt = w.begin_lost_key(&e.account, &replacements).unwrap();
    for g in guardians(&e) {
        w.try_guardian(&e.account, g, attempt, EvidenceDomain::Initiate)
            .unwrap();
    }
    assert_eq!(
        w.ctl().activity_gate(&e.account.address).authorized_attempt,
        Some(attempt)
    );

    // The redeployed controller knows nothing of the account: no attempt to
    // show, and none it could open.
    let other = PerchRecoveryClient::new(&w.env, &next);
    assert_eq!(other.config(&e.account.address), None);
    assert_eq!(
        other.activity_gate(&e.account.address).authorized_attempt,
        None
    );
    assert_eq!(
        err(other.try_begin_lost_key(&e.account.address, &replacements)),
        RecoveryError::NotEnrolled
    );

    // The owner's veto goes through the account to its own controller.
    w.owner_cancel(&e.account, attempt).expect("veto");
    assert_eq!(
        w.ctl().activity_gate(&e.account.address).authorized_attempt,
        None
    );
}

#[test]
fn a_protected_account_moves_with_approvals_at_the_controller_it_leaves() {
    let w = world();
    let next = w.redeployed_controller("recovery-controller-next");
    let e = w.enrolled("gen-move", Profile::Protected, Mode::Guardian);
    // `Doc` names rules by `&'static str`.
    let rule: &'static str = guardian_rule(&next).leak();
    assert_eq!(rule.len(), 20);
    add_guardian_rule(&w, &e, &next, rule);

    let mut moved = e.recovery.clone();
    moved.controller = next.clone();
    let doc = w.doc(&e.account, Some(moved));
    let change = StatementSubject::Reconfigure(ConfigChange::Set(w.config_hash(&doc)));
    let until = w.ledger() + 50;

    assert_eq!(
        err(w.apply(&e.account, &doc, until)),
        rec(RecoveryError::ConditionNotMet),
        "the owner alone cannot move it"
    );
    // The controller it moves to cannot even state the change: it has no
    // configuration of the account yet.
    let ctl = PerchRecoveryClient::new(&w.env, &next);
    assert_eq!(
        err(ctl.try_change_statement(&e.account.address, &change, &until)),
        RecoveryError::NotEnrolled
    );

    for g in guardians(&e) {
        w.try_approve_change(&e.account, g, &change, until).unwrap();
    }
    w.apply(&e.account, &doc, until).expect("the approved move");
    assert_eq!(
        w.account(&e.account).recovery_controller(),
        Some(next.clone())
    );
    assert_eq!(w.ctl().config(&e.account.address), None);
    assert_eq!(ctl.config(&e.account.address).unwrap().controller, next);

    // Recovery now runs at the new controller, through the guardians' rule
    // scoped to it; the rule scoped to the earlier one authorizes nothing
    // there.
    let new_owner = Passkey::labelled("gen-move/new");
    let replacements = w.replacements(&new_owner, None);
    let attempt = ctl
        .try_begin_lost_key(&e.account.address, &replacements)
        .unwrap()
        .unwrap();
    assert!(w
        .try_guardian_at(
            &next,
            "guardian",
            &e.account,
            &e.guardians[0],
            attempt,
            EvidenceDomain::Initiate
        )
        .is_err());
    for g in guardians(&e) {
        w.try_guardian_at(
            &next,
            rule,
            &e.account,
            g,
            attempt,
            EvidenceDomain::Initiate,
        )
        .unwrap();
    }
    assert_eq!(
        ctl.activity_gate(&e.account.address).authorized_attempt,
        Some(attempt)
    );
    w.advance(DELAY);
    let source = w.account(&e.account).applied_doc().unwrap();
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target)
        .expect("completion at the new controller");
    assert_eq!(
        w.account(&e.account).recovery_controller(),
        Some(next.clone())
    );
}

#[test]
fn a_zk_factor_moves_to_another_pool_only_with_a_new_credential() {
    let w = world();
    let next = w.redeployed_controller("recovery-controller-next");
    let next_pool = nido_integration_tests::world::contract_at(&w.env, "zk-pool-next");
    w.env.register_at(&next_pool, PERCH_ZK_POOL_WASM, ());
    let e = w.enrolled("gen-zk", Profile::Loss, Mode::Zk);

    let mut moved = e.recovery.clone();
    moved.controller = next.clone();
    moved.pool = next_pool.clone();
    assert_eq!(
        err(w.apply(&e.account, &w.doc(&e.account, Some(moved.clone())), 0)),
        PerchAccountError::ZkFactorChangedInPlace
    );

    let fresh = ZkCredential::new("gen-zk/next");
    moved.enrollment = Some(fresh.enrollment(&w.env));
    w.apply(&e.account, &w.doc(&e.account, Some(moved)), 0)
        .expect("moved with a new credential");
    assert_eq!(w.account(&e.account).recovery_controller(), Some(next));
    assert!(PerchZkPoolClient::new(&w.env, &next_pool)
        .enrollment(
            &e.account.address,
            &BytesN::from_array(&w.env, &fresh.enrollment_id)
        )
        .is_some());
}
