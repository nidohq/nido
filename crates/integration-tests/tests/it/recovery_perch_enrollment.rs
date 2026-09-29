//! Recovery enrollment through perch's doc schema: a document's `recovery`
//! section, submitted via the ordinary `apply_doc` call, enrolls the
//! account with nido's own `recovery-controller` — no separate `enroll()`
//! call. Proves the wiring-bug class is closed: the compiled doc's
//! `recovery.controller` is the sole source for both the controller
//! `enroll` call and the account's rule installation, in the same atomic
//! transaction, so they can never diverge.

use crate::recovery_stage3_common::{
    addr_str, bind_testnet, canonical_doc_hash, canonicalize, hex_lower, register_infra,
    TESTNET_PASSPHRASE,
};
use nido_integration_tests::deploy_smart_account_with_recovery;
use nido_recovery_controller::types::{AuthMode, Profile};
use nido_recovery_controller::RecoveryController;
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{Address, Bytes, Env};

fn recovery_enrollment_doc(
    network: &str,
    verifier: &str,
    key_hex: &str,
    controller: &str,
    guardian1: &str,
    guardian2: &str,
) -> String {
    format!(
        r#"{{
  "version": 1,
  "network": "{network}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "admin",
      "scope": {{ "type": "self-admin" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }}
  ],
  "recovery": {{
    "profile": "loss",
    "mode": {{ "type": "guardian-only", "guardians": ["{guardian1}", "{guardian2}"], "quorum": 1 }},
    "controller": "{controller}",
    "replaceable": ["owner"],
    "delay-ledgers": 100,
    "expiry-ledgers": 100,
    "max-cancels": 3,
    "pending-activity": "freeze"
  }}
}}"#
    )
}

#[test]
fn apply_doc_with_recovery_section_enrolls_for_the_first_time() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);

    // A fresh controller, NOT pre-enrolled — apply_doc must do that itself.
    let controller_addr = env.register(RecoveryController, ());

    // recovery_controller: None — this account starts genuinely unenrolled.
    let (account, account_addr, verifier_addr, signing_key) =
        deploy_smart_account_with_recovery(&env, None);
    assert!(
        account.recovery_rule_id().is_none(),
        "account must start with no recovery rule installed"
    );

    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let guardian1 = addr_str(&Address::generate(&env));
    let guardian2 = addr_str(&Address::generate(&env));
    let doc = recovery_enrollment_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &addr_str(&controller_addr),
        &guardian1,
        &guardian2,
    );
    let canonical = canonicalize(&doc);
    let doc_bytes = Bytes::from_slice(&env, canonical.as_bytes());

    let hash = account.apply_doc(&doc_bytes);
    assert_eq!(hash, canonical_doc_hash(&env, &doc));

    // The account is now wired to the controller the doc named.
    assert_eq!(account.recovery_controller(), Some(controller_addr.clone()));
    assert!(account.recovery_rule_id().is_some());

    // The controller actually has a config stored — not just wired.
    let controller_client =
        nido_recovery_controller::RecoveryControllerClient::new(&env, &controller_addr);
    let cfg = controller_client
        .config(&account_addr)
        .expect("apply_doc must have called enroll");
    assert!(matches!(cfg.mode, AuthMode::GuardianOnly));
    assert!(matches!(cfg.profile, Profile::Loss));
    assert_eq!(cfg.guardian_threshold, 1);
    assert_eq!(cfg.guardians.len(), 2);

    // The doc's other rule (admin) was installed too, alongside recovery.
    assert_eq!(account.get_context_rules_count(), 2); // admin + recovery rule
}

fn recovery_combined_doc(
    network: &str,
    verifier: &str,
    key_hex: &str,
    controller: &str,
    guardian1: &str,
    guardian2: &str,
    zk_verifier: &str,
    circuit_id_hex: &str,
    zk_pool: &str,
) -> String {
    format!(
        r#"{{
  "version": 1,
  "network": "{network}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "admin",
      "scope": {{ "type": "self-admin" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }}
  ],
  "recovery": {{
    "profile": "loss",
    "mode": {{ "type": "combined", "guardians": ["{guardian1}", "{guardian2}"], "quorum": 1, "verifier": "{zk_verifier}", "circuit-id": "{circuit_id_hex}", "pool": "{zk_pool}" }},
    "controller": "{controller}",
    "replaceable": ["owner"],
    "delay-ledgers": 100,
    "expiry-ledgers": 100,
    "max-cancels": 3,
    "pending-activity": "freeze"
  }}
}}"#
    )
}

#[test]
fn apply_doc_with_additive_recovery_change_reconfigures() {
    // GuardianOnly -> Combined
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);

    let controller_addr = env.register(RecoveryController, ());
    let (account, account_addr, verifier_addr, signing_key) =
        deploy_smart_account_with_recovery(&env, None);

    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let guardian1 = addr_str(&Address::generate(&env));
    let guardian2 = addr_str(&Address::generate(&env));

    // First apply: enroll GuardianOnly (same as the existing enrollment test).
    let doc1 = recovery_enrollment_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &addr_str(&controller_addr),
        &guardian1,
        &guardian2,
    );
    account.apply_doc(&Bytes::from_slice(&env, canonicalize(&doc1).as_bytes()));

    let controller_client =
        nido_recovery_controller::RecoveryControllerClient::new(&env, &controller_addr);
    let cfg: nido_recovery_controller::types::RecoveryConfig =
        controller_client.config(&account_addr).unwrap();
    assert!(matches!(cfg.mode, AuthMode::GuardianOnly));

    // Second apply: additively upgrade to Combined — SAME guardians/quorum,
    // adding a ZK factor. Must call `reconfigure`, not silently no-op.
    let zk_verifier = addr_str(&Address::generate(&env));
    let zk_pool = addr_str(&Address::generate(&env));
    let doc2 = recovery_combined_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &addr_str(&controller_addr),
        &guardian1,
        &guardian2,
        &zk_verifier,
        "00",
        &zk_pool,
    );
    account.apply_doc(&Bytes::from_slice(&env, canonicalize(&doc2).as_bytes()));

    let cfg = controller_client.config(&account_addr).unwrap();
    assert!(
        matches!(cfg.mode, AuthMode::Combined),
        "expected Combined after additive reconfigure, got {:?}",
        cfg.mode
    );
    assert_eq!(
        cfg.guardians.len(),
        2,
        "guardians must be unchanged by an additive reconfigure"
    );
    assert_eq!(cfg.guardian_threshold, 1);
    assert!(cfg.verifier.is_some());
}

#[test]
fn apply_doc_with_unchanged_recovery_section_does_not_reconfigure() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);

    let controller_addr = env.register(RecoveryController, ());
    let (account, account_addr, verifier_addr, signing_key) =
        deploy_smart_account_with_recovery(&env, None);

    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let guardian1 = addr_str(&Address::generate(&env));
    let guardian2 = addr_str(&Address::generate(&env));
    let doc = recovery_enrollment_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &addr_str(&controller_addr),
        &guardian1,
        &guardian2,
    );
    let doc_bytes = Bytes::from_slice(&env, canonicalize(&doc).as_bytes());

    // First apply: enrolls.
    account.apply_doc(&doc_bytes);

    let controller_client =
        nido_recovery_controller::RecoveryControllerClient::new(&env, &controller_addr);
    let cfg_before = controller_client.config(&account_addr).unwrap();

    // Second apply: the EXACT same doc, recovery section unchanged.
    account.apply_doc(&doc_bytes);

    let cfg_after = controller_client.config(&account_addr).unwrap();
    assert_eq!(
        cfg_before, cfg_after,
        "an unchanged recovery section must leave the stored config byte-for-byte identical"
    );

    // Env::events() reflects only the most recent top-level invocation, so
    // this is scoped to just the second apply_doc call.
    let controller_events = env.events().all().filter_by_contract(&controller_addr);
    assert!(
        controller_events.events().is_empty(),
        "an unchanged recovery section must not call reconfigure: {:?}",
        controller_events.events()
    );
}

fn recovery_zk_only_doc(
    network: &str,
    verifier: &str,
    key_hex: &str,
    controller: &str,
    zk_verifier: &str,
    circuit_id_hex: &str,
    zk_pool: &str,
    target: &str,
) -> String {
    format!(
        r#"{{
  "version": 1,
  "network": "{network}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "admin",
      "scope": {{ "type": "self-admin" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }},
    {{ "name": "pay",
      "scope": {{ "type": "contract", "address": "{target}" }},
      "principals": {{ "type": "all", "signers": ["owner"] }},
      "functions": ["transfer"] }}
  ],
  "recovery": {{
    "profile": "loss",
    "mode": {{ "type": "zk-only", "verifier": "{zk_verifier}", "circuit-id": "{circuit_id_hex}", "pool": "{zk_pool}" }},
    "controller": "{controller}",
    "replaceable": ["owner"],
    "delay-ledgers": 100,
    "expiry-ledgers": 100,
    "max-cancels": 3,
    "pending-activity": "freeze"
  }}
}}"#
    )
}

#[test]
fn apply_doc_with_non_additive_recovery_change_reverts_the_whole_apply() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);

    let controller_addr = env.register(RecoveryController, ());
    let (account, account_addr, verifier_addr, signing_key) =
        deploy_smart_account_with_recovery(&env, None);

    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let guardian1 = addr_str(&Address::generate(&env));
    let guardian2 = addr_str(&Address::generate(&env));

    let doc1 = recovery_enrollment_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &addr_str(&controller_addr),
        &guardian1,
        &guardian2,
    );
    let doc1_hash = account.apply_doc(&Bytes::from_slice(&env, canonicalize(&doc1).as_bytes()));

    // Non-additive: GuardianOnly -> ZkOnly drops guardians entirely, which
    // reconfigure's catch-all match arm refuses. Bundles an unrelated new
    // "pay" rule in the SAME doc, to prove atomicity.
    let zk_verifier = addr_str(&Address::generate(&env));
    let zk_pool = addr_str(&Address::generate(&env));
    let target = addr_str(&Address::generate(&env));
    let doc2 = recovery_zk_only_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &addr_str(&controller_addr),
        &zk_verifier,
        "00",
        &zk_pool,
        &target,
    );
    let doc2_bytes = Bytes::from_slice(&env, canonicalize(&doc2).as_bytes());

    let res = account.try_apply_doc(&doc2_bytes);
    assert!(
        res.is_err(),
        "a non-additive reconfigure attempt must fail, not silently succeed"
    );

    // Nothing changed: doc hash, rule count, and recovery config all as before.
    assert_eq!(account.applied_doc_hash(), Some(doc1_hash));
    assert_eq!(
        account.get_context_rules_count(),
        2,
        "the bundled 'pay' rule must NOT have been added"
    );
    let controller_client =
        nido_recovery_controller::RecoveryControllerClient::new(&env, &controller_addr);
    let cfg = controller_client.config(&account_addr).unwrap();
    assert!(
        matches!(cfg.mode, AuthMode::GuardianOnly),
        "recovery config must still be GuardianOnly, got {:?}",
        cfg.mode
    );
}
