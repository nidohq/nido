#![no_std]

//! Stage 3 constructorless `UltraHonk` verifier (`firstmate/data/perch-zk-recovery-scout-p5/follow-up.md`
//! §5.4): a fully immutable, admin-free artifact whose verification key is
//! baked into the Wasm at COMPILE time via `include_bytes!`, not passed to a
//! constructor.
//!
//! `contracts/zk-verifier` (the pre-existing "M1" verifier) stores its VK in
//! instance storage at deploy time via `__constructor(admin, vk_bytes)` and
//! exposes `Upgradable` for its CODE (the VK itself stays immutable across a
//! code upgrade, but the admin key can still swap the verifying code around
//! that fixed VK). Follow-up.md §5.4 asks for something stronger: "a
//! verifier in Perch's constructorless registry that remains immutable
//! until an explicit upgrade... interpreted as deploying a new immutable
//! artifact and explicitly adopting its identity... rather than rewriting
//! code at an existing pinned address." This contract has NO constructor,
//! NO admin, NO upgrade entry point at all — the VK and the verification
//! code are one immutable unit, identified by this contract's Wasm hash (and
//! therefore, once published, by its `stellar-registry` name/version). A new
//! circuit or a verifier bugfix means deploying a NEW Wasm (a new address /
//! registry version), never mutating this one. An account's recovery
//! `RecoveryConfig.verifier` field is the "explicit adoption" step: pointing
//! at THIS specific immutable address is how an account commits to a
//! specific VK/circuit identity, per §5.4.
//!
//! The VK bytes are read from the staged fixture copy
//! `crates/integration-tests/fixtures/zk_recovery_doc/vk` — the Stage 3
//! `zk_recovery_doc` circuit's own VK (see `circuits/zk_recovery_doc/`),
//! NOT `crates/integration-tests/fixtures/zk/` (that path belongs to the
//! deprecated-for-Stage-3 M1 `circuits/zk_recovery` circuit; `crates/zk-bench`'s
//! real-metering budget gate still reads it there for M1's own tests).
//! Baking in the `zk_recovery_doc` fixture means this contract's VK identity
//! is always the currently-committed `circuits/zk_recovery_doc` circuit's VK.
//! Regenerating fixtures (a circuit change) and NOT rebuilding/redeploying
//! this contract would silently desync the two — there is no runtime check
//! for that here (an immutable, no-admin contract has no way to self-detect
//! staleness); the discipline is entirely "same PR/commit that changes the
//! circuit rebuilds this crate too," same as any other compiled-in constant.

use soroban_sdk::{contract, contracterror, contractimpl, Bytes, Env};
use ultrahonk_soroban_verifier::UltraHonkVerifier;

/// The circuit's verification key, baked in at compile time. No constructor
/// sets this — it is a `const`, identical for every instance of this exact
/// Wasm.
const VK_BYTES: &[u8] =
    include_bytes!("../../../crates/integration-tests/fixtures/zk_recovery_doc/vk");

#[contract]
pub struct RecoveryVerifier;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    VkParseError = 1,
    ProofParseError = 2,
    VerificationFailed = 3,
}

#[contractimpl]
impl RecoveryVerifier {
    /// Verify an `UltraHonk` proof against the compiled-in VK. Mirrors
    /// `nido-zk-verifier::verify_proof`'s structured-error, fail-closed
    /// length precheck (same vendored parser, same trap-avoidance reasoning)
    /// — see that contract's doc comment for why the length check exists
    /// before the vendored `load_proof` runs.
    ///
    /// # Errors
    ///
    /// `VkParseError` if the compiled-in VK bytes fail to parse (a bug in
    /// this build, not a runtime condition — the VK is a fixed constant);
    /// `ProofParseError` if `proof_bytes` is not exactly the length the VK's
    /// circuit size requires; `VerificationFailed` if a well-formed proof
    /// does not verify against `public_inputs`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn verify_proof(env: Env, public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error> {
        let vk_bytes = Bytes::from_slice(&env, VK_BYTES);
        let verifier = UltraHonkVerifier::new(&env, &vk_bytes).map_err(|_| Error::VkParseError)?;

        let log_n =
            usize::try_from(verifier.get_vk().log_circuit_size).map_err(|_| Error::VkParseError)?;
        if log_n == 0 || log_n > ultrahonk_soroban_verifier::types::CONST_PROOF_SIZE_LOG_N {
            return Err(Error::VkParseError);
        }
        let expected_len = ultrahonk_soroban_verifier::utils::expected_proof_fields(log_n) * 32;
        if proof_bytes.len() as usize != expected_len {
            return Err(Error::ProofParseError);
        }

        verifier
            .verify(&proof_bytes, &public_inputs)
            .map_err(|_| Error::VerificationFailed)?;
        Ok(())
    }

    /// Read-only view of the compiled-in VK bytes, so off-chain tooling can
    /// confirm which circuit this deployed instance is pinned to without
    /// trusting metadata.
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn vk(env: Env) -> Bytes {
        Bytes::from_slice(&env, VK_BYTES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn vk_is_baked_in_and_nonempty() {
        let env = Env::default();
        let id = env.register(RecoveryVerifier, ());
        let client = RecoveryVerifierClient::new(&env, &id);
        assert!(!client.vk().is_empty());
    }

    #[test]
    fn malformed_proof_is_rejected_not_trapped() {
        let env = Env::default();
        let id = env.register(RecoveryVerifier, ());
        let client = RecoveryVerifierClient::new(&env, &id);
        let bogus_public_inputs = Bytes::from_array(&env, &[0u8; 96]);
        let bogus_proof = Bytes::from_array(&env, &[0u8; 4]);
        let result = client.try_verify_proof(&bogus_public_inputs, &bogus_proof);
        assert!(
            result.is_err(),
            "a truncated proof must be rejected, not trap"
        );
    }
}
