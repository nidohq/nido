//! Pinned ZK-recovery "lifecycle" fixture (M1 Task 1).
//!
//! The recovery circuit's public input `auth_hash` binds the account
//! address, controller address, and network passphrase (see
//! `circuits/zk_recovery/src/main.nr:40-42`). That means a proof is only
//! valid for a test that deploys the account/controller at the EXACT
//! addresses the proof was generated for. This module pins those values so
//! every M1 test that needs a *real* recovery proof can deploy at
//! `ACCOUNT`/`CONTROLLER` via `env.register_at` and reuse the same
//! committed proof.
//!
//! The committed proof + public inputs under
//! `circuits/zk_recovery/fixtures/lifecycle/` were generated for exactly
//! the witness described below by `just gen-zk-lifecycle-fixture` (see
//! `circuits/zk_recovery/scripts/gen_lifecycle_fixture.sh` and the
//! generator test `crates/integration-tests/tests/it/zk_fixture.rs::print_lifecycle_prover_toml`).
//! If any pinned value below ever changes, regenerate the fixture and
//! update the hex constants at the bottom of this file to match
//! `circuits/zk_recovery/fixtures/lifecycle/prover_inputs.json`.

use soroban_sdk::Env;

/// Pinned recovery-account contract-id. `auth_hash` binds this value via
/// `acct_hi`/`acct_lo` (a big-endian 16/16-byte split). Deploy the smart
/// account under test at this address with `env.register_at` for the
/// fixture proof to verify against it.
pub const ACCOUNT: [u8; 32] = [0x11; 32];

/// Pinned recovery-controller contract-id, bound into `auth_hash` via
/// `ctrl_hi`/`ctrl_lo`. Deploy the recovery controller at this address with
/// `env.register_at` for the fixture proof to verify against it.
pub const CONTROLLER: [u8; 32] = [0x22; 32];

/// Network passphrase bound into `auth_hash` via
/// `split16(sha256(NETWORK_PASSPHRASE))`. This is the Stellar testnet
/// passphrase; the fixture is only valid for tests that run under this
/// exact passphrase.
pub const NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";

/// Recovery nonce bound into `auth_hash`.
pub const NONCE: u64 = 1;

/// Recovery timelock, in seconds (14 days), bound into `auth_hash`.
pub const TIMELOCK_SECS: u32 = 1_209_600;

/// `action` bound into `auth_hash` -- `1` means "initiate recovery" per the
/// `zk_recovery` circuit's protocol (`circuits/zk_recovery/src/main.nr`).
pub const ACTION: u64 = 1;

/// Deterministic seed for the fixture's replacement P-256 pubkey, fed to
/// `crate::test_key`. `test_key` SHA-256-derives a signing key from the
/// seed, so this always yields the same 65-byte SEC1-uncompressed
/// (`0x04`-prefixed) on-curve point. Reserved for this fixture only -- do
/// not reuse this seed for any other test key.
pub const NEW_PUBKEY_SEED: u64 = 424_242;

/// Domain-separation label for the fixture's Merkle-leaf secret. The actual
/// secret used in the witness is `sha256(SECRET_LABEL)[0..16]`,
/// zero-extended to a 32-byte big-endian field element (top 16 bytes
/// zero), which is trivially less than the BN254 scalar field's modulus.
/// See `secret_hex` on [`LifecycleFixture`] for the resulting value.
pub const SECRET_LABEL: &[u8] = b"nido-zk-lifecycle-fixture:secret";

/// The pinned lifecycle witness + the real proof generated for it.
///
/// `proof`/`public_inputs` are the exact bytes committed at
/// `circuits/zk_recovery/fixtures/lifecycle/{proof,public_inputs}` -- a
/// real `bb prove` output, not fabricated. `public_inputs` is 96 bytes:
/// `root` (first 32) || `nullifier` (next 32) || `auth_hash` (last 32).
pub struct LifecycleFixture {
    pub account: [u8; 32],
    pub controller: [u8; 32],
    pub network_passphrase: &'static str,
    pub new_pubkey: [u8; 65],
    pub nonce: u64,
    pub timelock_secs: u32,
    /// Hex (`0x`-prefixed, 32-byte) representation of the circuit's private
    /// Merkle-leaf secret. Documentation only -- the secret itself never
    /// appears on-chain; it is baked into the committed `proof`.
    pub secret_hex: &'static str,
    /// The Merkle leaf actually stored at index 0:
    /// `P2_4(DOM_BIND, acct_hi, acct_lo, P2_2(DOM_LEAF, secret))`.
    pub leaf_stored: [u8; 32],
    pub root: [u8; 32],
    pub nullifier: [u8; 32],
    pub auth_hash: [u8; 32],
    pub proof: std::vec::Vec<u8>,
    pub public_inputs: std::vec::Vec<u8>,
}

const PROOF_BYTES: &[u8] = include_bytes!("../../../circuits/zk_recovery/fixtures/lifecycle/proof");
const PUBLIC_INPUTS_BYTES: &[u8] =
    include_bytes!("../../../circuits/zk_recovery/fixtures/lifecycle/public_inputs");

// Computed witness values for the pinned constants above. Regenerate with
// `just gen-zk-lifecycle-fixture` and copy the emitted values from
// `circuits/zk_recovery/fixtures/lifecycle/prover_inputs.json` here if the
// circuit or any pinned value ever changes (mirrors the existing
// hand-copy convention documented in
// `circuits/zk_recovery/Prover.toml` and `circuits/zk_recovery/src/tests.nr`).
const SECRET_HEX: &str = "0x00000000000000000000000000000000d80e5c7596cf3ed7868f8bc89b6cf93c";
const LEAF_STORED_HEX: &str = "0x27cfe62058beb8e80b7c27b5b43225643b3b062f300c3bd28f41ddd20de50880";
const ROOT_HEX: &str = "0x2d7fe2d38d95d1fcff89a94652adc57d0414cee707c72c0f744389025a937f03";
const NULLIFIER_HEX: &str = "0x1b2c4afb313af3435729561fee62d1b065c4b3aad8e8fc6ca5447936a2f8edce";
const AUTH_HASH_HEX: &str = "0x111ae1edc6e6854540153d3098793786fe1f37bd208992a95b9d9038d9c37baf";

fn hex32(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    assert_eq!(s.len(), 64, "expected 32-byte hex string, got {s:?}");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

/// Loads the committed lifecycle fixture: the pinned witness constants
/// plus the real `proof`/`public_inputs` bytes generated for them.
///
/// `env` is accepted (rather than the fixture being a plain `const`)
/// because callers typically need an `Env` immediately afterwards to wrap
/// `proof`/`public_inputs` in `soroban_sdk::Bytes` -- keeping the same
/// `&Env` in scope makes call sites read naturally. The fixture data
/// itself is loaded from constants embedded at compile time, so `env` is
/// not otherwise used.
///
/// # Panics
///
/// Panics if the committed fixture files under
/// `circuits/zk_recovery/fixtures/lifecycle/` have drifted out of sync
/// with the hardcoded hex constants in this module (i.e. `public_inputs`
/// no longer equals `root || nullifier || auth_hash`), or if
/// `crate::test_key` ever stops producing a 65-byte uncompressed P-256 key.
#[allow(unused_variables)]
#[must_use]
pub fn lifecycle_fixture(env: &Env) -> LifecycleFixture {
    let new_pubkey_sec1 = crate::test_key(NEW_PUBKEY_SEED)
        .verifying_key()
        .to_sec1_bytes();
    assert_eq!(
        new_pubkey_sec1.len(),
        65,
        "P-256 SEC1 pubkey must be 65 bytes"
    );
    assert_eq!(
        new_pubkey_sec1[0], 0x04,
        "P-256 SEC1 pubkey must be uncompressed (0x04 prefix)"
    );
    let mut new_pubkey = [0u8; 65];
    new_pubkey.copy_from_slice(&new_pubkey_sec1);

    let root = hex32(ROOT_HEX);
    let nullifier = hex32(NULLIFIER_HEX);
    let auth_hash = hex32(AUTH_HASH_HEX);

    // Defensive parity check: the committed public_inputs file must equal
    // root || nullifier || auth_hash. If this ever fails, the committed
    // fixture files and the hardcoded hex constants above have drifted out
    // of sync -- regenerate via `just gen-zk-lifecycle-fixture`.
    assert_eq!(
        PUBLIC_INPUTS_BYTES.len(),
        96,
        "public_inputs fixture must be 96 bytes"
    );
    assert_eq!(
        &PUBLIC_INPUTS_BYTES[0..32],
        &root[..],
        "public_inputs[0..32] must equal root"
    );
    assert_eq!(
        &PUBLIC_INPUTS_BYTES[32..64],
        &nullifier[..],
        "public_inputs[32..64] must equal nullifier"
    );
    assert_eq!(
        &PUBLIC_INPUTS_BYTES[64..96],
        &auth_hash[..],
        "public_inputs[64..96] must equal auth_hash"
    );

    LifecycleFixture {
        account: ACCOUNT,
        controller: CONTROLLER,
        network_passphrase: NETWORK_PASSPHRASE,
        new_pubkey,
        nonce: NONCE,
        timelock_secs: TIMELOCK_SECS,
        secret_hex: SECRET_HEX,
        leaf_stored: hex32(LEAF_STORED_HEX),
        root,
        nullifier,
        auth_hash,
        proof: PROOF_BYTES.to_vec(),
        public_inputs: PUBLIC_INPUTS_BYTES.to_vec(),
    }
}
