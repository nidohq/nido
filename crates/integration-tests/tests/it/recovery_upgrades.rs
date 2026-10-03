//! Account upgrades on a recovery-enrolled Nido account (Perch
//! `docs/recovery/spec.md` §12; epic: "retain user-account upgrades with a
//! seven-day delay and explicit owner authorization; Protected accounts
//! additionally require their current recovery condition").
//!
//! A request binds the exact Wasm and the configuration epoch it was
//! approved under: any later epoch change (a reconfiguration, a completed
//! recovery) makes it stale, and it is cleared rather than run. Scheduling
//! and execution are refused while an attempt is authorized.

use nido_integration_tests::world::{err, world, Enrolled, Mode, Passkey, Profile, World, DELAY};
use nido_integration_tests::zk;
use nido_integration_tests::UPGRADE_TARGET_WASM;
use perch_account::PerchAccountError;
use perch_recovery::{EvidenceDomain, RecoveryError};
use perch_recovery_interface::account::ACCOUNT_UPGRADE_DELAY_LEDGERS;
use perch_recovery_interface::{RecoveryAction, StatementSubject, UpgradeSubject};
use soroban_sdk::BytesN;

fn rec(e: RecoveryError) -> PerchAccountError {
    PerchAccountError::Recovery(e)
}

fn wasm(w: &World) -> BytesN<32> {
    w.env.deployer().upload_contract_wasm(UPGRADE_TARGET_WASM)
}

fn upgrade_subject(w: &World, e: &Enrolled, wasm: &BytesN<32>) -> StatementSubject {
    StatementSubject::Upgrade(UpgradeSubject {
        request_id: w.account(&e.account).next_upgrade_request_id(),
        wasm_hash: wasm.clone(),
    })
}

/// `Protected` `GuardianOnly`: the owner alone cannot schedule; a guardian
/// quorum's recorded approval of `Upgrade { request_id, wasm_hash }` lets the
/// owner schedule exactly that Wasm, which runs after the delay and bumps
/// the epoch.
#[test]
fn a_protected_upgrade_needs_the_guardian_quorum() {
    let w = world();
    let e = w.enrolled("protected-upgrade", Profile::Protected, Mode::Guardian);
    let code = wasm(&w);
    let until = w.ledger() + 50;
    assert_eq!(
        err(w.schedule_upgrade(&e.account, &code, until)),
        rec(RecoveryError::ConditionNotMet)
    );

    let subject = upgrade_subject(&w, &e, &code);
    for g in &e.guardians[..2] {
        w.try_approve_change(&e.account, g, &subject, until)
            .unwrap();
    }
    let other = w
        .env
        .deployer()
        .upload_contract_wasm(nido_integration_tests::PERCH_RECOVERY_WASM);
    assert_eq!(
        err(w.schedule_upgrade(&e.account, &other, until)),
        rec(RecoveryError::ConditionNotMet),
        "the approval binds the exact Wasm"
    );
    let id = w
        .schedule_upgrade(&e.account, &code, until)
        .expect("approved upgrade");
    let epoch = w.ctl().epoch(&e.account.address);
    w.advance(ACCOUNT_UPGRADE_DELAY_LEDGERS);
    assert_eq!(w.execute_upgrade(&e.account, id), Ok(true));
    assert_eq!(w.ctl().epoch(&e.account.address), epoch + 1);
}

/// `Protected` `ZkOnly`: the condition is a real proof over the `Upgrade`
/// statement.
#[test]
fn a_protected_zk_upgrade_needs_a_proof_over_the_upgrade_statement() {
    let w = world();
    let e = w.enrolled("zk-upgrade", Profile::Protected, Mode::Zk);
    let code = wasm(&w);
    let until = w.ledger() + 50;
    let subject = upgrade_subject(&w, &e, &code);
    let proof = zk::evidence(
        &w,
        "upgrade-zk",
        "Protected ZkOnly: approval of an upgrade request",
        &e.account.address,
        e.zk.as_ref().unwrap(),
        &w.ctl()
            .change_statement(&e.account.address, &subject, &until),
    );
    w.ctl()
        .submit_zk_change(&e.account.address, &subject, &until, &proof);
    let id = w
        .schedule_upgrade(&e.account, &code, until)
        .expect("proven");
    w.advance(ACCOUNT_UPGRADE_DELAY_LEDGERS);
    assert_eq!(w.execute_upgrade(&e.account, id), Ok(true));
}

/// While an attempt is authorized, neither scheduling nor execution runs;
/// the completed recovery then drops the queued request.
#[test]
fn upgrades_are_blocked_in_the_window_and_dropped_by_a_completion() {
    let w = world();
    let e = w.enrolled("upgrade-window", Profile::Loss, Mode::Guardian);
    let code = wasm(&w);
    let id = w.schedule_upgrade(&e.account, &code, 0).unwrap();
    // The request is executable; then a recovery is authorized.
    w.advance(ACCOUNT_UPGRADE_DELAY_LEDGERS);

    let new_owner = Passkey::labelled("upgrade-window/new-owner");
    let replacements = w.replacements(&new_owner, None);
    let source = w.account(&e.account).applied_doc().unwrap();
    let attempt = w.begin_lost_key(&e.account, &replacements).unwrap();
    for g in &e.guardians[..2] {
        w.try_guardian(&e.account, g, attempt, EvidenceDomain::Initiate)
            .unwrap();
    }
    assert_eq!(
        err(w.execute_upgrade(&e.account, id)),
        rec(RecoveryError::AttemptAuthorized)
    );
    assert_eq!(
        err(w.schedule_upgrade(&e.account, &code, 0)),
        rec(RecoveryError::AttemptAuthorized)
    );

    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target).unwrap();
    assert_eq!(
        w.account(&e.account).pending_upgrade(),
        None,
        "a successful recovery invalidates outstanding upgrade requests"
    );
}

/// A request queued before a reconfiguration is stale afterwards: executing
/// it clears it and returns `false` instead of running the old approval.
#[test]
fn a_reconfiguration_makes_a_queued_upgrade_stale() {
    let w = world();
    let e = w.enrolled("stale-upgrade", Profile::Loss, Mode::Guardian);
    let code = wasm(&w);
    let id = w.schedule_upgrade(&e.account, &code, 0).unwrap();
    let mut quorum_one = e.recovery.clone();
    quorum_one.quorum = 1;
    w.apply(&e.account, &w.doc(&e.account, Some(quorum_one)), 0)
        .unwrap();
    w.advance(ACCOUNT_UPGRADE_DELAY_LEDGERS);
    assert_eq!(w.execute_upgrade(&e.account, id), Ok(false));
    assert_eq!(w.account(&e.account).pending_upgrade(), None);
    assert!(
        w.account(&e.account).try_applied_doc_hash().is_ok(),
        "the code is unchanged"
    );
}
