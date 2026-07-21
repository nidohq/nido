#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Bytes, BytesN, Env, Symbol,
};
use ultrahonk_soroban_verifier::UltraHonkVerifier;

/// Contract
#[contract]
pub struct UltraHonkVerifierContract;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    VkParseError = 1,
    ProofParseError = 2,
    VerificationFailed = 3,
    VkNotSet = 4,
    AdminNotSet = 5,
}

#[contractimpl]
impl UltraHonkVerifierContract {
    fn key_vk() -> Symbol {
        symbol_short!("vk")
    }

    fn key_admin() -> Symbol {
        symbol_short!("admin")
    }

    /// Initialize the on-chain VK once at deploy time, and record the `admin`
    /// authorized to upgrade the verifier's code (see `upgrade`).
    ///
    /// # Errors
    ///
    /// Currently always succeeds; the `Result` return type is reserved for
    /// future validation of `vk_bytes`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(env: Env, admin: Address, vk_bytes: Bytes) -> Result<(), Error> {
        env.storage().instance().set(&Self::key_vk(), &vk_bytes);
        env.storage().instance().set(&Self::key_admin(), &admin);
        Ok(())
    }

    /// The admin authorized to rotate the admin or upgrade the verifier wasm.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin was stored (a pre-admin
    /// instance predating this field).
    #[allow(clippy::needless_pass_by_value)]
    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&Self::key_admin())
            .ok_or(Error::AdminNotSet)
    }

    /// Rotate the admin. Requires the current admin's auth.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin is stored.
    #[allow(clippy::needless_pass_by_value)]
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        Self::admin(env.clone())?.require_auth();
        env.storage().instance().set(&Self::key_admin(), &new_admin);
        Ok(())
    }

    /// Upgrade the verifier's own wasm to `new_wasm_hash` (an already-installed
    /// wasm hash). Requires admin auth.
    ///
    /// This replaces the verifier CODE only; the stored VK is untouched and
    /// stays immutable, so existing proofs keep verifying. A CIRCUIT change
    /// (which produces a new VK) still requires a FRESH verifier deploy +
    /// re-registration, not an upgrade -- swapping the VK would invalidate
    /// every already-issued proof. `upgrade` is for patching a bug in the
    /// verifier's proof-checking code against the same VK.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin is stored.
    #[allow(clippy::needless_pass_by_value)]
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        Self::admin(env.clone())?.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Verify an `UltraHonk` proof using the stored VK.
    ///
    /// # Errors
    ///
    /// Returns `Error::VkNotSet` if no VK has been stored, `Error::VkParseError`
    /// if the stored VK bytes fail to parse, or `Error::VerificationFailed` if
    /// the proof does not verify against `public_inputs`.
    #[allow(clippy::needless_pass_by_value)]
    pub fn verify_proof(env: Env, public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error> {
        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&Self::key_vk())
            .ok_or(Error::VkNotSet)?;
        // Deserialize verification key bytes
        let verifier = UltraHonkVerifier::new(&env, &vk_bytes).map_err(|_| Error::VkParseError)?;

        // Verify
        verifier
            .verify(&proof_bytes, &public_inputs)
            .map_err(|_| Error::VerificationFailed)?;
        Ok(())
    }
}
