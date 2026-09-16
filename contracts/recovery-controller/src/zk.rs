//! ZK evidence verification adapter. Cross-calls the enrolled
//! `nido-zk-recovery` Merkle pool (root membership) and the enrolled
//! `nido-recovery-verifier` (constructorless `UltraHonk` verifier) instance,
//! recomputing `auth_hash` on-chain via [`compute_doc_auth_hash`] so a caller
//! cannot swap ANY committed field (network, account, controller, action,
//! target doc hash, config version, baseline, attempt id, timelock) without
//! invalidating the proof.
//!
//! This module is intentionally self-contained: it does NOT depend on the
//! `nido-zk-recovery` crate. That crate's `hash::compute_auth_hash` binds a
//! raw P-256 pubkey (`pk_prefix`/`pk_x_hi/lo`/`pk_y_hi/lo`) into `auth_hash`
//! -- the M1 circuit shape, which predates document-hash-based recovery and
//! is not used by this crate. This crate's own circuit
//! (`circuits/zk_recovery_doc/src/main.nr`) binds `doc_hash_hi/lo`,
//! `cfg_version`, and `baseline_hi/lo` in that same arity-15 `auth_hash`
//! slot instead. Rather than mutate the shared M1 circuit/crate (which
//! `nido-zk-recovery`'s own still-active integration tests pin real
//! `bb`-proved fixtures against), this module duplicates the ~60 lines of
//! well-tested, unchanging Poseidon2 plumbing (`dom`/`p2`/`split_addr`/
//! `split16`) from `contracts/zk-recovery/src/hash.rs` verbatim and adapts
//! only the `auth_hash` field list. See
//! `crates/integration-tests/fixtures/zk_recovery_doc/` for this module's
//! own real `bb prove` fixture, generated against the new circuit.

use soroban_poseidon::{poseidon2_hash, Field as PoseidonField};
use soroban_sdk::address_payload::AddressPayload;
use soroban_sdk::crypto::BnScalar;
use soroban_sdk::{contractclient, Address, Bytes, BytesN, Env, Vec as SorobanVec, U256};

use crate::types::CommitmentAction;

/// Mirrors `nido-recovery-verifier::Error` exactly (same numeric codes, same
/// declaration order -- scerr's basic-mode auto-numbering gives 1/2/3 here
/// exactly like that crate's own `#[contracterror]` explicit values). This
/// crate deliberately does NOT depend on `nido-recovery-verifier` as a
/// normal Cargo dependency: both are `#[contract]` crates, and linking one
/// into the other's cdylib collides their `#[no_mangle]`-exported entry
/// points at wasm link time -- the identical reasoning
/// `contracts/recovery-controller/Cargo.toml` already documents for why this
/// crate doesn't depend on `nido-zk-recovery` either. `#[scerr]` (not plain
/// `#[contracterror]`) so it implements `SequentialError`, which
/// `ZkVerifyError`'s `#[from_contract_client]` composition below requires of
/// the wrapped type.
#[soroban_sdk_tools::scerr]
pub enum RecoveryVerifierError {
    VkParseError,
    ProofParseError,
    VerificationFailed,
}

/// Cross-contract client for the enrolled verifier's single entry point.
#[allow(unused)]
#[contractclient(name = "RecoveryVerifierClient")]
trait RecoveryVerifierInterface {
    fn verify_proof(
        e: &Env,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), RecoveryVerifierError>;
}

/// [`verify`]'s error space, composed via `soroban-sdk-tools`'s scerr
/// instead of the hand-rolled `Result<(), ()>` erasure this module used to
/// relay both the root check and the verifier cross-call with -- mirrors
/// `nido-smart-account`'s `ApplyDocError::DocCompiler` relay pattern. Purely
/// internal: `verify`/`call_verify_proof` are plain functions, not
/// `#[contractimpl]` entry points or `panic_with_error!` arguments, so
/// (unlike `ApplyDocError`) this type needs no `SpecShakingMarker` impl --
/// every caller in `contract.rs` maps this to one of `Error`'s existing
/// panic-raised variants instead of returning it across the ABI directly.
#[soroban_sdk_tools::scerr]
pub enum ZkVerifyError {
    /// `root` is not a known historical root of the enrolled pool -- checked
    /// before the (more expensive) verifier cross-call.
    UnknownRoot,
    /// The verifier's typed refusal, composed via scerr
    /// (`#[from_contract_client]`) instead of a hand-maintained numeric
    /// offset.
    #[from_contract_client]
    Verifier(RecoveryVerifierError),
    /// The verifier cross-call failed outright (no contract at the enrolled
    /// address, or a host trap). Fail closed.
    VerifierUnreachable,
}

/// Numeric action codes baked into the circuit's `auth_hash` (mirrors
/// `nido-zk-recovery::controller`'s `ACTION_INITIATE`/`ACTION_CANCEL`
/// convention, distinct numbering namespace since this is a different
/// circuit witness/protocol version). Cancellation-domain separation lives
/// here: a `Cancel` evidence proof's `auth_hash` can NEVER equal a
/// `LostKey`/`Compromise` proof's `auth_hash` for the same attempt, because
/// `action` is baked into the hash.
pub const ACTION_LOST_KEY: u32 = 1;
pub const ACTION_COMPROMISE: u32 = 2;
pub const ACTION_CANCEL: u32 = 3;

#[must_use]
pub fn action_code(action: &CommitmentAction) -> u32 {
    match action {
        CommitmentAction::LostKey => ACTION_LOST_KEY,
        CommitmentAction::Compromise => ACTION_COMPROMISE,
        CommitmentAction::Cancel => ACTION_CANCEL,
    }
}

/// Domain-separation constant for `auth_hash`, identical to
/// `circuits/zk_recovery_doc/src/main.nr`'s `DOM_AUTH` (and, since the
/// field-swap did not touch domain tags, to
/// `contracts/zk-recovery/src/hash.rs`'s `DOM_AUTH_HEX` / M1's
/// `circuits/zk_recovery/src/main.nr`'s `DOM_AUTH` -- these constants are
/// circuit-level, unrelated to which fields feed the hash).
const DOM_AUTH_HEX: &str = "0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906";

/// Parses a `0x`-prefixed, 64-hex-digit constant into a `U256` domain tag.
/// Verbatim copy of `contracts/zk-recovery/src/hash.rs::dom`.
fn dom(env: &Env, hex: &str) -> U256 {
    u256_from_bytes32(env, &hex32(hex))
}

/// Poseidon2 host sponge, exactly as proven native to Noir's
/// `Poseidon2::hash` at every arity the protocol uses (2, 4, 15). Verbatim
/// copy of `contracts/zk-recovery/src/hash.rs::p2`.
fn p2(env: &Env, inputs: &[U256]) -> BytesN<32> {
    let modulus = <BnScalar as PoseidonField>::modulus(env);
    let mut v: SorobanVec<U256> = SorobanVec::new(env);
    for x in inputs {
        v.push_back(x.rem_euclid(&modulus));
    }
    let out = poseidon2_hash::<4, BnScalar>(env, &v);
    let mut arr = [0u8; 32];
    out.to_be_bytes().copy_into_slice(&mut arr);
    BytesN::from_array(env, &arr)
}

/// Extracts an `Address`'s raw 32-byte contract-id and BE-splits it into two
/// zero-extended 16-byte halves. Verbatim copy of
/// `contracts/zk-recovery/src/hash.rs::split_addr`.
///
/// # Panics
///
/// Panics if `addr` is not a contract address (e.g. a Stellar account
/// `G...` address), since only contract ids have the 32-byte payload this
/// splits.
fn split_addr(env: &Env, addr: &Address) -> (U256, U256) {
    let id = match AddressPayload::from_address(addr) {
        Some(AddressPayload::ContractIdHash(hash)) => hash.to_array(),
        _ => panic!("recovery-controller: split_addr requires a contract Address"),
    };
    split16(env, &id)
}

/// BE 16/16-byte split into two zero-extended 32-byte field elements.
/// Verbatim copy of `contracts/zk-recovery/src/hash.rs::split16`.
fn split16(env: &Env, bytes: &[u8; 32]) -> (U256, U256) {
    let mut hi = [0u8; 32];
    hi[16..32].copy_from_slice(&bytes[0..16]);
    let mut lo = [0u8; 32];
    lo[16..32].copy_from_slice(&bytes[16..32]);
    (u256_from_bytes32(env, &hi), u256_from_bytes32(env, &lo))
}

fn u256_from_bytes32(env: &Env, bytes: &[u8; 32]) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, bytes))
}

/// BE-encodes `x` into the low 8 bytes of a 32-byte field element (top 24
/// bytes zero). Verbatim copy of
/// `contracts/zk-recovery/src/hash.rs::u256_from_u64`.
fn u256_from_u64(env: &Env, x: u64) -> U256 {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&x.to_be_bytes());
    u256_from_bytes32(env, &out)
}

/// Parses a `0x`-prefixed, 64-hex-digit string into 32 bytes. Verbatim copy
/// of `contracts/zk-recovery/src/hash.rs::hex32`.
fn hex32(hex: &str) -> [u8; 32] {
    let s = hex.strip_prefix("0x").unwrap_or(hex);
    assert_eq!(
        s.len(),
        64,
        "recovery-controller: expected a 32-byte (64 hex digit) constant"
    );
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

/// `auth_hash = P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo,
/// ctrl_hi, ctrl_lo, doc_hash_hi, doc_hash_lo, cfg_version, baseline_hi,
/// baseline_lo, attempt_id, timelock_secs)`, matching
/// `circuits/zk_recovery_doc/src/main.nr`'s `auth_hash` formula field for
/// field (the `attempt_id` argument here occupies the circuit's `nonce`
/// slot). Every consequential call argument is bound in here, so a prover
/// cannot swap any of them without invalidating the proof's `auth_hash`
/// public input.
#[allow(clippy::too_many_arguments)]
#[must_use]
pub fn compute_doc_auth_hash(
    env: &Env,
    action: u32,
    account: &Address,
    network_passphrase: &Bytes,
    controller: &Address,
    target_doc_hash: &BytesN<32>,
    config_version: u32,
    baseline_or_source_id: &BytesN<32>,
    attempt_id: u64,
    timelock_secs: u32,
) -> BytesN<32> {
    let dom_auth = dom(env, DOM_AUTH_HEX);
    let action_f = u256_from_u64(env, u64::from(action));
    let (acct_hi, acct_lo) = split_addr(env, account);
    let npass_hash = env.crypto().sha256(network_passphrase).to_bytes();
    let (npass_hi, npass_lo) = split16(env, &npass_hash.to_array());
    let (ctrl_hi, ctrl_lo) = split_addr(env, controller);
    let (doc_hash_hi, doc_hash_lo) = split16(env, &target_doc_hash.to_array());
    let cfg_version_f = u256_from_u64(env, u64::from(config_version));
    let (baseline_hi, baseline_lo) = split16(env, &baseline_or_source_id.to_array());
    let attempt_id_f = u256_from_u64(env, attempt_id);
    let timelock_f = u256_from_u64(env, u64::from(timelock_secs));

    p2(
        env,
        &[
            dom_auth,
            action_f,
            acct_hi,
            acct_lo,
            npass_hi,
            npass_lo,
            ctrl_hi,
            ctrl_lo,
            doc_hash_hi,
            doc_hash_lo,
            cfg_version_f,
            baseline_hi,
            baseline_lo,
            attempt_id_f,
            timelock_f,
        ],
    )
}

/// `root(32) || nullifier(32) || auth_hash(32)` -- identical wire format to
/// `nido-zk-recovery::controller::assemble_public_inputs`; the verifier
/// contract is circuit-shape-agnostic (it just checks a fixed-width public
/// input blob against the compiled-in VK), so this format is determined by
/// the CIRCUIT's `pub` parameter order (`root, nullifier, auth_hash` --
/// `circuits/zk_recovery_doc/src/main.nr`), not by this contract.
fn assemble_public_inputs(
    env: &Env,
    root: &BytesN<32>,
    nullifier: &BytesN<32>,
    auth_hash: &BytesN<32>,
) -> Bytes {
    let mut buf = [0u8; 96];
    buf[0..32].copy_from_slice(&root.to_array());
    buf[32..64].copy_from_slice(&nullifier.to_array());
    buf[64..96].copy_from_slice(&auth_hash.to_array());
    Bytes::from_array(env, &buf)
}

fn call_verify_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: &Bytes,
    proof: &Bytes,
) -> Result<(), ZkVerifyError> {
    match RecoveryVerifierClient::new(env, verifier).try_verify_proof(public_inputs, proof) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(ve)) => Err(ZkVerifyError::Verifier(ve)),
        // Conversion failure or host trap: the verifier is missing at the
        // enrolled address or misbehaving. Fail closed.
        _ => Err(ZkVerifyError::VerifierUnreachable),
    }
}

/// Cross-contract client for the enrolled pool's root-membership check.
#[allow(unused)]
#[contractclient(name = "ZkPoolClient")]
trait ZkPoolInterface {
    fn is_known_root(e: &Env, root: BytesN<32>) -> bool;
}

fn call_is_known_root(env: &Env, pool: &Address, root: &BytesN<32>) -> bool {
    ZkPoolClient::new(env, pool)
        .try_is_known_root(root)
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false)
}

/// Full ZK-evidence check: recomputes `auth_hash` from arguments THIS
/// contract knows (never trusts a caller-supplied `auth_hash`), checks
/// `root` against the enrolled pool's historic-root ring, assembles
/// `public_inputs` in the circuit's exact wire order, and cross-calls the
/// enrolled verifier.
///
/// # Errors
///
/// `UnknownRoot` if `root` is not a known historical root of the enrolled
/// pool (checked first, before the more expensive verifier cross-call).
/// `Verifier`/`VerifierUnreachable` (scerr composition, see
/// [`ZkVerifyError`]) if the enrolled verifier rejects the proof or the
/// cross-call itself fails. Callers map each variant to the corresponding
/// `Error::UnknownRoot`/`Error::VerificationFailed` panic.
#[allow(clippy::too_many_arguments)]
pub fn verify(
    env: &Env,
    pool: &Address,
    verifier: &Address,
    action: &CommitmentAction,
    account: &Address,
    network_passphrase: &Bytes,
    controller: &Address,
    target_doc_hash: &BytesN<32>,
    config_version: u32,
    baseline_or_source_id: &BytesN<32>,
    attempt_id: u64,
    delay_secs: u64,
    root: &BytesN<32>,
    nullifier: &BytesN<32>,
    proof: &Bytes,
) -> Result<(), ZkVerifyError> {
    if !call_is_known_root(env, pool, root) {
        return Err(ZkVerifyError::UnknownRoot);
    }

    let timelock_secs = u32::try_from(delay_secs).unwrap_or(u32::MAX);
    let auth_hash = compute_doc_auth_hash(
        env,
        action_code(action),
        account,
        network_passphrase,
        controller,
        target_doc_hash,
        config_version,
        baseline_or_source_id,
        attempt_id,
        timelock_secs,
    );
    let public_inputs = assemble_public_inputs(env, root, nullifier, &auth_hash);
    call_verify_proof(env, verifier, &public_inputs, proof)
}

#[cfg(test)]
mod tests {
    use super::*;

    // This crate's own pinned witness for `circuits/zk_recovery_doc` (a REAL
    // `bb prove` fixture, staged at
    // `crates/integration-tests/fixtures/zk_recovery_doc/{vk,proof,public_inputs}`).
    // Convention mirrors the M1 "lifecycle" fixture
    // (`circuits/zk_recovery/fixtures/lifecycle/`,
    // `contracts/zk-recovery/src/hash.rs`'s `auth_hash_matches_fixture`):
    // account=[0x11;32], controller=[0x22;32], the Test SDF Network
    // passphrase, attempt_id(nonce)=1, timelock_secs=1_209_600,
    // action=1 (ACTION_LOST_KEY). target_doc_hash=[0x99;32], cfg_version=1,
    // baseline=[0x88;32] occupy the field-swapped auth_hash slots -- see
    // `circuits/zk_recovery_doc/Prover.toml` for the full witness this
    // fixture was proved against.
    const ACCOUNT: [u8; 32] = [0x11; 32];
    const CONTROLLER: [u8; 32] = [0x22; 32];
    const NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";
    const ATTEMPT_ID: u64 = 1;
    const TIMELOCK_SECS: u32 = 1_209_600;
    const ACTION: u32 = ACTION_LOST_KEY;
    const TARGET_DOC_HASH: [u8; 32] = [0x99; 32];
    const CONFIG_VERSION: u32 = 1;
    const BASELINE: [u8; 32] = [0x88; 32];
    const AUTH_HASH_HEX: &str =
        "0x0f824a503a04acffc6ec611ef89dbb6a31fbd92a163864eff602e6d71905cb38";

    fn hex_bytes32(hex: &str) -> [u8; 32] {
        hex32(hex)
    }

    /// Builds an unregistered contract `Address` with the given raw id via
    /// the `AddressPayload` construction, mirroring
    /// `contracts/zk-recovery/src/hash.rs`'s test helper and
    /// `crates/integration-tests/tests/it/zk_fixture.rs::fixture_addresses_pin`.
    /// `split_addr` decodes an `Address` purely from its XDR payload (no
    /// deployed contract required behind it), so this is sufficient to
    /// exercise this module in isolation.
    fn addr_from(env: &Env, id: &[u8; 32]) -> Address {
        AddressPayload::ContractIdHash(BytesN::from_array(env, id)).to_address(env)
    }

    #[test]
    fn compute_doc_auth_hash_matches_fixture() {
        let env = Env::default();
        let account = addr_from(&env, &ACCOUNT);
        let controller = addr_from(&env, &CONTROLLER);
        let pass = Bytes::from_slice(&env, NETWORK_PASSPHRASE.as_bytes());
        let target_doc_hash: BytesN<32> = BytesN::from_array(&env, &TARGET_DOC_HASH);
        let baseline: BytesN<32> = BytesN::from_array(&env, &BASELINE);

        let got = compute_doc_auth_hash(
            &env,
            ACTION,
            &account,
            &pass,
            &controller,
            &target_doc_hash,
            CONFIG_VERSION,
            &baseline,
            ATTEMPT_ID,
            TIMELOCK_SECS,
        );

        assert_eq!(
            got,
            BytesN::from_array(&env, &hex_bytes32(AUTH_HASH_HEX)),
            "host compute_doc_auth_hash must match the zk_recovery_doc fixture's \
             circuit-committed auth_hash -- a mismatch here means the real bb-proved \
             proof at crates/integration-tests/fixtures/zk_recovery_doc/ will never \
             verify against this contract's recompute"
        );
    }
}
