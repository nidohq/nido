//! Post-quantum (FIPS 204 ML-DSA-65) signature verifier implementing the
//! `OpenZeppelin` `Verifier` trait, so a smart account can hold an ML-DSA
//! signer exactly like a passkey signer: `Signer::External(this_contract,
//! key_data)`.
//!
//! Verification runs entirely in guest wasm via the pure-Rust, no-alloc
//! `fips204` crate: ~95M metered instructions (~24% of the 400M tx cap),
//! ~1.25 MB memory, ~15 KB wasm. When CAP-0087's `verify_sig_ml_dsa_65`
//! host function ships (Protocol 29+), a host-backed verifier with the SAME
//! `KeyData`/`SigData` format can replace this one; accounts migrate by
//! rotating their signer entry to the new verifier address — no signature
//! or key format change.

use fips204::ml_dsa_65;
use fips204::traits::{SerDes, Verifier as MlDsaVerify};
use soroban_sdk::{contract, contractimpl, contracttype, xdr::FromXdr, Bytes, Env, Vec};
use stellar_accounts::verifiers::Verifier;

/// ML-DSA-65 encoded verifying (public) key length in bytes.
pub const PK_LEN: usize = ml_dsa_65::PK_LEN; // 1952
/// ML-DSA-65 signature length in bytes.
pub const SIG_LEN: usize = ml_dsa_65::SIG_LEN; // 3309

/// FIPS 204 domain-separation context bound into every signature. Prevents a
/// signature produced for this verifier from being replayed against any other
/// protocol using the same ML-DSA key. Signers MUST pass the same context.
pub const SIG_CONTEXT: &[u8] = b"nido-mldsa-v1";

/// Signature-side payload, XDR-encoded into the `Bytes` the smart account
/// passes as `sig_data`.
///
/// The full public key rides here rather than in `key_data` because
/// `OpenZeppelin`'s smart account caps external signer key data at 256 bytes
/// (`MAX_EXTERNAL_KEY_SIZE`) — an ML-DSA-65 key is 1952 bytes. `key_data`
/// instead holds a 32-byte SHA-256 commitment to the key, which `verify`
/// recomputes and checks before verifying the signature.
#[contracttype]
pub struct MlDsaSigData {
    /// 1952-byte ML-DSA-65 encoded verifying key.
    pub public_key: Bytes,
    /// 3309-byte ML-DSA-65 signature over the 32-byte signature payload,
    /// with context [`SIG_CONTEXT`].
    pub signature: Bytes,
}

#[contract]
pub struct MlDsaVerifier;

#[contractimpl]
impl Verifier for MlDsaVerifier {
    /// 32-byte SHA-256 commitment to the ML-DSA-65 public key.
    type KeyData = Bytes;
    /// XDR-encoded [`MlDsaSigData`].
    type SigData = Bytes;

    /// Verify an ML-DSA-65 signature over `signature_payload`.
    ///
    /// Returns `false` on malformed input: wrong payload / key / signature
    /// lengths, a public key that doesn't match the `key_data` commitment,
    /// or a signature that doesn't verify. Undecodable `sig_data` XDR traps
    /// (the host escalates `deserialize_from_bytes` failures to a VM trap
    /// before `from_xdr` can return an error) — same behavior as the
    /// `WebAuthn` verifier.
    fn verify(
        e: &Env,
        signature_payload: Bytes,
        key_data: Self::KeyData,
        sig_data: Self::SigData,
    ) -> bool {
        // The Soroban auth framework always passes a 32-byte payload hash;
        // fixed-size buffers below rely on it.
        if signature_payload.len() != 32 {
            return false;
        }
        let Ok(sig_struct) = MlDsaSigData::from_xdr(e, &sig_data) else {
            return false;
        };
        if sig_struct.public_key.len() as usize != PK_LEN
            || sig_struct.signature.len() as usize != SIG_LEN
        {
            return false;
        }

        // The signer's registered key_data must commit to the public key
        // presented in sig_data — otherwise any key would satisfy the signer.
        let commitment = e.crypto().sha256(&sig_struct.public_key);
        if key_data != commitment.to_bytes().into() {
            return false;
        }

        let mut payload = [0u8; 32];
        signature_payload.copy_into_slice(&mut payload);
        let mut pk_bytes = [0u8; PK_LEN];
        sig_struct.public_key.copy_into_slice(&mut pk_bytes);
        let mut sig_bytes = [0u8; SIG_LEN];
        sig_struct.signature.copy_into_slice(&mut sig_bytes);

        let Ok(pk) = ml_dsa_65::PublicKey::try_from_bytes(pk_bytes) else {
            return false;
        };
        pk.verify(&payload, &sig_bytes, SIG_CONTEXT)
    }

    /// The 32-byte commitment is already the canonical identity of the key.
    fn canonicalize_key(_e: &Env, key_data: Self::KeyData) -> Bytes {
        key_data
    }

    fn batch_canonicalize_key(_e: &Env, key_data: Vec<Self::KeyData>) -> Vec<Bytes> {
        key_data
    }
}
