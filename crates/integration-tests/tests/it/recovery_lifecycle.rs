//! Lost-key recovery end to end for all six profile/mode combinations
//! (`Loss`/`Protected` × `GuardianOnly`/`ZkOnly`/`Combined`), on Nido's
//! stack: a factory-minted Perch account with passkeys, guardians that are
//! Nido accounts, Perch's controller, pool, and adapter from their wasm
//! builds, and real `UltraHonk` proofs. Every authorization is enforced.
//!
//! Each run checks the spec's activity rules along the way (Perch
//! `docs/recovery/spec.md` §6, §9): a collecting attempt blocks nothing;
//! once authorized, `Protected` freezes direct authorization and `execute`
//! while `Loss` keeps them; both refuse policy changes; only the derived
//! target completes, and only after the timelock; the completion revokes the
//! replaced passkey, spends the ZK nullifier, and enrolls the declared
//! replacement credential.

use nido_integration_tests::world::{err, world, Account, Mode, Passkey, Profile};
use nido_integration_tests::zk::{self, ZkCredential};
use perch_account::PerchAccountError;
use perch_recovery::{EvidenceDomain, RecoveryError};
use perch_recovery_interface::RecoveryAction;
use soroban_sdk::BytesN;

#[allow(clippy::too_many_lines)] // one recovery, in order
fn lifecycle(profile: Profile, mode: Mode) {
    let w = world();
    let label = std::format!("lifecycle-{profile:?}-{mode:?}").to_lowercase();
    let enrolled = w.enrolled(&label, profile, mode);
    let mut alice: Account = enrolled.account.clone();
    let epoch_enrolled = w.ctl().epoch(&alice.address);

    // The replacement passkey, and for ZK modes a fresh credential: the
    // completion spends the current nullifier, so the wallet rotates.
    let new_owner = Passkey::labelled(&std::format!("{label}/new-owner"));
    let rotated = enrolled
        .zk
        .as_ref()
        .map(|_| ZkCredential::new(&std::format!("{label}/rotated")));
    let replacements = w.replacements(&new_owner, rotated.as_ref().map(|c| c.enrollment(&w.env)));
    let source = w.account(&alice).applied_doc().unwrap();

    let attempt = w
        .begin_lost_key(&alice, &replacements)
        .expect("permissionless begin");
    assert!(
        w.activity(&alice, "owner"),
        "a collecting attempt blocks nothing"
    );

    // Initiation evidence. Under `Combined` neither factor alone authorizes.
    let mut nullifier: Option<BytesN<32>> = None;
    if !enrolled.guardians.is_empty() {
        w.try_guardian(
            &alice,
            &enrolled.guardians[0],
            attempt,
            EvidenceDomain::Initiate,
        )
        .unwrap();
        assert_eq!(
            w.ctl().activity_gate(&alice.address).authorized_attempt,
            None
        );
        w.try_guardian(
            &alice,
            &enrolled.guardians[1],
            attempt,
            EvidenceDomain::Initiate,
        )
        .unwrap();
    }
    if let Some(cred) = &enrolled.zk {
        if mode == Mode::Combined {
            assert_eq!(
                w.ctl().activity_gate(&alice.address).authorized_attempt,
                None,
                "a guardian quorum alone does not authorize a Combined attempt"
            );
        }
        let statement = w.statement(&alice, attempt, EvidenceDomain::Initiate);
        let evidence = zk::evidence(
            &w,
            &label,
            &std::format!("{label}: lost-key initiation"),
            &alice.address,
            cred,
            &statement,
        );
        nullifier = Some(evidence.nullifier.clone());
        w.ctl().submit_zk(
            &alice.address,
            &attempt,
            &EvidenceDomain::Initiate,
            &evidence,
        );
    }

    let gate = w.ctl().activity_gate(&alice.address);
    assert_eq!(gate.authorized_attempt, Some(attempt));
    assert_eq!(gate.frozen, profile == Profile::Protected);

    // Ordinary activity: `Loss` continues, `Protected` freezes every path.
    assert_eq!(w.activity(&alice, "owner"), profile == Profile::Loss);
    assert_eq!(w.execute(&alice, "owner").is_ok(), profile == Profile::Loss);

    // Policy changes are refused in both profiles during the window.
    let mut doc = w.doc(&alice, Some(enrolled.recovery.clone()));
    doc.rules.push(("extra", w.controller.clone()));
    let refused = w.apply(&alice, &doc, 0);
    match profile {
        Profile::Loss => assert_eq!(
            err(refused),
            PerchAccountError::Recovery(RecoveryError::AttemptAuthorized)
        ),
        Profile::Protected => assert!(refused.is_err(), "a frozen account authorizes nothing"),
    }

    // Completion: the derived target only, after the timelock.
    let target = w.target_bytes(&alice, RecoveryAction::LostKey, &source, &replacements);
    assert!(w.complete(&alice, &target).is_err(), "before the timelock");
    w.advance(nido_integration_tests::world::DELAY);
    let mut wrong = w.doc(&alice, Some(enrolled.recovery.clone()));
    wrong.signers[0].1 = Passkey::labelled("an attacker's passkey").pubkey();
    assert!(
        w.complete(&alice, &wrong.bytes(&w)).is_err(),
        "only the derived target completes"
    );
    let hash = w.complete(&alice, &target).expect("anyone completes");
    assert_eq!(w.account(&alice).applied_doc(), Some(target));
    assert_eq!(w.account(&alice).applied_doc_hash(), Some(hash));
    assert!(w.ctl().epoch(&alice.address) > epoch_enrolled);
    assert_eq!(
        w.ctl().activity_gate(&alice.address).authorized_attempt,
        None
    );

    // The old passkey is out; the new one runs the account, frozen or not.
    assert!(!w.activity(&alice, "owner"));
    let old_owner = alice.keys[0].1.clone();
    alice.keys[0].1 = new_owner;
    assert!(w.activity(&alice, "owner"));
    assert!(w.execute(&alice, "owner").is_ok());

    // The replaced passkey is revoked for good: no document may name it.
    let mut comeback = w.doc(&alice, Some(enrolled.recovery.clone()));
    comeback.signers.push(("old", old_owner.pubkey()));
    let r = w.apply(&alice, &comeback, 0);
    assert_eq!(err(r), PerchAccountError::RevokedCredential);

    if let (Some(n), Some(next)) = (nullifier, rotated) {
        assert!(w.ctl().nullifier_spent(&alice.address, &n));
        assert!(
            w.pool_client()
                .enrollment(
                    &alice.address,
                    &BytesN::from_array(&w.env, &next.enrollment_id)
                )
                .is_some(),
            "the completion inserted the rotated credential's leaf"
        );
    }
}

#[test]
fn loss_guardian_only() {
    lifecycle(Profile::Loss, Mode::Guardian);
}

#[test]
fn loss_zk_only() {
    lifecycle(Profile::Loss, Mode::Zk);
}

#[test]
fn loss_combined() {
    lifecycle(Profile::Loss, Mode::Combined);
}

#[test]
fn protected_guardian_only() {
    lifecycle(Profile::Protected, Mode::Guardian);
}

#[test]
fn protected_zk_only() {
    lifecycle(Profile::Protected, Mode::Zk);
}

#[test]
fn protected_combined() {
    lifecycle(Profile::Protected, Mode::Combined);
}
