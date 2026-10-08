//! Generates cross-language parity vectors for the SDK's `config_hash`
//! computation (`packages/passkey-sdk/src/perch/doc.ts::configHash`).
//!
//! Nothing currently checks that the SDK's
//! `configHashOfCanonical(canonicalJson(recovery))` path produces the same
//! `config_hash` the real, pinned `perch-doc-compiler` contract returns for
//! the same document (Copilot's finding on nidohq/nido#232,
//! `packages/passkey-sdk/src/perch/doc.ts:147`). This writes one fixture
//! covering all three modes, both profiles, and a baseline, each with the
//! real compiler's own `config_hash`, so a TS test can assert parity
//! against real values instead of nothing.
//!
//! Run with `cargo test -p nido-integration-tests --test it config_hash_vectors`.
//! Regenerate by re-running it; this is a generator, not an assertion.

use nido_integration_tests::world::{world, Mode, Profile};
use nido_integration_tests::zk::ZkCredential;
use serde_json::Value;
use std::io::Write;

#[test]
fn generate_config_hash_vectors() {
    let w = world();
    let mut vectors: std::vec::Vec<Value> = std::vec![];

    let mut push = |label: &str, profile: Profile, mode: Mode, with_baseline: bool| {
        let account = w.mint(
            label,
            nido_integration_tests::world::Passkey::labelled(&format!("{label}/owner")),
            std::vec![],
        );
        let guardians: std::vec::Vec<nido_integration_tests::world::Account> = if mode
            == Mode::Zk
        {
            std::vec![]
        } else {
            (0..3u64)
                .map(|i| {
                    w.guardian(
                        &format!("{label}/guardian-{i}"),
                        nido_integration_tests::world::Passkey::labelled(&format!(
                            "{label}/guardian-{i}"
                        )),
                    )
                })
                .collect()
        };
        let refs: std::vec::Vec<&nido_integration_tests::world::Account> =
            guardians.iter().collect();
        let zk = (mode != Mode::Guardian).then(|| ZkCredential::new(label));
        let mut recovery = w.recovery(
            profile,
            mode,
            &refs,
            2,
            zk.as_ref().map(|c| c.enrollment(&w.env)),
        );
        if with_baseline {
            recovery.baseline = Some(soroban_sdk::BytesN::from_array(&w.env, &[0x42; 32]));
        }

        let doc = w.doc(&account, Some(recovery));
        let full_json = doc.json(&w);
        let config_hash = w.config_hash(&doc);

        let parsed: Value = serde_json::from_str(&full_json).expect("doc json parses");
        let recovery_member = parsed
            .get("recovery")
            .cloned()
            .expect("doc has a recovery member");

        vectors.push(serde_json::json!({
            "label": label,
            "recovery": recovery_member,
            "config_hash": hex::encode(config_hash.to_array()),
        }));
    };

    push("vec-loss-guardian", Profile::Loss, Mode::Guardian, false);
    push("vec-loss-zk", Profile::Loss, Mode::Zk, false);
    push(
        "vec-protected-combined-baseline",
        Profile::Protected,
        Mode::Combined,
        true,
    );
    push(
        "vec-protected-guardian",
        Profile::Protected,
        Mode::Guardian,
        false,
    );

    let out = serde_json::to_string_pretty(&vectors).unwrap();
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packages/passkey-sdk/src/perch/testdata/config-hash-vectors.local.json"
    );
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap())
        .expect("create fixture dir");
    let mut f = std::fs::File::create(path).expect("create fixture file");
    f.write_all(out.as_bytes()).unwrap();
    println!("wrote {path}");
}
