//! Guardian-only lifecycle: enrollment (no ZK machinery at all — a hard
//! requirement of `AuthMode::GuardianOnly`, enforced at `enroll`),
//! initiation, guardian-quorum evidence collection, delay, completion via
//! the real `apply_doc` pipeline, a second recovery attempt, expiry, and
//! cancellation with its own action domain.

use crate::recovery_stage3_common::{
    addr_str, admin_doc, admin_lockout_doc, canonical_doc_hash, canonicalize, hex_lower,
    setup_guardian_only, zero_signer_apply_doc_entry, TESTNET_PASSPHRASE,
};
use nido_recovery_controller::types::{AttemptState, RecoveryAction};
use p256::ecdsa::SigningKey;
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec as SVec};

fn target_doc_and_hash(env: &Env, verifier_addr: &Address, key_hex: &str) -> (Bytes, BytesN<32>) {
    let doc = admin_doc(TESTNET_PASSPHRASE, &addr_str(verifier_addr), key_hex);
    let bytes = Bytes::from_slice(env, canonicalize(&doc).as_bytes());
    let hash = canonical_doc_hash(env, &doc);
    (bytes, hash)
}

/// Full happy path: 2-of-3 guardian quorum promotes the attempt, the
/// timelock elapses, and the REAL `apply_doc` pipeline installs the exact
/// target document — through the account's real host authorization
/// dispatch (zero-signer entry, no `mock_all_auths` on the completing
/// call), exactly like the completion comparison's Variant A
/// (`recovery_stage2_variant_a.rs`).
#[test]
fn guardian_only_lifecycle_completes_via_apply_doc() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 3, 2, baseline_hash.clone());

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let (doc_bytes, target_hash) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );

    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(
        matches!(attempt.state, AttemptState::CollectingEvidence),
        "1-of-2 is not quorum"
    );

    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(matches!(attempt.state, AttemptState::AuthorizedPending));
    let executable_after = attempt.executable_after.unwrap();

    env.ledger().with_mut(|l| l.timestamp = executable_after);
    let entry = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc_bytes,
        setup.recovery_rule_id,
        0x00C0_FFEE,
    );
    env.set_auths(&[entry]);
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(
        res.is_ok(),
        "recovery-authorized apply_doc must succeed: {res:?}"
    );
    assert_eq!(setup.account.applied_doc_hash(), Some(target_hash));
    assert!(!setup.controller.has_pending(&setup.account_addr));
}

/// A completed attempt cannot authorize a second `apply_doc` in the same
/// ledger (property 5, single completion) — the attempt is marked
/// `Completed`, not merely deleted, so a replay finds `state !=
/// AuthorizedPending` and fails at `enforce`'s very first pending-lookup
/// check.
#[test]
fn repeat_completion_is_refused() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let (doc_bytes, target_hash) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let executable_after = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .executable_after
        .unwrap();
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let entry = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc_bytes,
        setup.recovery_rule_id,
        0x00C0_FFEE,
    );
    env.set_auths(&[entry.clone()]);
    setup.account.apply_doc(&doc_bytes);

    env.set_auths(&[entry]);
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(
        res.is_err(),
        "a second completion of the SAME consumed attempt must fail"
    );
}

/// A SECOND recovery attempt, after a first completes, works end-to-end —
/// attempt ids increment, the controller is not "used up", and the second
/// attempt targets a document that replaces the just-installed credential
/// again (a fresh device, i.e. lost the just-recovered key too).
#[test]
fn second_recovery_attempt_after_completion_succeeds() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    let key_hex_1 = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let (doc1, hash1) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex_1);

    env.mock_all_auths();
    let attempt1 = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &hash1,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt1,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt1,
        &setup.guardians.get(1).unwrap(),
    );
    let executable_after1 = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .executable_after
        .unwrap();
    env.ledger().with_mut(|l| l.timestamp = executable_after1);
    let entry1 = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc1,
        setup.recovery_rule_id,
        0x00C0_FFEE,
    );
    env.set_auths(&[entry1]);
    setup.account.apply_doc(&doc1);
    assert_eq!(setup.account.applied_doc_hash(), Some(hash1.clone()));

    // Second device, second attempt.
    let second_key = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let key_hex_2 = hex_lower(&second_key.verifying_key().to_sec1_bytes());
    let (doc2, hash2) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex_2);

    env.mock_all_auths();
    let attempt2 = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &hash2,
        &hash1,
        &SVec::new(&env),
    );
    assert_eq!(
        attempt2,
        attempt1 + 1,
        "attempt ids increment across completions"
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt2,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt2,
        &setup.guardians.get(1).unwrap(),
    );
    let executable_after2 = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .executable_after
        .unwrap();
    env.ledger().with_mut(|l| l.timestamp = executable_after2);
    let entry2 = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc2,
        setup.recovery_rule_id,
        0x00C0_FFEF,
    );
    env.set_auths(&[entry2]);
    setup.account.apply_doc(&doc2);
    assert_eq!(setup.account.applied_doc_hash(), Some(hash2));
}

/// Expiry: a promoted attempt whose window has fully elapsed can no longer
/// complete, and `has_pending` correctly reports `false` (derived from time,
/// not a stored transition) so a FRESH attempt can begin.
#[test]
fn expired_attempt_cannot_complete_but_allows_a_fresh_one() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let (doc_bytes, target_hash) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let expires_at = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .expires_at
        .unwrap();

    env.ledger().with_mut(|l| l.timestamp = expires_at + 1);
    assert!(!setup.controller.has_pending(&setup.account_addr));

    let entry = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc_bytes,
        setup.recovery_rule_id,
        0x00C0_FFEE,
    );
    env.set_auths(&[entry]);
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(res.is_err(), "an EXPIRED attempt must not complete");

    env.mock_all_auths();
    let fresh = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    assert_eq!(fresh, attempt_id + 1);
}

/// Cancellation uses its OWN action domain: guardians who approved
/// INITIATION have approved nothing about CANCELLATION — see
/// `contracts/recovery-controller/src/lib.rs`'s "Cancellation integrity"
/// property for why cancellation requires its own quorum.
#[test]
fn cancellation_requires_its_own_guardian_quorum() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let (_doc_bytes, target_hash) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );

    setup.controller.submit_guardian_cancel(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(
        matches!(attempt.state, AttemptState::CollectingEvidence),
        "1-of-2 cancel approvals is not cancel quorum"
    );

    setup.controller.submit_guardian_cancel(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let attempt = setup.controller.get_attempt(&setup.account_addr).unwrap();
    assert!(matches!(attempt.state, AttemptState::Cancelled));
}

/// Restoring an INACTIVE account (its admin passkey never used again after
/// initial setup) WITHOUT the old admin key: `enroll` at setup is the only
/// call the account itself ever authorizes; every later step (initiation,
/// guardian evidence, completion) is authorized by guardians/the recovery
/// rule, never by a fresh signature from the account's own original key.
#[test]
fn restores_an_inactive_account_without_its_old_admin_key() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    // From here on, `setup.signing_key` (the account's ORIGINAL admin
    // passkey) is never referenced again -- simulating an inactive/lost-key
    // account. A DIFFERENT fresh key is what gets installed.
    let fresh_key = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let fresh_key_hex = hex_lower(&fresh_key.verifying_key().to_sec1_bytes());
    let (doc_bytes, target_hash) = target_doc_and_hash(&env, &setup.verifier_addr, &fresh_key_hex);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let executable_after = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .executable_after
        .unwrap();
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let entry = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc_bytes,
        setup.recovery_rule_id,
        0x00C0_FFEE,
    );
    env.set_auths(&[entry]);
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(
        res.is_ok(),
        "restoration must succeed without the old admin key ever signing again: {res:?}"
    );
    assert_eq!(setup.account.applied_doc_hash(), Some(target_hash));
}

/// Adversarial (see `docs/recovery/TRANSITION_SPEC.md`'s adversarial
/// validation checklist): a failed compile/install (the target document is
/// syntactically valid but fails the anti-brick self-admin check) must not
/// leave the attempt spent — atomicity.
#[test]
fn failed_install_leaves_the_attempt_unspent() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let bad_doc = admin_lockout_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
        &addr_str(&setup.account_addr),
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&bad_doc).as_bytes());
    let target_hash = canonical_doc_hash(&env, &bad_doc);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let executable_after = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .executable_after
        .unwrap();
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let entry = zero_signer_apply_doc_entry(
        &env,
        &setup.account_addr,
        &doc_bytes,
        setup.recovery_rule_id,
        0x00C0_FFEE,
    );
    env.set_auths(&[entry]);
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(
        res.is_err(),
        "the admin-lockout document must fail the anti-brick pipeline check"
    );

    assert!(
        setup.controller.has_pending(&setup.account_addr),
        "a failed install must leave the attempt LIVE, not consumed"
    );
}

/// Ordinary admin authorization (the account's OWN Default rule, not the
/// recovery rule) cannot complete recovery even with the exact correct
/// document, while an attempt is live — `guard_no_pending` blocks it.
#[test]
fn ordinary_authorization_cannot_complete_even_the_exact_document() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let baseline_hash = BytesN::from_array(&env, &[0x11; 32]);
    let setup = setup_guardian_only(&env, 2, 2, baseline_hash.clone());
    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let (doc_bytes, target_hash) = target_doc_and_hash(&env, &setup.verifier_addr, &key_hex);

    env.mock_all_auths();
    let attempt_id = setup.controller.begin_attempt(
        &setup.account_addr,
        &RecoveryAction::LostKey,
        &target_hash,
        &baseline_hash,
        &SVec::new(&env),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(0).unwrap(),
    );
    setup.controller.submit_guardian_approval(
        &setup.account_addr,
        &attempt_id,
        &setup.guardians.get(1).unwrap(),
    );
    let executable_after = setup
        .controller
        .get_attempt(&setup.account_addr)
        .unwrap()
        .executable_after
        .unwrap();
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    // mock_all_auths is still active, so the account's OWN (Default rule)
    // auth is trivially satisfied here -- exercising `guard_no_pending`,
    // not host auth-selection.
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(
        res.is_err(),
        "ordinary admin-authorized apply_doc must be blocked while an attempt is live"
    );
}
