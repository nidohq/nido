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
use soroban_sdk::testutils::Address as _;
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
