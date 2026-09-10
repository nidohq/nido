//! SPIKE e2e for DOC-ONLY `apply_doc` (contracts/smart-account/src/doc.rs):
//! the account under test is deployed from the REAL smart-account wasm, and
//! perch's REAL doc-compiler + interpreter contract types are registered at
//! the exact content addresses the account derives on this network —
//! mirroring perch's own `perch-testkit` native mode. Nido's stock
//! spending-limit policy is registered at its PINNED deployed address for
//! the capped-doc case.
//!
//! Covered here: build doc → `apply_doc` → the WHOLE rule set (default rule
//! included) is replaced by the document's rules / hash stored / doc JSON
//! stored on-chain / event emitted → round-trip the doc through the
//! `get_applied_doc` view and the event → canonical-hash parity passes.
//! Plus: re-apply replaces the previous doc's rules wholesale, capped docs
//! install the interpreter AND the pinned spending-limit policy, the
//! anti-brick check refuses admin-less docs, and non-canonical and
//! wrong-network submissions are refused. The doc-only SURFACE (legacy
//! mutators absent, `add_context_rule` gated to the completion window) is
//! covered by the smart-account crate's unit tests.

use nido_integration_tests::{deploy_smart_account, SPENDING_LIMIT_POLICY_WASM};
use nido_smart_account::contract::NidoSmartAccountError;
use nido_smart_account::doc::{
    compiler_address, interpreter_address, DocApplied, NIDO_SPENDING_LIMIT_POLICY,
};
use sha2::{Digest, Sha256};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{vec, Address, Bytes, BytesN, Env, Event, String as SString};

const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

/// Bind the unit env's chain to the testnet passphrase the fixture docs
/// declare — the compiler's network binding hashes the doc's `network`
/// string and compares it to `env.ledger().network_id()`.
fn bind_testnet(env: &Env) {
    let id: [u8; 32] = Sha256::digest(TESTNET_PASSPHRASE.as_bytes()).into();
    env.ledger().with_mut(|l| l.network_id = id);
}

/// Register the real perch compiler + interpreter contract types at the
/// content addresses the account's `doc.rs` derives (network-dependent, so
/// this must run AFTER [`bind_testnet`]), plus nido's stock spending-limit
/// policy at its pinned deployed address (capped rules attach it). Returns
/// `(compiler, interpreter, spending_limit)`.
fn register_infra(env: &Env) -> (Address, Address, Address) {
    let compiler = compiler_address(env);
    env.register_at(&compiler, perch_doc_compiler::PerchDocCompiler, ());
    let interpreter = interpreter_address(env);
    env.register_at(&interpreter, perch_interpreter::PerchInterpreter, ());
    let spending_limit = Address::from_str(env, NIDO_SPENDING_LIMIT_POLICY);
    env.register_at(
        &spending_limit,
        SPENDING_LIMIT_POLICY_WASM,
        (Address::generate(env),),
    );
    (compiler, interpreter, spending_limit)
}

/// Soroban `Address` → `std::string::String` (strkey), for splicing real
/// deployed addresses into fixture doc JSON.
fn addr_str(addr: &Address) -> String {
    let s = addr.to_string();
    // `soroban_sdk::vec!` is imported above, so name std's macro explicitly.
    let mut buf = std::vec![0u8; s.len() as usize];
    s.copy_into_slice(&mut buf);
    String::from_utf8(buf).expect("strkey is ascii")
}

fn hex_lower(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// The doc-only fixture: the anti-brick self-admin rule (policy-free, the
/// owner's path once the default rule is replaced), one
/// interpreter-constrained rule (`functions`), and one policy-free
/// contract-scoped rule.
fn fixture_doc(network: &str, verifier: &str, key_hex: &str, target: &str) -> String {
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
      "functions": ["transfer"] }},
    {{ "name": "ops",
      "scope": {{ "type": "contract", "address": "{target}" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }}
  ]
}}"#
    )
}

/// The canonical byte form of a fixture doc — what `apply_doc` requires
/// (non-canonical submissions are refused) and what `buildApplyDocTx`
/// always sends. Via `perch-ir`, the exact library the deployed compiler
/// runs.
fn canonicalize(doc_json: &str) -> String {
    perch_ir::canonical_json(&perch_ir::from_json(doc_json).expect("fixture doc parses"))
}

/// The canonical `doc_hash` perch defines: sha256 of the doc's canonical
/// JSON.
fn canonical_doc_hash(env: &Env, doc_json: &str) -> BytesN<32> {
    let digest: [u8; 32] = Sha256::digest(canonicalize(doc_json).as_bytes()).into();
    BytesN::from_array(env, &digest)
}

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

/// Happy path, end to end: build doc → `apply_doc` → the DEFAULT rule is
/// replaced by the document's rules, hash + doc JSON stored, event emitted
/// → recover the doc from the view and the event → canonical-hash parity.
#[test]
fn apply_doc_replaces_rule_set_stores_doc_and_emits_recoverable_doc() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    let (_compiler, interpreter, _spending_limit) = register_infra(&env);
    let (client, account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let target = addr_str(&Address::generate(&env));
    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let doc = fixture_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &target,
    );
    let canonical = canonicalize(&doc);
    let doc_bytes = Bytes::from_slice(&env, canonical.as_bytes());

    let hash = client.apply_doc(&doc_bytes);

    // Event capture must happen immediately: `Env::events()` reflects only
    // the most recent top-level invocation. `apply_doc` publishes
    // `DocApplied` LAST, carrying the canonical hash as topic and the FULL
    // doc JSON as data.
    let account_events = env.events().all().filter_by_contract(&account_addr);
    let expected_event = DocApplied {
        doc_hash: hash.clone(),
        doc_json: doc_bytes.clone(),
    };
    assert_eq!(
        account_events
            .events()
            .last()
            .expect("account emitted events"),
        &expected_event.to_xdr(&env, &account_addr),
        "DocApplied must carry the doc_hash topic and the full doc JSON"
    );

    // Canonical identity + on-chain lossless copy round-trip.
    assert_eq!(hash, canonical_doc_hash(&env, &doc));
    assert_eq!(client.applied_doc_hash(), Some(hash.clone()));
    let stored = client.get_applied_doc().expect("doc JSON stored on-chain");
    assert_eq!(stored, doc_bytes);
    let mut stored_buf = std::vec![0u8; stored.len() as usize];
    stored.copy_into_slice(&mut stored_buf);
    let stored_digest: [u8; 32] = Sha256::digest(&stored_buf).into();
    assert_eq!(hash, BytesN::from_array(&env, &stored_digest));

    // DOC-ONLY: the constructor's default rule 0 is REPLACED by the
    // document's three rules — the doc is now the whole policy.
    assert_eq!(client.get_context_rules_count(), 3);
    assert!(client.try_get_context_rule(&0).is_err());
    assert_eq!(client.doc_rule_ids(), vec![&env, 1u32, 2u32, 3u32]);

    let admin = client.get_context_rule(&1);
    assert_eq!(admin.name, SString::from_str(&env, "admin"));
    assert_eq!(
        admin.policies.len(),
        0,
        "anti-brick admin path is policy-free"
    );

    let pay = client.get_context_rule(&2);
    assert_eq!(pay.name, SString::from_str(&env, "pay"));
    assert_eq!(pay.policies.len(), 1);
    assert_eq!(pay.policies.get_unchecked(0), interpreter);

    let ops = client.get_context_rule(&3);
    assert_eq!(ops.name, SString::from_str(&env, "ops"));
    assert_eq!(ops.policies.len(), 0);
}

/// Re-apply replaces the whole rule set again: the first doc's rules are
/// revoked wholesale and the on-chain doc copy tracks the LATEST apply.
/// (The small doc is applied FIRST: soroban-env-host 27.0.1's debug-mode
/// invocation metering underflows when a later invocation SHRINKS storage
/// — a test-env-only host quirk, not contract behavior.)
#[test]
fn reapply_replaces_the_whole_rule_set() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);
    let (client, _account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let verifier = addr_str(&verifier_addr);
    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let target = addr_str(&Address::generate(&env));

    // First doc: admin only.
    let doc1 = format!(
        r#"{{
  "version": 1,
  "network": "{TESTNET_PASSPHRASE}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "admin",
      "scope": {{ "type": "self-admin" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }}
  ]
}}"#
    );
    let first = client.apply_doc(&Bytes::from_slice(&env, canonicalize(&doc1).as_bytes()));
    assert_eq!(client.doc_rule_ids(), vec![&env, 1u32]);
    assert_eq!(client.get_context_rules_count(), 1);

    // Second doc: the full three-rule fixture — the admin-only rule set is
    // replaced wholesale.
    let doc2 = fixture_doc(TESTNET_PASSPHRASE, &verifier, &key_hex, &target);
    let canonical2 = canonicalize(&doc2);
    let second = client.apply_doc(&Bytes::from_slice(&env, canonical2.as_bytes()));

    assert_ne!(first, second);
    assert_eq!(client.applied_doc_hash(), Some(second));
    assert_eq!(
        client.get_applied_doc(),
        Some(Bytes::from_slice(&env, canonical2.as_bytes()))
    );
    assert_eq!(client.doc_rule_ids(), vec![&env, 2u32, 3u32, 4u32]);
    assert_eq!(client.get_context_rules_count(), 3);
    // The first doc's rule (1) no longer exists.
    assert!(client.try_get_context_rule(&1).is_err());
    assert_eq!(
        client.get_context_rule(&2).name,
        SString::from_str(&env, "admin")
    );
}

/// DOC-ONLY supports caps: a capped rule installs the interpreter AND
/// nido's stock spending-limit policy (at its pinned deployed address) on
/// the same context rule — OZ enforces both (AND).
#[test]
fn capped_doc_installs_spending_limit_beside_interpreter() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    let (_compiler, interpreter, spending_limit) = register_infra(&env);
    let (client, _account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let target = addr_str(&Address::generate(&env));
    let doc = format!(
        r#"{{
  "version": 1,
  "network": "{TESTNET_PASSPHRASE}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "admin",
      "scope": {{ "type": "self-admin" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }},
    {{ "name": "capped-pay",
      "scope": {{ "type": "contract", "address": "{target}" }},
      "principals": {{ "type": "all", "signers": ["owner"] }},
      "functions": ["transfer"],
      "cap": {{ "limit": "1000000", "period-ledgers": 17280 }} }}
  ]
}}"#,
        verifier = addr_str(&verifier_addr),
        key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes()),
    );

    client.apply_doc(&Bytes::from_slice(&env, canonicalize(&doc).as_bytes()));

    let capped = client.get_context_rule(&2);
    assert_eq!(capped.name, SString::from_str(&env, "capped-pay"));
    assert_eq!(
        capped.policies.len(),
        2,
        "a capped rule attaches the interpreter AND the spending-limit policy"
    );
    assert!(capped.policies.iter().any(|p| p == interpreter));
    assert!(capped.policies.iter().any(|p| p == spending_limit));
}

/// The re-imported anti-brick check: a document with no policy-free
/// self-admin rule is refused (`DocAdminLockout`) — applying it would
/// replace the default rule and lock the owner out. Nothing changes.
#[test]
fn admin_less_doc_is_refused_anti_brick() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);
    let (client, _account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let doc = format!(
        r#"{{
  "version": 1,
  "network": "{TESTNET_PASSPHRASE}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "pay-only",
      "scope": {{ "type": "contract", "address": "{target}" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }}
  ]
}}"#,
        verifier = addr_str(&verifier_addr),
        key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes()),
        target = addr_str(&Address::generate(&env)),
    );

    assert_doc_error(
        client.try_apply_doc(&Bytes::from_slice(&env, canonicalize(&doc).as_bytes())),
        NidoSmartAccountError::DocAdminLockout,
    );
    // Nothing changed: the constructor's default rule is still the policy.
    assert_eq!(client.get_context_rules_count(), 1);
    assert_eq!(client.applied_doc_hash(), None);
    assert_eq!(client.get_applied_doc(), None);
}

/// `apply_doc` stores (and emits) the submitted bytes as the lossless
/// canonical policy, so a pretty-printed (non-canonical) submission is
/// refused with `DocNotCanonical`. Nothing changes on refusal.
#[test]
fn non_canonical_doc_is_refused() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);
    let (client, _account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    // The fixture is pretty-printed — semantically valid, byte-non-canonical.
    let doc = fixture_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &hex_lower(&signing_key.verifying_key().to_sec1_bytes()),
        &addr_str(&Address::generate(&env)),
    );

    assert_doc_error(
        client.try_apply_doc(&Bytes::from_slice(&env, doc.as_bytes())),
        NidoSmartAccountError::DocNotCanonical,
    );
    assert_eq!(client.get_context_rules_count(), 1);
    assert_eq!(client.applied_doc_hash(), None);
    assert_eq!(client.get_applied_doc(), None);
}

/// The compiler's network binding holds end to end: a doc naming another
/// chain is refused with `DocWrongNetwork` and nothing changes.
#[test]
fn wrong_network_doc_is_refused() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_infra(&env);
    let (client, _account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let doc = fixture_doc(
        "Public Global Stellar Network ; September 2015",
        &addr_str(&verifier_addr),
        &hex_lower(&signing_key.verifying_key().to_sec1_bytes()),
        &addr_str(&Address::generate(&env)),
    );

    assert_doc_error(
        client.try_apply_doc(&Bytes::from_slice(&env, canonicalize(&doc).as_bytes())),
        NidoSmartAccountError::DocWrongNetwork,
    );
    assert_eq!(client.get_context_rules_count(), 1);
    assert_eq!(client.applied_doc_hash(), None);
    assert_eq!(client.get_applied_doc(), None);
}
