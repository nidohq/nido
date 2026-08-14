use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, xdr::FromXdr, Address, Bytes, BytesN, Env,
    Symbol, Vec,
};
use stellar_accounts::verifiers::{
    utils::extract_from_bytes,
    webauthn::{self, WebAuthnSigData},
    Verifier,
};

#[contract]
pub struct WebAuthnVerifier;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// No upgrade `admin` is stored (a pre-upgradability instance predating
    /// this field; the deployed testnet verifier has no admin and is
    /// immutable).
    AdminNotSet = 1,
}

// Governance (issue #26): admin-gated `upgrade()` for this shared, stateless
// verifier. The `verify` hot path (called from every account's
// `__check_auth`) never reads admin storage, so this adds no per-auth cost.
// The verifier holds no VK or other state, so an upgrade replaces code only.
#[contractimpl]
impl WebAuthnVerifier {
    fn key_admin() -> Symbol {
        symbol_short!("admin")
    }

    /// Record the `admin` (mainnet: multisig, ideally behind an upgrade
    /// timelock) authorized to rotate the admin or upgrade this verifier.
    #[allow(clippy::needless_pass_by_value)]
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&Self::key_admin(), &admin);
    }

    /// The admin authorized to rotate the admin or upgrade the verifier wasm.
    ///
    /// # Errors
    ///
    /// Returns `Error::AdminNotSet` if no admin is stored.
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

    /// Upgrade this verifier's wasm to `new_wasm_hash` (an already-installed
    /// wasm hash). Requires admin auth. The verifier is stateless, so only
    /// code is replaced.
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
}

#[contractimpl]
impl Verifier for WebAuthnVerifier {
    type KeyData = Bytes;
    type SigData = Bytes;

    /// Verify a `WebAuthn` signature against a message and public key.
    ///
    /// # Arguments
    ///
    /// * `signature_payload` - The message hash that was signed
    /// * `key_data` - Bytes containing:
    ///   - 65-byte secp256r1 public key (uncompressed format)
    ///   - Variable length credential ID (used on the client side)
    /// * `sig_data` - XDR-encoded `WebAuthnSigData` structure containing:
    ///   - Authenticator data
    ///   - Client data JSON
    ///   - Signature components
    ///
    /// # Returns
    ///
    /// * `true` if the signature is valid
    /// * `false` otherwise
    fn verify(
        e: &Env,
        signature_payload: Bytes,
        key_data: Self::KeyData,
        sig_data: Self::SigData,
    ) -> bool {
        let sig_struct =
            WebAuthnSigData::from_xdr(e, &sig_data).expect("WebAuthnSigData with correct format");

        let pub_key: BytesN<65> =
            extract_from_bytes(e, &key_data, 0..65).expect("65-byte public key to be extracted");

        webauthn::verify(e, &signature_payload, &pub_key, &sig_struct)
    }

    /// Canonical identity for a `WebAuthn` key — the 65-byte SEC1 pubkey,
    /// stripped of any trailing credential-ID metadata that varies per
    /// browser session but doesn't change the underlying key. Required by
    /// OZ v0.7+ for the smart account to detect duplicate signer registrations.
    fn canonicalize_key(e: &Env, key_data: Self::KeyData) -> Bytes {
        webauthn::canonicalize_key(e, &key_data)
    }

    fn batch_canonicalize_key(e: &Env, key_data: Vec<Self::KeyData>) -> Vec<Bytes> {
        webauthn::batch_canonicalize_key(e, &key_data)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    /// Upgradability (issue #26): the constructor stores the `admin`, and
    /// `set_admin` rotates it under the current admin's auth. Signature
    /// verification is covered by the integration `contract_verifier` tests.
    #[test]
    fn admin_is_stored_and_rotatable() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(WebAuthnVerifier, (admin.clone(),));
        let client = WebAuthnVerifierClient::new(&env, &id);

        assert_eq!(client.admin(), admin);

        let new_admin = Address::generate(&env);
        client.set_admin(&new_admin);
        assert_eq!(client.admin(), new_admin);
    }
}
