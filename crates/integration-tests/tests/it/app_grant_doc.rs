//! The document an app grant with a passkey key applies compiles on Perch's
//! doc compiler, deployed from wasm with the `WebAuthn` verifier it
//! canonicalizes keys through.
//!
//! The fixture is what /security/delegate-doc/ builds for a two-grant
//! `pubkey=` request on a first apply (the account's admin rule, `guess`
//! uncapped, and the capped XLM `transfer` payable only to the game: its
//! `to=` lowers to an `address-eq` on transfer's argument 1); the frontend's
//! `appGrantDoc.test.ts` keeps it byte-identical to that output and names
//! this world's verifier. The app's key is the bare 65-byte public key: the
//! compiler refuses a `WebAuthn` key with a credential id appended
//! (`KeyNotCanonicalizable`), which is why the request carries no
//! `credential_id`.

use nido_integration_tests::world::{strkey, world};
use perch_doc_compiler::DocCompilerError;
use serde_json::Value;
use soroban_sdk::Bytes;

const DOC: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/frontend/src/lib/policy/testdata/app-grant-doc.json"
));

#[test]
fn a_passkey_app_grant_compiles() {
    let w = world();
    let doc: Value = serde_json::from_str(DOC).unwrap();
    let verifier = strkey(&w.verifier);
    for signer in doc["signers"].as_array().unwrap() {
        assert_eq!(
            signer["verifier"],
            verifier.as_str(),
            "the fixture names this world's verifier"
        );
    }
    let compiled = w
        .compiler()
        .try_compile_doc(&Bytes::from_slice(&w.env, DOC.trim_end().as_bytes()));
    assert!(compiled.is_ok(), "the app grant must compile: {compiled:?}");
}

#[test]
fn a_credential_id_after_the_app_key_is_refused() {
    let w = world();
    let mut doc: Value = serde_json::from_str(DOC).unwrap();
    for signer in doc["signers"].as_array_mut().unwrap() {
        if signer["id"] == "session" {
            let key = format!("{}abcdef123456", signer["key"].as_str().unwrap());
            signer["key"] = Value::String(key);
        }
    }
    let json = serde_json::to_string(&doc).unwrap();
    assert_eq!(
        w.compiler()
            .try_compile_doc(&Bytes::from_slice(&w.env, json.as_bytes())),
        Err(Ok(DocCompilerError::KeyNotCanonicalizable)),
    );
}
