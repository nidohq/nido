//! SPIKE e2e for the hybrid `apply_doc` (contracts/smart-account/src/doc.rs):
//! the account under test is deployed from the REAL smart-account wasm, and
//! perch's REAL doc-compiler + interpreter contract types are registered at
//! the exact content addresses the account derives on this network —
//! mirroring perch's own `perch-testkit` native mode.
//!
//! Covered here (the contract half of the spike's definition of done):
//! build doc → `apply_doc` → rules installed / hash stored / event emitted →
//! recover the doc from the event → canonical-hash parity passes. Plus the
//! hybrid-specific properties: re-apply diffs out ONLY doc-managed rules
//! (default + legacy rules untouched), capped docs are refused, and the
//! compiler's network binding is enforced. The SDK-side drift tier (b) is
//! covered by `packages/passkey-sdk`'s `readPolicy` tests.

use nido_integration_tests::{deploy_smart_account, test_key};
use nido_smart_account::contract::NidoSmartAccountError;
use nido_smart_account::doc::{compiler_address, interpreter_address, DocApplied};
use sha2::{Digest, Sha256};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::{vec, Address, Bytes, BytesN, Env, Event, String as SString};
use stellar_accounts::smart_account::{ContextRuleType, Signer};

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
/// this must run AFTER [`bind_testnet`]). Returns `(compiler, interpreter)`.
fn register_perch_infra(env: &Env) -> (Address, Address) {
    let compiler = compiler_address(env);
    env.register_at(&compiler, perch_doc_compiler::PerchDocCompiler, ());
    let interpreter = interpreter_address(env);
    env.register_at(&interpreter, perch_interpreter::PerchInterpreter, ());
    (compiler, interpreter)
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

/// A two-rule fixture doc: one interpreter-constrained rule (`functions`)
/// and one policy-free rule, both scoped to `target`, signed by `key_hex`
/// via `verifier`.
fn two_rule_doc(network: &str, verifier: &str, key_hex: &str, target: &str) -> String {
    format!(
        r#"{{
  "version": 1,
  "network": "{network}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
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

/// The canonical `doc_hash` perch defines: sha256 of the doc's canonical
/// JSON. Computed off-chain with `perch-ir` — the exact library the deployed
/// compiler runs — so the assertion is byte-for-byte the SDK's tier-a check.
fn canonical_doc_hash(env: &Env, doc_json: &str) -> BytesN<32> {
    let doc = perch_ir::from_json(doc_json).expect("fixture doc parses");
    let canonical = perch_ir::canonical_json(&doc);
    let digest: [u8; 32] = Sha256::digest(canonical.as_bytes()).into();
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

/// Happy path, end to end: build doc → `apply_doc` → rules installed, hash
/// stored, event emitted with the FULL doc JSON → recover the doc from the
/// event → canonical-hash parity passes.
#[test]
fn apply_doc_installs_rules_stores_hash_and_emits_recoverable_doc() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    let (_compiler, interpreter) = register_perch_infra(&env);
    let (client, account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let target = addr_str(&Address::generate(&env));
    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let doc = two_rule_doc(
        TESTNET_PASSPHRASE,
        &addr_str(&verifier_addr),
        &key_hex,
        &target,
    );
    let doc_bytes = Bytes::from_slice(&env, doc.as_bytes());

    let hash = client.apply_doc(&doc_bytes);

    // Event capture must happen immediately: `Env::events()` reflects only
    // the most recent top-level invocation. `apply_doc` publishes
    // `DocApplied` LAST (after OZ's own context-rule events), carrying the
    // canonical hash as topic and the FULL submitted doc JSON as data — the
    // equality below proves the document is recoverable from the event
    // stream alone.
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

    // The returned/stored identity is the CANONICAL doc_hash — recompute it
    // from the (recoverable) JSON exactly the way the SDK's tier-a check
    // does: parse, canonicalize, sha256.
    assert_eq!(hash, canonical_doc_hash(&env, &doc));
    assert_eq!(client.applied_doc_hash(), Some(hash));

    // Default rule 0 untouched; the document's two rules landed as 1 and 2.
    assert_eq!(client.get_context_rules_count(), 3);
    assert_eq!(client.doc_rule_ids(), vec![&env, 1u32, 2u32]);
    let default_rule = client.get_context_rule(&0);
    assert!(matches!(
        default_rule.context_type,
        ContextRuleType::Default
    ));

    let pay = client.get_context_rule(&1);
    assert_eq!(pay.name, SString::from_str(&env, "pay"));
    assert_eq!(
        pay.policies.len(),
        1,
        "the constrained rule attaches the interpreter"
    );
    assert_eq!(pay.policies.get_unchecked(0), interpreter);

    let ops = client.get_context_rule(&2);
    assert_eq!(ops.name, SString::from_str(&env, "ops"));
    assert_eq!(
        ops.policies.len(),
        0,
        "the unconstrained rule is policy-free"
    );
}

/// The hybrid diff: a re-apply replaces ONLY the rules the previous
/// `apply_doc` installed. The default passkey rule and a rule installed via
/// the legacy `add_context_rule` mutator survive both applies untouched.
#[test]
fn reapply_replaces_only_doc_rules_and_leaves_legacy_rules() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_perch_infra(&env);
    let (client, account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    // A "legacy" rule via the untouched mutator path, BEFORE any doc: id 1.
    let session_key = test_key(7);
    let legacy_signer = Signer::External(
        verifier_addr.clone(),
        Bytes::from_slice(&env, &session_key.verifying_key().to_sec1_bytes()),
    );
    let legacy = client.add_context_rule(
        &ContextRuleType::CallContract(account_addr.clone()),
        &SString::from_str(&env, "legacy-session"),
        &None,
        &vec![&env, legacy_signer],
        &soroban_sdk::Map::new(&env),
    );

    let verifier = addr_str(&verifier_addr);
    let key_hex = hex_lower(&signing_key.verifying_key().to_sec1_bytes());
    let target = addr_str(&Address::generate(&env));

    let doc1 = two_rule_doc(TESTNET_PASSPHRASE, &verifier, &key_hex, &target);
    let first = client.apply_doc(&Bytes::from_slice(&env, doc1.as_bytes()));
    assert_eq!(client.doc_rule_ids(), vec![&env, 2u32, 3u32]);
    assert_eq!(client.get_context_rules_count(), 4);

    // Second doc: a single policy-free rule — the first doc's grants are
    // revoked wholesale, nothing else moves.
    let doc2 = format!(
        r#"{{
  "version": 1,
  "network": "{TESTNET_PASSPHRASE}",
  "signers": [
    {{ "id": "owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "ops-only",
      "scope": {{ "type": "contract", "address": "{target}" }},
      "principals": {{ "type": "all", "signers": ["owner"] }} }}
  ]
}}"#
    );
    let second = client.apply_doc(&Bytes::from_slice(&env, doc2.as_bytes()));

    assert_ne!(first, second);
    assert_eq!(client.applied_doc_hash(), Some(second));
    assert_eq!(client.doc_rule_ids(), vec![&env, 4u32]);
    assert_eq!(client.get_context_rules_count(), 3);
    // The first doc's rules (2, 3) are gone…
    assert!(client.try_get_context_rule(&2).is_err());
    assert!(client.try_get_context_rule(&3).is_err());
    // …while the default rule and the legacy rule are exactly as before.
    assert!(matches!(
        client.get_context_rule(&0).context_type,
        ContextRuleType::Default
    ));
    assert_eq!(
        client.get_context_rule(&legacy.id).name,
        SString::from_str(&env, "legacy-session")
    );
}

/// A doc carrying a cumulative cap is refused (`DocCapUnsupported`) rather
/// than installed weaker than reviewed — capped docs keep the SDK's
/// per-rule `buildDocInstallTxs` install path. Nothing changes on refusal.
#[test]
fn capped_doc_is_refused_atomically() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_perch_infra(&env);
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

    assert_doc_error(
        client.try_apply_doc(&Bytes::from_slice(&env, doc.as_bytes())),
        NidoSmartAccountError::DocCapUnsupported,
    );
    assert_eq!(client.get_context_rules_count(), 1);
    assert_eq!(client.applied_doc_hash(), None);
}

/// The compiler's network binding holds end to end: a doc naming another
/// chain is refused with `DocWrongNetwork` and nothing changes.
#[test]
fn wrong_network_doc_is_refused() {
    let env = Env::default();
    env.mock_all_auths();
    bind_testnet(&env);
    register_perch_infra(&env);
    let (client, _account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let doc = two_rule_doc(
        "Public Global Stellar Network ; September 2015",
        &addr_str(&verifier_addr),
        &hex_lower(&signing_key.verifying_key().to_sec1_bytes()),
        &addr_str(&Address::generate(&env)),
    );

    assert_doc_error(
        client.try_apply_doc(&Bytes::from_slice(&env, doc.as_bytes())),
        NidoSmartAccountError::DocWrongNetwork,
    );
    assert_eq!(client.get_context_rules_count(), 1);
    assert_eq!(client.applied_doc_hash(), None);
}
