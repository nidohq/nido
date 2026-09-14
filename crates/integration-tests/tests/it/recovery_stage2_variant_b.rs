//! Recovery Stage 2 bounded experiment, VARIANT B: a dedicated
//! `complete_recovery` entry point (`contracts/smart-account/src/contract.rs`)
//! that calls the SAME internal `crate::doc::apply` pipeline `apply_doc`
//! uses. Compared against Variant A (`recovery_stage2_variant_a.rs`,
//! completion through the existing `apply_doc`) in
//! `docs/recovery/stage2-findings.md`.
//!
//! Setup lives in `recovery_stage2_common.rs`, shared with Variant A.

use crate::recovery_stage2_common::{
    addr_str, admin_doc, admin_lockout_doc, canonical_doc_hash, canonicalize, hex_lower, setup,
    zero_signer_entry, TESTNET_PASSPHRASE,
};
use nido_smart_account::contract::NidoSmartAccountError;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Bytes, Env};

const DELAY_SECS: u64 = 3 * 24 * 3600;
const EXPIRY_SECS: u64 = 7 * 24 * 3600;

fn assert_doc_error<T: core::fmt::Debug, E: core::fmt::Debug>(
    res: Result<Result<T, E>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>>,
    expected: NidoSmartAccountError,
) {
    match res {
        Err(Ok(err)) => assert_eq!(
            err,
            soroban_sdk::Error::from_contract_error(expected as u32),
            "expected {expected:?}"
        ),
        other => panic!("expected contract error {expected:?}, got {other:?}"),
    }
}

/// Happy path: a real recovery attempt completes via the dedicated
/// `complete_recovery` entry point, driven through the REAL host
/// authorization dispatch. The exact target document becomes effective and
/// `applied_doc_hash` is accurate — same outcome as Variant A, different
/// vehicle.
#[test]
fn completion_installs_exact_target_document() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let target_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let canonical = canonicalize(&target_doc);
    let doc_bytes = Bytes::from_slice(&env, canonical.as_bytes());
    let target_hash = canonical_doc_hash(&env, &target_doc);

    env.mock_all_auths();
    let executable_after =
        setup
            .controller
            .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let entry = zero_signer_entry(
        &env,
        &setup.account_addr,
        "complete_recovery",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    let res = setup.account.try_complete_recovery(&doc_bytes);
    assert!(
        res.is_ok(),
        "the recovery-authorized complete_recovery must succeed: {res:?}"
    );
    let hash = res.unwrap().unwrap();

    assert_eq!(hash, target_hash);
    assert_eq!(setup.account.applied_doc_hash(), Some(target_hash));
    assert_eq!(setup.account.get_applied_doc(), Some(doc_bytes));
    assert!(
        !setup.controller.has_pending(&setup.account_addr),
        "a successful completion must consume the attempt"
    );
}

/// Single completion: repeating the exact same completing call again (same
/// ledger) must fail. Unlike Variant A, `complete_recovery` also loses its
/// completion GRANT on the first successful read (single-use, value-bound) —
/// so even independent of the underlying `Pending` record being gone, the
/// second call's body finds no grant either.
#[test]
fn repeat_completion_in_same_ledger_is_refused() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let target_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&target_doc).as_bytes());
    let target_hash = canonical_doc_hash(&env, &target_doc);

    env.mock_all_auths();
    let executable_after =
        setup
            .controller
            .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let entry = zero_signer_entry(
        &env,
        &setup.account_addr,
        "complete_recovery",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(std::slice::from_ref(&entry));
    assert!(setup.account.try_complete_recovery(&doc_bytes).is_ok());

    env.set_auths(&[entry]);
    assert!(
        setup.account.try_complete_recovery(&doc_bytes).is_err(),
        "a second completion in the same ledger must be refused"
    );
}

/// After the attempt expires without completing, completion is refused.
#[test]
fn completion_after_expiry_is_refused() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let target_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&target_doc).as_bytes());
    let target_hash = canonical_doc_hash(&env, &target_doc);

    env.mock_all_auths();
    setup
        .controller
        .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    let pending = setup.controller.get_pending(&setup.account_addr).unwrap();
    env.ledger().with_mut(|l| l.timestamp = pending.expires_at);

    let entry = zero_signer_entry(
        &env,
        &setup.account_addr,
        "complete_recovery",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert!(setup.account.try_complete_recovery(&doc_bytes).is_err());
}

/// Before the timelock elapses, completion is refused.
#[test]
fn completion_before_timelock_is_refused() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let target_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&target_doc).as_bytes());
    let target_hash = canonical_doc_hash(&env, &target_doc);

    env.mock_all_auths();
    let executable_after =
        setup
            .controller
            .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    let now = env.ledger().timestamp();
    assert!(
        now < executable_after,
        "sanity: timelock has not elapsed yet"
    );

    let entry = zero_signer_entry(
        &env,
        &setup.account_addr,
        "complete_recovery",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert!(setup.account.try_complete_recovery(&doc_bytes).is_err());
}

/// Atomicity: the attempt's committed target compiles fine but fails the
/// anti-brick check inside the shared install pipeline. The completion call
/// must fail AND leave the attempt live/unspent.
#[test]
fn failed_install_leaves_the_attempt_unspent() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let bad_doc = admin_lockout_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
        &addr_str(&Address::generate(&env)),
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&bad_doc).as_bytes());
    let target_hash = canonical_doc_hash(&env, &bad_doc);

    env.mock_all_auths();
    let executable_after =
        setup
            .controller
            .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let entry = zero_signer_entry(
        &env,
        &setup.account_addr,
        "complete_recovery",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert_doc_error(
        setup.account.try_complete_recovery(&doc_bytes),
        NidoSmartAccountError::DocAdminLockout,
    );

    assert!(
        setup.controller.has_pending(&setup.account_addr),
        "a failed install must leave the attempt live, not consumed -- proving the \
         completion grant's write and the pipeline's own failure both roll back atomically \
         with the rest of the transaction"
    );
    assert_eq!(setup.account.applied_doc_hash(), None);
}

/// A completing call whose document does NOT match the attempt's committed
/// `target_doc_hash` is refused by `enforce` itself (before `complete_recovery`'s
/// body -- and its completion-grant check -- ever runs), proving the binding
/// happens at the SAME layer as Variant A's.
#[test]
fn wrong_document_is_rejected_by_enforce() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let target_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let target_hash = canonical_doc_hash(&env, &target_doc);

    env.mock_all_auths();
    let executable_after =
        setup
            .controller
            .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    let other_key_hex = hex_lower(
        &nido_integration_tests::test_key(0xBAD)
            .verifying_key()
            .to_sec1_bytes(),
    );
    let wrong_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &other_key_hex,
    );
    let wrong_bytes = Bytes::from_slice(&env, canonicalize(&wrong_doc).as_bytes());

    let entry = zero_signer_entry(
        &env,
        &setup.account_addr,
        "complete_recovery",
        &wrong_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert!(setup.account.try_complete_recovery(&wrong_bytes).is_err());
    assert!(setup.controller.has_pending(&setup.account_addr));
}

/// Ordinary/generic authorization (no live attempt at all) cannot use
/// `complete_recovery`: `mock_all_auths` satisfies the account's
/// `require_auth` without ever invoking `Policy::enforce`, so no completion
/// grant is ever written, and the body's `take_completion_grant` finds
/// nothing.
#[test]
fn ordinary_authorization_with_no_attempt_is_refused() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&doc).as_bytes());

    env.mock_all_auths();
    let res = setup.account.try_complete_recovery(&doc_bytes);
    assert_doc_error(res, NidoSmartAccountError::RecoveryCompletionNotGranted);
}

/// The decisive Variant B test: ordinary admin/generic authorization cannot
/// use the recovery-only authority EVEN WHILE a matching attempt is live and
/// ready. Unlike Variant A's `apply_doc` (whose block is a simple
/// has-pending flag, incidentally correct here too), `complete_recovery` is
/// a DEDICATED entry point with no intrinsic reason to refuse an
/// otherwise-authorized call -- its only defense is the value-bound
/// completion grant, and this proves that defense holds even in the
/// "otherwise everything lines up" case (live, ready, matching document).
#[test]
fn ordinary_authorization_cannot_complete_even_with_a_ready_matching_attempt() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let setup = setup(&env);

    let key_hex = hex_lower(&setup.signing_key.verifying_key().to_sec1_bytes());
    let target_doc = admin_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&setup.verifier_addr),
        &key_hex,
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&target_doc).as_bytes());
    let target_hash = canonical_doc_hash(&env, &target_doc);

    env.mock_all_auths();
    let executable_after =
        setup
            .controller
            .initiate(&setup.account_addr, &target_hash, &DELAY_SECS, &EXPIRY_SECS);
    env.ledger().with_mut(|l| l.timestamp = executable_after);

    // mock_all_auths is still active: this call's own `require_auth` never
    // touches the recovery policy's `enforce` at all.
    let res = setup.account.try_complete_recovery(&doc_bytes);
    assert_doc_error(res, NidoSmartAccountError::RecoveryCompletionNotGranted);

    assert!(
        setup.controller.has_pending(&setup.account_addr),
        "the live attempt must remain untouched by the refused ordinary call"
    );
    assert_eq!(setup.account.applied_doc_hash(), None);
}
