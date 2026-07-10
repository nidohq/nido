//! Smoke test proving the vendored `UltraHonk` verifier still verifies real
//! proofs after being retargeted onto soroban-sdk 26.0.1.
//!
//! Fixtures (`vk`, `proof`, `public_inputs`) are the compiled `simple_circuit`
//! artifacts from upstream `rs-soroban-ultrahonk`'s
//! `tests/simple_circuit/target/`, copied verbatim into
//! `contracts/zk-verifier/tests/fixtures/` so this test is self-contained
//! within nido (no dependency on the sibling `zk` repo at test time).

use soroban_sdk::{Bytes, Env};

mod zk_verifier_contract {
    // Path is relative to CARGO_MANIFEST_DIR (this crate's directory); the
    // wasm lands in the shared workspace-root target/ dir.
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/contract/nido_zk_verifier.wasm"
    );
}

fn register_client<'a>(env: &'a Env, vk_bytes: &Bytes) -> zk_verifier_contract::Client<'a> {
    let contract_id = env.register(zk_verifier_contract::WASM, (vk_bytes.clone(),));
    zk_verifier_contract::Client::new(env, &contract_id)
}

#[test]
fn verify_simple_circuit_proof_succeeds() {
    let vk_bytes_raw: &[u8] = include_bytes!("fixtures/vk");
    let proof_bin: &[u8] = include_bytes!("fixtures/proof");
    let pub_inputs_bin: &[u8] = include_bytes!("fixtures/public_inputs");

    let env = Env::default();
    // Proves the vendored math still verifies under sdk 26.0.1, not budget.
    env.cost_estimate().budget().reset_unlimited();

    let vk_bytes = Bytes::from_slice(&env, vk_bytes_raw);
    let proof_bytes: Bytes = Bytes::from_slice(&env, proof_bin);
    let public_inputs: Bytes = Bytes::from_slice(&env, pub_inputs_bin);

    let client = register_client(&env, &vk_bytes);
    client.verify_proof(&public_inputs, &proof_bytes);
}

#[test]
// Error #3 is `Error::VerificationFailed` in `contracts/zk-verifier/src/lib.rs`.
#[should_panic(expected = "Error(Contract, #3)")]
fn verify_with_tampered_public_inputs_fails() {
    let vk_bytes_raw: &[u8] = include_bytes!("fixtures/vk");
    let proof_bin: &[u8] = include_bytes!("fixtures/proof");
    let mut pub_inputs_vec = include_bytes!("fixtures/public_inputs").to_vec();
    pub_inputs_vec[0] ^= 0xff; // Tamper with first byte

    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    let vk_bytes = Bytes::from_slice(&env, vk_bytes_raw);
    let proof_bytes: Bytes = Bytes::from_slice(&env, proof_bin);
    let public_inputs: Bytes = Bytes::from_slice(&env, &pub_inputs_vec);

    let client = register_client(&env, &vk_bytes);
    client.verify_proof(&public_inputs, &proof_bytes);
}
