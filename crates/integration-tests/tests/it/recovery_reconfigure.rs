//! Recovery reconfiguration on Nido's stack (Perch `docs/recovery/spec.md`
//! §5, §10; epic: "general recovery reconfiguration is supported").
//!
//! - `Loss`: the owner alone rotates guardians, changes the threshold or the
//!   mode, and disables recovery.
//! - `Protected`: the owner plus the currently enrolled condition, recorded
//!   before the `apply_doc` that consumes it: a guardian quorum
//!   (`approve_change`), a real ZK proof over a `Reconfigure` statement
//!   (`submit_zk_change`, a domain no other action's proof satisfies —
//!   nidohq/nido#230), or both under `Combined`.
//!
//! Every reconfiguration goes through the account's own `apply_doc` (the
//! controller's configuration is written only by `rcv_sync`), so there is no
//! direct enroll/reconfigure entry point to bypass it (nidohq/nido#217).

use nido_integration_tests::world::{err, world, Account, Enrolled, Mode, Profile, World};
use nido_integration_tests::zk::{self, ZkCredential};
use perch_account::PerchAccountError;
use perch_recovery::RecoveryError;
use perch_recovery_interface::statement::ConfigChange;
use perch_recovery_interface::StatementSubject;
use soroban_sdk::BytesN;

fn rec(e: RecoveryError) -> PerchAccountError {
    PerchAccountError::Recovery(e)
}

fn guardians(e: &Enrolled) -> std::vec::Vec<&Account> {
    e.guardians.iter().collect()
}

fn set(
    w: &World,
    e: &Enrolled,
    next: &nido_integration_tests::world::Recovery,
) -> StatementSubject {
    StatementSubject::Reconfigure(ConfigChange::Set(
        w.config_hash(&w.doc(&e.account, Some(next.clone()))),
    ))
}

/// `Loss`: guardian rotation, a threshold change, a mode change that enrolls
/// a ZK credential (its leaf is inserted in the same `apply_doc`), and
/// disabling recovery all need only the owner, and each bumps the epoch.
#[test]
fn loss_reconfiguration_needs_only_the_owner() {
    let w = world();
    let e = w.enrolled("loss-reconfig", Profile::Loss, Mode::Guardian);
    let epoch = w.ctl().epoch(&e.account.address);

    let newcomer = w.guardian(
        "loss-reconfig/newcomer",
        nido_integration_tests::world::Passkey::labelled("loss-reconfig/newcomer"),
    );
    let mut rotated = e.recovery.clone();
    rotated.guardians[2] = newcomer.address.clone();
    rotated.quorum = 3;
    w.apply(&e.account, &w.doc(&e.account, Some(rotated.clone())), 0)
        .expect("guardian rotation and threshold change");
    let config = w.ctl().config(&e.account.address).unwrap();
    assert_eq!(config.guardians().unwrap().quorum, 3);
    assert!(config
        .guardians()
        .unwrap()
        .guardians
        .contains(&newcomer.address));
    assert_eq!(w.ctl().epoch(&e.account.address), epoch + 1);

    let cred = ZkCredential::new("loss-reconfig/zk");
    let mut combined = rotated;
    combined.mode = Mode::Combined;
    combined.enrollment = Some(cred.enrollment(&w.env));
    w.apply(&e.account, &w.doc(&e.account, Some(combined)), 0)
        .expect("mode change");
    assert!(w
        .pool_client()
        .enrollment(
            &e.account.address,
            &BytesN::from_array(&w.env, &cred.enrollment_id)
        )
        .is_some());

    w.apply(&e.account, &w.doc(&e.account, None), 0)
        .expect("disable recovery");
    assert_eq!(w.ctl().config(&e.account.address), None);
    assert_eq!(w.account(&e.account).recovery_controller(), None);
    assert_eq!(w.rule_id(&e.account.address, "recovery"), u32::MAX);
    assert_eq!(w.ctl().epoch(&e.account.address), epoch + 3);
}

/// `Protected` `GuardianOnly`: the owner alone cannot reconfigure. A quorum
/// of approvals binds the exact new configuration and its freshness bound,
/// and dies with the epoch; removal is its own change.
#[test]
fn protected_reconfiguration_needs_a_guardian_quorum() {
    let w = world();
    let e = w.enrolled("protected-reconfig", Profile::Protected, Mode::Guardian);
    let mut quorum_one = e.recovery.clone();
    quorum_one.quorum = 1;
    let next = w.doc(&e.account, Some(quorum_one.clone()));
    let change = set(&w, &e, &quorum_one);
    let until = w.ledger() + 50;

    assert_eq!(
        err(w.apply(&e.account, &next, until)),
        rec(RecoveryError::ConditionNotMet)
    );
    w.try_approve_change(&e.account, &e.guardians[0], &change, until)
        .unwrap();
    assert_eq!(
        err(w.apply(&e.account, &next, until)),
        rec(RecoveryError::ConditionNotMet),
        "1 of 2"
    );
    w.try_approve_change(&e.account, &e.guardians[1], &change, until)
        .unwrap();
    assert_eq!(
        err(w.apply(&e.account, &next, until + 1)),
        rec(RecoveryError::ConditionNotMet),
        "the approvals bind their freshness bound"
    );
    let mut other = e.recovery.clone();
    other.quorum = 3;
    assert_eq!(
        err(w.apply(&e.account, &w.doc(&e.account, Some(other)), until)),
        rec(RecoveryError::ConditionNotMet),
        "and the exact configuration"
    );
    assert_eq!(
        err(w.apply(&e.account, &w.doc(&e.account, None), until)),
        rec(RecoveryError::ConditionNotMet),
        "removal is a different change"
    );

    w.apply(&e.account, &next, until)
        .expect("approved reconfiguration");
    assert_eq!(
        err(w.apply(
            &e.account,
            &w.doc(&e.account, Some(e.recovery.clone())),
            until
        )),
        rec(RecoveryError::ConditionNotMet),
        "the approvals died with the epoch"
    );

    let remove = StatementSubject::Reconfigure(ConfigChange::Remove);
    w.try_approve_change(&e.account, &e.guardians[2], &remove, until)
        .unwrap();
    w.apply(&e.account, &w.doc(&e.account, None), until)
        .expect("removal approved by the condition now enrolled (quorum 1)");
    assert_eq!(w.ctl().config(&e.account.address), None);
}

/// `Protected` `ZkOnly` reconfigures with a real proof over its own
/// `Reconfigure` statement (nidohq/nido#230): a proof of another change does
/// not serve, and proving spends nothing.
#[test]
fn protected_zk_reconfiguration_is_its_own_proven_action() {
    let w = world();
    let e = w.enrolled("zk-reconfig", Profile::Protected, Mode::Zk);
    let cred = e.zk.clone().unwrap();
    let mut slower = e.recovery.clone();
    slower.delay *= 2;
    let next = w.doc(&e.account, Some(slower.clone()));
    let change = set(&w, &e, &slower);
    let until = w.ledger() + 50;

    let remove = StatementSubject::Reconfigure(ConfigChange::Remove);
    let wrong = zk::evidence(
        &w,
        "reconfigure-zk-remove",
        "Protected ZkOnly: a Reconfigure(Remove) proof, offered for a Set",
        &e.account.address,
        &cred,
        &w.ctl()
            .change_statement(&e.account.address, &remove, &until),
    );
    assert_eq!(
        w.ctl()
            .try_submit_zk_change(&e.account.address, &change, &until, &wrong),
        Err(Ok(RecoveryError::ZkEvidenceRejected))
    );
    assert_eq!(
        err(w.apply(&e.account, &next, until)),
        rec(RecoveryError::ConditionNotMet)
    );

    let proof = zk::evidence(
        &w,
        "reconfigure-zk-set",
        "Protected ZkOnly: Reconfigure(Set) to a slower delay",
        &e.account.address,
        &cred,
        &w.ctl()
            .change_statement(&e.account.address, &change, &until),
    );
    w.ctl()
        .submit_zk_change(&e.account.address, &change, &until, &proof);
    w.apply(&e.account, &next, until)
        .expect("proven reconfiguration");
    assert_eq!(
        w.ctl().config(&e.account.address).unwrap().delay_ledgers,
        slower.delay
    );
    assert!(!w
        .ctl()
        .nullifier_spent(&e.account.address, &proof.nullifier));
}

/// `Protected` `Combined` needs both factors over the same statement: a
/// guardian quorum alone, or a proof alone, is not the condition.
#[test]
fn protected_combined_reconfiguration_needs_both_factors() {
    let w = world();
    let e = w.enrolled("combined-reconfig", Profile::Protected, Mode::Combined);
    let cred = e.zk.clone().unwrap();
    let mut rotated = e.recovery.clone();
    rotated.quorum = 3;
    let next = w.doc(&e.account, Some(rotated.clone()));
    let change = set(&w, &e, &rotated);
    let until = w.ledger() + 50;

    let refs = guardians(&e);
    for g in &refs[..2] {
        w.try_approve_change(&e.account, g, &change, until).unwrap();
    }
    assert_eq!(
        err(w.apply(&e.account, &next, until)),
        rec(RecoveryError::ConditionNotMet),
        "a quorum without the proof"
    );
    let proof = zk::evidence(
        &w,
        "reconfigure-combined",
        "Protected Combined: the ZK half of a Reconfigure(Set)",
        &e.account.address,
        &cred,
        &w.ctl()
            .change_statement(&e.account.address, &change, &until),
    );
    w.ctl()
        .submit_zk_change(&e.account.address, &change, &until, &proof);
    w.apply(&e.account, &next, until)
        .expect("both factors recorded");
    assert_eq!(
        w.ctl()
            .config(&e.account.address)
            .unwrap()
            .guardians()
            .unwrap()
            .quorum,
        3
    );
}

/// Rotating a passkey elsewhere in the document is not a reconfiguration:
/// the recovery text is unchanged, so even `Protected` needs no condition
/// and the epoch stays (perch#92, nidohq/nido#219).
#[test]
fn rotating_a_passkey_is_not_a_reconfiguration() {
    let w = world();
    let e = w.enrolled("key-rotation", Profile::Protected, Mode::Guardian);
    let epoch = w.ctl().epoch(&e.account.address);
    let config = w.ctl().config(&e.account.address).unwrap();
    let mut rotated = w.doc(&e.account, Some(e.recovery.clone()));
    rotated.signers[1].1 =
        nido_integration_tests::world::Passkey::labelled("key-rotation/new-device").pubkey();
    w.apply(&e.account, &rotated, 0)
        .expect("no condition needed");
    assert_eq!(w.ctl().epoch(&e.account.address), epoch);
    assert_eq!(
        w.ctl().config(&e.account.address).unwrap().config_hash,
        config.config_hash
    );
}
