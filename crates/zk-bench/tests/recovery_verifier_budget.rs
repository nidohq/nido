//! Stage 3 (`firstmate/data/perch-zk-recovery-scout-p5/follow-up.md` §8)
//! measurement: real, metered on-chain CPU-instruction cost of
//! `nido-recovery-verifier::verify_proof` against the adapted
//! `circuits/zk_recovery_doc` circuit's real proof artifacts. Same
//! methodology as `budget.rs` (M1's `nido-zk-verifier` gate) — see that
//! file's module doc comment for the full `reset_limits` rationale, not
//! repeated here. This is a MEASUREMENT, reported in
//! `docs/recovery/stage3-measurements.md`, not (yet) a enforced GO/NO-GO
//! gate the way M1's `MAX_VERIFY_CPU` is — Stage 3 is a spike.

use soroban_sdk::{Bytes, Env};

mod v {
    // Path is relative to CARGO_MANIFEST_DIR (crates/zk-bench/). Produced by
    // `just build-contracts`.
    soroban_sdk::contractimport!(
        file = "../../target/wasm32v1-none/contract/nido_recovery_verifier.wasm"
    );
}

const MAINNET_CPU_INSN_LIMIT: u64 = 600_000_000;
const MAINNET_MEM_BYTES_LIMIT: u64 = 41_943_040;

#[test]
fn recovery_verifier_verify_proof_cost() {
    let env = Env::default();
    env.cost_estimate()
        .budget()
        .reset_limits(MAINNET_CPU_INSN_LIMIT, MAINNET_MEM_BYTES_LIMIT);

    let proof = Bytes::from_slice(
        &env,
        include_bytes!("../../integration-tests/fixtures/zk_recovery_doc/proof"),
    );
    let pubs = Bytes::from_slice(
        &env,
        include_bytes!("../../integration-tests/fixtures/zk_recovery_doc/public_inputs"),
    );

    // Constructorless -- no constructor args at all, unlike M1's verifier.
    let id = env.register(v::WASM, ());
    let client = v::Client::new(&env, &id);

    client.verify_proof(&pubs, &proof);

    let cpu = env.cost_estimate().resources().instructions;
    println!("recovery_verifier::verify_proof cpu_instructions = {cpu}");
}
