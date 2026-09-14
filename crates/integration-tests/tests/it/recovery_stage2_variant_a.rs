//! Recovery Stage 2 bounded experiment, VARIANT A: the recovery controller's
//! approval authorizes the EXISTING `apply_doc` operation — no smart-account
//! code changes at all (see `contracts/smart-account/src/contract.rs`'s
//! `complete_recovery` doc comment for why none are needed). Compared
//! against Variant B (`recovery_stage2_variant_b.rs`, a dedicated
//! `complete_recovery` entry point) in `docs/recovery/stage2-findings.md`.
//!
//! Setup lives in `recovery_stage2_common.rs`, shared with Variant B.

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

/// Happy path: a real recovery attempt targeting a fresh admin document
/// completes via `apply_doc`, driven through the REAL host authorization
/// dispatch (zero-signer entry selecting the recovery rule, no
/// `mock_all_auths` on the completing call) — exactly the account's real
/// `apply_doc` pipeline, not a raw rule install. The exact target document
/// becomes effective and `applied_doc_hash` is accurate.
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
        "apply_doc",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert!(
        res.is_ok(),
        "the recovery-authorized apply_doc must succeed: {res:?}"
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
/// ledger, immediately after the first succeeded) must fail — the attempt is
/// gone, so `enforce` finds `NoPending` and the account's own `require_auth`
/// for this second call fails outright.
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
        "apply_doc",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(std::slice::from_ref(&entry));
    assert!(setup.account.try_apply_doc(&doc_bytes).is_ok());

    // Same ledger, identical entry: the pending is gone, so this must fail.
    env.set_auths(&[entry]);
    assert!(
        setup.account.try_apply_doc(&doc_bytes).is_err(),
        "a second completion in the same ledger must be refused"
    );
}

/// After the attempt expires without completing, a completion attempt is
/// refused (`enforce`'s `RecoveryExpired` check fails the account's
/// `require_auth`, so the top-level call errors).
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
        "apply_doc",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert!(
        setup.account.try_apply_doc(&doc_bytes).is_err(),
        "completion after expiry must be refused"
    );
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
        "apply_doc",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert!(setup.account.try_apply_doc(&doc_bytes).is_err());
}

/// Atomicity: the attempt's committed target is a document that compiles
/// fine but fails the anti-brick check (`DocAdminLockout`) inside the
/// install pipeline. The completion call must fail AND leave the attempt
/// live/unspent — a failed install must not consume the recovery.
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
        "apply_doc",
        &doc_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert_doc_error(
        setup.account.try_apply_doc(&doc_bytes),
        NidoSmartAccountError::DocAdminLockout,
    );

    assert!(
        setup.controller.has_pending(&setup.account_addr),
        "a failed install must leave the attempt live, not consumed"
    );
    assert_eq!(
        setup.account.applied_doc_hash(),
        None,
        "the account must be unchanged after a failed install"
    );
}

/// A completing call whose document does NOT match the attempt's committed
/// `target_doc_hash` is refused, even though it is otherwise shaped exactly
/// like a legitimate completion (same recovery rule, same `fn_name`, ready
/// timing) — proving the binding is to the SPECIFIC document, not merely
/// "some document, some completion window".
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

    // A DIFFERENT, otherwise well-formed document (different key) than the
    // one committed at `initiate` time.
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
        "apply_doc",
        &wrong_bytes,
        setup.recovery_rule_id,
    );
    env.set_auths(&[entry]);
    assert!(
        setup.account.try_apply_doc(&wrong_bytes).is_err(),
        "a document not matching the committed target_doc_hash must be refused"
    );
    assert!(setup.controller.has_pending(&setup.account_addr));
}

/// Ordinary admin (or literally anyone — `mock_all_auths` is the most
/// general possible "some Soroban authorization succeeded" case) cannot use
/// the recovery-only authority: even once the attempt is READY, an
/// ordinary-authorized `apply_doc` call for the EXACT target document is
/// still blocked by `guard_no_pending`, because the pending is consumed only
/// as a side effect of the recovery rule's OWN `enforce` — an unrelated
/// authorization path never touches it. This also demonstrates Variant A's
/// call-ordering property directly: `apply_doc`'s guard does not care WHICH
/// rule authorized the call, only whether the attempt has actually been
/// consumed yet.
#[test]
fn ordinary_authorization_cannot_complete_even_the_exact_document() {
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

    // Ordinary/generic authorization (mock_all_auths bypasses __check_auth
    // entirely, so no rule -- including the recovery rule -- actually
    // authorizes this call).
    let res = setup.account.try_apply_doc(&doc_bytes);
    assert_doc_error(res, NidoSmartAccountError::RecoveryPendingBlocked);
    assert!(setup.controller.has_pending(&setup.account_addr));
}
