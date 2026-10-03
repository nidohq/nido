//! The recovery state machine's rules and its adversarial paths, on Nido's
//! stack with real proofs and enforcing authorization (Perch
//! `docs/recovery/spec.md` §6–§9, §11, §14). Lifecycles are in
//! `recovery_lifecycle.rs`; reconfiguration and upgrades have their own
//! suites.

use nido_integration_tests::world::{
    err, world, Account, Enrolled, Mode, Passkey, Profile, World, DELAY,
};
use nido_integration_tests::zk::{self, ZkCredential};
use perch_account::PerchAccountError;
use perch_recovery::{AttemptState, EvidenceDomain, RecoveryError};
use perch_recovery_interface::credential::{Credential, Replacement, ReplacementSet};
use perch_recovery_interface::zk::{ZkAdapterClient, ZkAdapterError, ZkEvidence};
use perch_recovery_interface::RecoveryAction;
use soroban_sdk::{vec, Bytes, BytesN};

use EvidenceDomain::{Cancel, Initiate};

fn state(w: &World, account: &Account, attempt: u64) -> AttemptState {
    w.ctl().attempt(&account.address, &attempt).unwrap().state
}

/// Open a lost-key attempt replacing `owner` with a fresh passkey. A ZK mode
/// must also declare the credential that replaces the one the completion
/// spends.
fn open(w: &World, e: &Enrolled, label: &str) -> (u64, Passkey, ReplacementSet) {
    let new_owner = Passkey::labelled(label);
    let rotated =
        e.zk.as_ref()
            .map(|_| ZkCredential::new(&std::format!("{label}/rotated")).enrollment(&w.env));
    let replacements = w.replacements(&new_owner, rotated);
    let id = w.begin_lost_key(&e.account, &replacements).unwrap();
    (id, new_owner, replacements)
}

/// Satisfy a guardian mode's initiation quorum.
fn quorum(w: &World, e: &Enrolled, attempt: u64, domain: EvidenceDomain) {
    w.try_guardian(&e.account, &e.guardians[0], attempt, domain)
        .unwrap();
    w.try_guardian(&e.account, &e.guardians[1], attempt, domain)
        .unwrap();
}

fn submit_zk(
    w: &World,
    account: &Account,
    attempt: u64,
    domain: EvidenceDomain,
    evidence: &ZkEvidence,
) -> Result<(), Result<RecoveryError, soroban_sdk::InvokeError>> {
    w.ctl()
        .try_submit_zk(&account.address, &attempt, &domain, evidence)
        .map(|r| r.unwrap())
}

// ---------------------------------------------------------------------------
// Evidence-free griefing and attempt replacement (D2, perch#89)
// ---------------------------------------------------------------------------

/// Anyone may open attempts, and collecting attempts freeze nothing and block
/// nothing, even under `Protected`; the first one authorized invalidates its
/// siblings, and no attempt opens while it is live.
#[test]
fn evidence_free_attempts_block_nothing_and_the_first_authorized_wins() {
    let w = world();
    let e = w.enrolled("griefed", Profile::Protected, Mode::Guardian);
    let ids: std::vec::Vec<u64> = (0..4)
        .map(|i| open(&w, &e, &std::format!("griefer-{i}")).0)
        .collect();

    assert_eq!(w.account(&e.account).recovery_gate(), None);
    assert!(w.activity(&e.account, "owner"));
    assert!(w.execute(&e.account, "owner").is_ok());
    // The owner keeps managing the account: a rotated device key needs no
    // recovery evidence, because the recovery text is unchanged.
    let mut rotated = w.doc(&e.account, Some(e.recovery.clone()));
    rotated.signers[1].1 = Passkey::labelled("griefed/new-device").pubkey();
    w.apply(&e.account, &rotated, 0)
        .expect("policy writes continue");

    // That rotation changed the lost-key source: an open attempt can collect
    // evidence but never be authorized over the old snapshot.
    w.try_guardian(&e.account, &e.guardians[0], ids[0], Initiate)
        .unwrap();
    assert_eq!(
        w.try_guardian(&e.account, &e.guardians[1], ids[0], Initiate),
        Err(Ok(RecoveryError::AttemptNotLive))
    );
    let (a, _, _) = open(&w, &e, "fresh-a");
    let (b, _, _) = open(&w, &e, "fresh-b");
    w.try_guardian(&e.account, &e.guardians[0], a, Initiate)
        .unwrap();
    quorum(&w, &e, b, Initiate);
    assert_eq!(state(&w, &e.account, b), AttemptState::Authorized);
    assert_eq!(
        w.try_guardian(&e.account, &e.guardians[1], a, Initiate),
        Err(Ok(RecoveryError::AttemptNotLive)),
        "the authorized sibling invalidated it"
    );
    assert_eq!(
        w.begin_lost_key(
            &e.account,
            &w.replacements(&Passkey::labelled("late"), None)
        ),
        Err(Ok(RecoveryError::AttemptAuthorized))
    );
}

// ---------------------------------------------------------------------------
// Cancellation (D5)
// ---------------------------------------------------------------------------

/// Under `Loss` the owner can always veto, uncapped; under `Protected` the
/// owner cannot (a stolen key must not cancel the real owner's recovery).
#[test]
fn a_loss_owner_vetoes_and_a_protected_owner_cannot() {
    let w = world();
    let loss = w.enrolled("loss-veto", Profile::Loss, Mode::Guardian);
    for i in 0..4 {
        let (id, _, _) = open(&w, &loss, &std::format!("loss-veto-{i}"));
        quorum(&w, &loss, id, Initiate);
        w.owner_cancel(&loss.account, id).expect("owner veto");
        assert_eq!(state(&w, &loss.account, id), AttemptState::Cancelled);
    }
    assert!(w.activity(&loss.account, "owner"));

    let protected = w.enrolled("protected-veto", Profile::Protected, Mode::Guardian);
    let (collecting, _, _) = open(&w, &protected, "protected-veto");
    assert_eq!(
        err(w.owner_cancel(&protected.account, collecting)),
        PerchAccountError::Recovery(RecoveryError::OwnerCancelRefused)
    );
    quorum(&w, &protected, collecting, Initiate);
    assert!(
        w.owner_cancel(&protected.account, collecting).is_err(),
        "a frozen account cannot even sign the cancellation"
    );
}

/// Under `Protected` the guardian quorum cancels with evidence over the
/// attempt's `Cancel` statement; cancelling an authorized attempt lifts the
/// freeze and counts toward `max-cancels`, after which the next authorized
/// attempt completes.
#[test]
fn guardian_cancellation_lifts_the_freeze_and_is_capped() {
    let w = world();
    let account = w.mint(
        "capped",
        Passkey::labelled("capped/owner"),
        std::vec![("device", Passkey::labelled("capped/device"))],
    );
    let guardians: std::vec::Vec<Account> = (0..3)
        .map(|i| {
            w.guardian(
                &std::format!("capped/g{i}"),
                Passkey::labelled(&std::format!("capped/g{i}")),
            )
        })
        .collect();
    let refs: std::vec::Vec<&Account> = guardians.iter().collect();
    let mut recovery = w.recovery(Profile::Protected, Mode::Guardian, &refs, 2, None);
    recovery.max_cancels = 1;
    w.apply(&account, &w.doc(&account, Some(recovery.clone())), 0)
        .unwrap();
    let e = Enrolled {
        account,
        guardians,
        zk: None,
        recovery,
    };

    let (first, _, _) = open(&w, &e, "capped-1");
    quorum(&w, &e, first, Initiate);
    assert!(w.account(&e.account).recovery_gate().is_some());
    assert!(!w.activity(&e.account, "owner"));
    quorum(&w, &e, first, Cancel);
    assert_eq!(state(&w, &e.account, first), AttemptState::Cancelled);
    assert_eq!(w.account(&e.account).recovery_gate(), None);
    assert!(w.activity(&e.account, "owner"), "the freeze is lifted");

    let (second, _, replacements) = open(&w, &e, "capped-2");
    let source = w.account(&e.account).applied_doc().unwrap();
    quorum(&w, &e, second, Initiate);
    w.try_guardian(&e.account, &e.guardians[0], second, Cancel)
        .unwrap();
    assert_eq!(
        w.try_guardian(&e.account, &e.guardians[1], second, Cancel),
        Err(Ok(RecoveryError::MaxCancelsReached))
    );
    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target)
        .expect("the uncancellable attempt completes");
}

/// A `Protected` `ZkOnly` account cancels with a real proof over the
/// attempt's `Cancel` statement, which no initiation proof satisfies.
#[test]
fn a_zk_cancellation_proof_lifts_the_freeze() {
    let w = world();
    let e = w.enrolled("zk-cancel", Profile::Protected, Mode::Zk);
    let cred = e.zk.clone().unwrap();
    let (id, _, _) = open(&w, &e, "zk-cancel/new-owner");

    let initiate = zk::evidence(
        &w,
        "rules-zk-cancel-initiate",
        "Protected ZkOnly: initiation, cancelled below",
        &e.account.address,
        &cred,
        &w.statement(&e.account, id, Initiate),
    );
    submit_zk(&w, &e.account, id, Initiate, &initiate).unwrap();
    assert!(!w.activity(&e.account, "owner"), "frozen");

    assert_eq!(
        submit_zk(&w, &e.account, id, Cancel, &initiate),
        Err(Ok(RecoveryError::ZkEvidenceRejected)),
        "an initiation proof is not a cancellation proof"
    );
    let cancel = zk::evidence(
        &w,
        "rules-zk-cancel",
        "Protected ZkOnly: cancellation of an authorized attempt",
        &e.account.address,
        &cred,
        &w.statement(&e.account, id, Cancel),
    );
    submit_zk(&w, &e.account, id, Cancel, &cancel).unwrap();
    assert_eq!(state(&w, &e.account, id), AttemptState::Cancelled);
    assert!(w.activity(&e.account, "owner"), "the freeze is lifted");
    assert!(
        !w.ctl()
            .nullifier_spent(&e.account.address, &cancel.nullifier),
        "only a completion spends the nullifier"
    );
}

// ---------------------------------------------------------------------------
// Proof binding and replay (D9, D13, D14)
// ---------------------------------------------------------------------------

/// A real proof binds one statement (network, account, controller,
/// configuration, timing, action, attempt), one enrollment, and one pool
/// root: it never counts for another attempt, account, or action, it counts
/// once, and any change to it is refused.
#[test]
fn a_proof_never_counts_for_another_attempt_account_or_action() {
    let w = world();
    let alice = w.enrolled("binding-alice", Profile::Protected, Mode::Zk);
    let bob = w.enrolled("binding-bob", Profile::Protected, Mode::Zk);
    let cred = alice.zk.clone().unwrap();
    let (first, _, _) = open(&w, &alice, "binding/new-owner-1");
    let (second, _, _) = open(&w, &alice, "binding/new-owner-2");
    let (bobs, _, _) = open(&w, &bob, "binding/bob-new-owner");

    let evidence = zk::evidence(
        &w,
        "rules-binding",
        "Protected ZkOnly: alice's initiation of her first attempt",
        &alice.account.address,
        &cred,
        &w.statement(&alice.account, first, Initiate),
    );
    let rejected = Err(Ok(RecoveryError::ZkEvidenceRejected));
    assert_eq!(
        submit_zk(&w, &alice.account, second, Initiate, &evidence),
        rejected
    );
    assert_eq!(
        submit_zk(&w, &alice.account, first, Cancel, &evidence),
        rejected
    );
    assert_eq!(
        submit_zk(&w, &bob.account, bobs, Initiate, &evidence),
        rejected
    );

    let mut tampered = evidence.clone();
    let mut proof = std::vec![0u8; tampered.proof.len() as usize];
    tampered.proof.copy_into_slice(&mut proof);
    proof[200] ^= 1;
    tampered.proof = Bytes::from_slice(&w.env, &proof);
    assert_eq!(
        submit_zk(&w, &alice.account, first, Initiate, &tampered),
        rejected
    );

    // The adapter names why: an unknown root, a foreign nullifier.
    let factor = w.ctl().config(&alice.account.address).unwrap();
    let binding = factor.zk().unwrap().binding();
    let adapter = ZkAdapterClient::new(&w.env, &w.adapter);
    let statement = w.statement(&alice.account, first, Initiate);
    let mut fabricated = evidence.clone();
    fabricated.root = BytesN::from_array(&w.env, &[3; 32]);
    assert_eq!(
        adapter.try_verify(&statement, &binding, &fabricated),
        Err(Ok(ZkAdapterError::UnknownRoot))
    );
    let mut foreign = evidence.clone();
    foreign.nullifier = BytesN::from_array(&w.env, &[4; 32]);
    assert_eq!(
        adapter.try_verify(&statement, &binding, &foreign),
        Err(Ok(ZkAdapterError::ProofRejected))
    );

    submit_zk(&w, &alice.account, first, Initiate, &evidence).expect("the real proof");
    assert_eq!(
        submit_zk(&w, &alice.account, first, Initiate, &evidence),
        Err(Ok(RecoveryError::AttemptNotCollecting)),
        "counted once"
    );
}

/// The pool accepts every root a tree has had (spec §14.1): a proof built
/// against an older root still verifies after other accounts enroll, so
/// nobody can race a victim's evidence out of the pool.
#[test]
fn a_proof_against_an_older_root_still_verifies() {
    let w = world();
    let e = w.enrolled("older-root", Profile::Loss, Mode::Zk);
    let (id, _, replacements) = open(&w, &e, "older-root/new-owner");
    let source = w.account(&e.account).applied_doc().unwrap();
    let evidence = zk::evidence(
        &w,
        "rules-older-root",
        "Loss ZkOnly: proved before two later enrollments moved the root",
        &e.account.address,
        e.zk.as_ref().unwrap(),
        &w.statement(&e.account, id, Initiate),
    );
    for i in 0..2 {
        let _ = w.enrolled(&std::format!("later-{i}"), Profile::Loss, Mode::Zk);
    }
    assert_ne!(w.pool_client().tree(&0).root, evidence.root);
    submit_zk(&w, &e.account, id, Initiate, &evidence).expect("historical root");
    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target).unwrap();
}

/// A full depth-32 tree seals and the pool rolls over (spec §14.2): the next
/// enrollment lands in tree 1, and the sealed tree's last member still
/// recovers with a proof against tree 0.
#[test]
fn a_full_tree_rolls_over_and_its_last_member_still_recovers() {
    let w = world();
    zk::synthesize_prefix(&w);
    let e = w.enrolled("last-slot", Profile::Loss, Mode::Zk);
    let cred = e.zk.clone().unwrap();
    let at = w
        .pool_client()
        .enrollment(
            &e.account.address,
            &BytesN::from_array(&w.env, &cred.enrollment_id),
        )
        .unwrap();
    assert_eq!((at.tree_id, at.index), (0, u64::from(u32::MAX)));
    assert!(w.pool_client().tree(&0).sealed);

    let next = w.enrolled("first-of-tree-1", Profile::Loss, Mode::Zk);
    let next_at = w
        .pool_client()
        .enrollment(
            &next.account.address,
            &BytesN::from_array(&w.env, &next.zk.unwrap().enrollment_id),
        )
        .unwrap();
    assert_eq!((next_at.tree_id, next_at.index), (1, 0));

    let (id, _, replacements) = open(&w, &e, "last-slot/new-owner");
    let source = w.account(&e.account).applied_doc().unwrap();
    let evidence = zk::evidence(
        &w,
        "rules-full-tree",
        "Loss ZkOnly: the last slot of a sealed depth-32 tree, after rollover",
        &e.account.address,
        &cred,
        &w.statement(&e.account, id, Initiate),
    );
    assert_eq!(evidence.tree_id, 0);
    submit_zk(&w, &e.account, id, Initiate, &evidence).expect("sealed tree proof");
    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target).unwrap();
}

/// Recovery state that expired into the archive is restored, never reset:
/// the account's rules and enrolled ids, the controller's configuration and
/// epoch, and the pool's tree all come back, and a real proof against the
/// archived root completes.
///
/// Restoring is not free. Restored entries count as writes, and restoring
/// everything a recovery touches in one invocation (the shared doc compiler's
/// and the account's code included) exceeds the network's per-transaction
/// write limit. So a client first restores in separate invocations — here the
/// permissionless `renew` calls and views, on a live network `RestoreFootprint`
/// operations — and then recovers.
#[test]
fn archived_recovery_state_is_restored_not_reset() {
    let w = world();
    let e = w.enrolled("archived", Profile::Loss, Mode::Zk);
    let cred = e.zk.clone().unwrap();
    let enrollment_id = BytesN::from_array(&w.env, &cred.enrollment_id);
    let epoch = w.ctl().epoch(&e.account.address);
    let max = w
        .env
        .as_contract(&w.controller, || w.env.storage().max_ttl());
    w.advance(max + 1);

    // Restore, one bounded invocation at a time.
    assert_eq!(
        w.ctl().epoch(&e.account.address),
        epoch,
        "restored, not reset"
    );
    w.ctl().renew(&e.account.address);
    w.pool_client().renew_tree(&0);
    w.pool_client()
        .renew_enrollment(&e.account.address, &enrollment_id);
    w.account(&e.account).renew(
        &soroban_sdk::Vec::new(&w.env),
        &vec![&w.env, enrollment_id.clone()],
    );
    assert!(w.account(&e.account).is_enrolled_id(&enrollment_id));
    let _ = w.circuit_id();
    let source = w.account(&e.account).applied_doc().unwrap();
    let _ = w.compiler().compile_doc(&source);

    let (id, _, replacements) = open(&w, &e, "archived/new-owner");
    let evidence = zk::evidence(
        &w,
        "rules-archived",
        "Loss ZkOnly: after every recovery entry expired into the archive",
        &e.account.address,
        &cred,
        &w.statement(&e.account, id, Initiate),
    );
    submit_zk(&w, &e.account, id, Initiate, &evidence).unwrap();
    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target).unwrap();
}

/// The renewal entry points are permissionless: under enforcing auth with no
/// entries at all, anyone keeps an account's recovery state alive.
#[test]
fn recovery_state_renewal_needs_no_authorization() {
    let w = world();
    let e = w.enrolled("renewed", Profile::Protected, Mode::Combined);
    let cred = e.zk.clone().unwrap();
    let id = BytesN::from_array(&w.env, &cred.enrollment_id);
    w.ctl().renew(&e.account.address);
    w.pool_client().renew_tree(&0);
    w.pool_client().renew_enrollment(&e.account.address, &id);
    w.account(&e.account)
        .renew(&soroban_sdk::Vec::new(&w.env), &vec![&w.env, id]);
}

// ---------------------------------------------------------------------------
// Permitted changes (D6, D7)
// ---------------------------------------------------------------------------

/// If the applied document changes while a lost-key attempt collects, the
/// agreed snapshot is gone: the attempt can never be authorized, and a fresh
/// attempt over the new document completes.
#[test]
fn a_lost_key_attempt_whose_source_changed_needs_a_fresh_attempt() {
    let w = world();
    let e = w.enrolled("stale-source", Profile::Loss, Mode::Guardian);
    let (stale, _, _) = open(&w, &e, "stale-source/1");
    w.try_guardian(&e.account, &e.guardians[0], stale, Initiate)
        .unwrap();

    let mut rotated = w.doc(&e.account, Some(e.recovery.clone()));
    rotated.signers[1].1 = Passkey::labelled("stale-source/new-device").pubkey();
    w.apply(&e.account, &rotated, 0).unwrap();
    assert_eq!(
        w.try_guardian(&e.account, &e.guardians[1], stale, Initiate),
        Err(Ok(RecoveryError::AttemptNotLive))
    );

    let (fresh, _, replacements) = open(&w, &e, "stale-source/2");
    let source = w.account(&e.account).applied_doc().unwrap();
    quorum(&w, &e, fresh, Initiate);
    w.advance(DELAY);
    let target = w.target_bytes(&e.account, RecoveryAction::LostKey, &source, &replacements);
    w.complete(&e.account, &target).unwrap();
}

/// A replacement must be the same kind of credential with the same verifier
/// as the slot it replaces, and may only replace a declared replaceable
/// signer; guardians must be enrolled and count once.
#[test]
fn replacements_and_approvals_are_validated() {
    let w = world();
    let e = w.enrolled("validated", Profile::Loss, Mode::Guardian);
    let delegated = ReplacementSet {
        signers: vec![
            &w.env,
            Replacement {
                signer_id: soroban_sdk::String::from_str(&w.env, "owner"),
                credential: Credential::Delegated(e.guardians[2].address.clone()),
            },
        ],
        zk_enrollment: soroban_sdk::Vec::new(&w.env),
    };
    assert!(w.begin_lost_key(&e.account, &delegated).is_err());
    let not_replaceable = ReplacementSet {
        signers: vec![
            &w.env,
            Replacement {
                signer_id: soroban_sdk::String::from_str(&w.env, "device"),
                credential: Passkey::labelled("validated/x").credential(&w.env, &w.verifier),
            },
        ],
        zk_enrollment: soroban_sdk::Vec::new(&w.env),
    };
    assert!(w.begin_lost_key(&e.account, &not_replaceable).is_err());

    let (id, _, _) = open(&w, &e, "validated/new-owner");
    let outsider = w.guardian(
        "validated/outsider",
        Passkey::labelled("validated/outsider"),
    );
    assert_eq!(
        w.try_guardian(&e.account, &outsider, id, Initiate),
        Err(Ok(RecoveryError::NotAGuardian))
    );
    w.try_guardian(&e.account, &e.guardians[0], id, Initiate)
        .unwrap();
    assert_eq!(
        w.try_guardian(&e.account, &e.guardians[0], id, Initiate),
        Err(Ok(RecoveryError::AlreadyCounted))
    );
}

/// Compromise recovery restores the enrolled baseline: a thief holding the
/// owner passkey adds a signer (no recovery text changes, so no condition
/// is needed), and the completion restores the baseline's signers and rules
/// with the declared replacement, revoking everything it removes.
#[test]
fn compromise_restores_the_baseline_and_revokes_what_the_thief_added() {
    let w = world();
    let account = w.mint(
        "compromised",
        Passkey::labelled("compromised/owner"),
        std::vec![("device", Passkey::labelled("compromised/device"))],
    );
    let guardians: std::vec::Vec<Account> = (0..3)
        .map(|i| {
            w.guardian(
                &std::format!("compromised/g{i}"),
                Passkey::labelled(&std::format!("compromised/g{i}")),
            )
        })
        .collect();
    let refs: std::vec::Vec<&Account> = guardians.iter().collect();
    let baseline = w.doc(&account, None);
    let mut recovery = w.recovery(Profile::Protected, Mode::Guardian, &refs, 2, None);
    recovery.baseline = Some(w.doc_hash(&baseline));
    w.apply(&account, &w.doc(&account, Some(recovery.clone())), 0)
        .unwrap();
    let e = Enrolled {
        account,
        guardians,
        zk: None,
        recovery: recovery.clone(),
    };

    let thief = Passkey::labelled("compromised/thief");
    let mut stolen = w.doc(&e.account, Some(recovery));
    stolen.signers.push(("thief", thief.pubkey()));
    stolen.rules.push(("drain", w.controller.clone()));
    w.apply(&e.account, &stolen, 0)
        .expect("the thief holds the owner key");

    let new_owner = Passkey::labelled("compromised/new-owner");
    let replacements = w.replacements(&new_owner, None);
    assert_eq!(
        w.ctl()
            .try_begin_compromise(&e.account.address, &replacements),
        Err(Ok(RecoveryError::BaselineNotPublished))
    );
    assert_eq!(
        w.ctl()
            .try_publish_baseline(&e.account.address, &stolen.bytes(&w)),
        Err(Ok(RecoveryError::BaselineMismatch))
    );
    w.ctl()
        .publish_baseline(&e.account.address, &baseline.bytes(&w));

    let id = w.ctl().begin_compromise(&e.account.address, &replacements);
    let source = w.ctl().baseline(&e.account.address).unwrap();
    let target = w.target_bytes(
        &e.account,
        RecoveryAction::Compromise,
        &source,
        &replacements,
    );
    quorum(&w, &e, id, Initiate);
    w.advance(DELAY);
    w.complete(&e.account, &target)
        .expect("compromise completion");

    assert_eq!(w.rule_id(&e.account.address, "drain"), u32::MAX);
    let mut restored = e.account.clone();
    restored.keys[0].1 = new_owner;
    assert!(w.activity(&restored, "owner"));
    let mut back = w.doc(&restored, Some(e.recovery.clone()));
    back.signers.push(("thief", thief.pubkey()));
    assert_eq!(
        err(w.apply(&restored, &back, 0)),
        PerchAccountError::RevokedCredential,
        "the thief's passkey never returns"
    );
}
