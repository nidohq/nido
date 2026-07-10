//! Host-side reconstruction of the `zk_recovery` circuit's Poseidon2
//! commitments (leaf wrap, nullifier, `auth_hash`).
//!
//! `circuits/zk_recovery/src/main.nr:6-9,36-42` is the source of truth for
//! every domain constant and formula here -- this module must reproduce the
//! circuit's field elements exactly, or a real `bb prove` proof's public
//! inputs will never match what the contract recomputes on-chain. That
//! match (proven by this module's tests against the M1 fixture, see below)
//! is the entire reason the ZK-recovery design works.
//!
//! The Poseidon2 host construction (`p2`) is the exact one M0 proved is
//! NATIVE-compatible with Noir's `Poseidon2::hash` at arities 2, 4, and 15
//! (`crates/integration-tests/tests/it/zk_vectors.rs`), copied from
//! `../zk/rs-soroban-ultrahonk/tornado_classic/contracts/src/mixer.rs:48-60`.

use soroban_poseidon::{poseidon2_hash, Field as PoseidonField};
use soroban_sdk::address_payload::AddressPayload;
use soroban_sdk::crypto::BnScalar;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec as SorobanVec, U256};

/// Domain-separation constants, identical to
/// `circuits/zk_recovery/src/main.nr:6-9`.
const DOM_LEAF_HEX: &str = "0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a";
const DOM_BIND_HEX: &str = "0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81";
const DOM_NULL_HEX: &str = "0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2";
const DOM_AUTH_HEX: &str = "0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906";

/// Parses a `0x`-prefixed, 64-hex-digit constant into a `U256` domain tag.
pub fn dom(env: &Env, hex: &str) -> U256 {
    u256_from_bytes32(env, &hex32(hex))
}

/// Poseidon2 host sponge, exactly as proven native to Noir's
/// `Poseidon2::hash` at every arity the protocol uses (2, 4, 15). Each input
/// is reduced mod the BN254 scalar field before hashing, mirroring the
/// circuit (which operates on `Field` elements that are already `< r`).
pub fn p2(env: &Env, inputs: &[U256]) -> BytesN<32> {
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
/// zero-extended 16-byte halves (the `acct_hi`/`acct_lo`, `ctrl_hi`/`ctrl_lo`
/// convention `main.nr` calls `split(contract_id(...))`).
///
/// Uses the same `AddressPayload` hazmat mechanism the M1 Task 1 fixture
/// harness proved round-trips a `register_at`-pinned contract id
/// (`crates/integration-tests/tests/it/zk_fixture.rs::fixture_addresses_pin`):
/// `AddressPayload::from_address` decodes via `Address::to_xdr`, whose
/// `ScAddress::Contract` payload's trailing 32 bytes are the contract id.
pub fn split_addr(env: &Env, addr: &Address) -> (U256, U256) {
    let id = match AddressPayload::from_address(addr) {
        Some(AddressPayload::ContractIdHash(hash)) => hash.to_array(),
        _ => panic!("zk-recovery: split_addr requires a contract Address"),
    };
    split16(env, &id)
}

/// BE 16/16-byte split into two zero-extended 32-byte field elements
/// (`hi[16..32] = bytes[0..16]`, `lo[16..32] = bytes[16..32]`) -- the
/// convention `main.nr` uses for `acct_hi/lo`, `ctrl_hi/lo`, `npass_hi/lo`,
/// `pk_x_hi/lo`, `pk_y_hi/lo`.
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
/// bytes zero), matching how `main.nr` treats `action`/`nonce`/
/// `timelock_secs`/`pk_prefix` -- plain small `Field` values, not split.
fn u256_from_u64(env: &Env, x: u64) -> U256 {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&x.to_be_bytes());
    u256_from_bytes32(env, &out)
}

/// Parses a `0x`-prefixed, 64-hex-digit string into 32 bytes. Panics (not a
/// `Result`) because every caller passes a hardcoded constant -- a failure
/// here is a bug in this file, not a runtime/user condition.
fn hex32(hex: &str) -> [u8; 32] {
    let s = hex.strip_prefix("0x").unwrap_or(hex);
    assert_eq!(
        s.len(),
        64,
        "zk-recovery: expected a 32-byte (64 hex digit) constant"
    );
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

/// `inner = P2_2(DOM_LEAF, secret)` (`main.nr:36`). Computed client-side in
/// production (spec §2.2) -- the contract never calls this on-chain; it is
/// exposed so tests (and off-chain tooling) can derive `inner` from a secret
/// using the exact construction the circuit uses.
pub fn leaf_inner(env: &Env, secret: &BytesN<32>) -> BytesN<32> {
    let dom_leaf = dom(env, DOM_LEAF_HEX);
    let secret_u256 = u256_from_bytes32(env, &secret.to_array());
    p2(env, &[dom_leaf, secret_u256])
}

/// `stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)` (`main.nr:37`) --
/// computed BY THE POOL at insert time (spec §2.2). This on-chain wrap is
/// what makes leaf/account binding enforceable by insert authorization
/// rather than trusted from client input.
pub fn wrap_leaf(env: &Env, acct: &Address, inner: &BytesN<32>) -> BytesN<32> {
    let (acct_hi, acct_lo) = split_addr(env, acct);
    let dom_bind = dom(env, DOM_BIND_HEX);
    let inner_u256 = u256_from_bytes32(env, &inner.to_array());
    p2(env, &[dom_bind, acct_hi, acct_lo, inner_u256])
}

/// `N = P2_4(DOM_NULL, acct_hi, acct_lo, secret)` (`main.nr:39`, spec §2.3).
/// Test-only: in production the contract compares against the proof's
/// public `nullifier` input rather than recomputing it (the secret never
/// appears on-chain). Exposed here so tests can derive the expected
/// nullifier for a witness the same way the circuit does.
pub fn compute_nullifier(env: &Env, account: &Address, secret: &BytesN<32>) -> BytesN<32> {
    let (acct_hi, acct_lo) = split_addr(env, account);
    let dom_null = dom(env, DOM_NULL_HEX);
    let secret_u256 = u256_from_bytes32(env, &secret.to_array());
    p2(env, &[dom_null, acct_hi, acct_lo, secret_u256])
}

/// `auth_hash = P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo,
/// ctrl_hi, ctrl_lo, pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce,
/// timelock_secs)` (`main.nr:40-42`, spec §2.4). This is the controller's
/// canonicalization recompute: every consequential call argument is bound
/// in here, so a prover cannot swap any of them without invalidating the
/// proof's `auth_hash` public input.
#[allow(clippy::too_many_arguments)]
pub fn compute_auth_hash(
    env: &Env,
    action: u32,
    account: &Address,
    network_passphrase: &Bytes,
    controller: &Address,
    pubkey: &BytesN<65>,
    nonce: u64,
    timelock_secs: u32,
) -> BytesN<32> {
    let dom_auth = dom(env, DOM_AUTH_HEX);
    let action_f = u256_from_u64(env, action as u64);
    let (acct_hi, acct_lo) = split_addr(env, account);
    let npass_hash = env.crypto().sha256(network_passphrase).to_bytes();
    let (npass_hi, npass_lo) = split16(env, &npass_hash.to_array());
    let (ctrl_hi, ctrl_lo) = split_addr(env, controller);

    let pk_bytes = pubkey.to_array();
    let pk_prefix = u256_from_u64(env, pk_bytes[0] as u64);
    let mut pk_x = [0u8; 32];
    pk_x.copy_from_slice(&pk_bytes[1..33]);
    let mut pk_y = [0u8; 32];
    pk_y.copy_from_slice(&pk_bytes[33..65]);
    let (pk_x_hi, pk_x_lo) = split16(env, &pk_x);
    let (pk_y_hi, pk_y_lo) = split16(env, &pk_y);

    let nonce_f = u256_from_u64(env, nonce);
    let timelock_f = u256_from_u64(env, timelock_secs as u64);

    p2(
        env,
        &[
            dom_auth, action_f, acct_hi, acct_lo, npass_hi, npass_lo, ctrl_hi, ctrl_lo, pk_prefix,
            pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce_f, timelock_f,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // The M1 lifecycle fixture's pinned witness + circuit-committed
    // outputs, copied verbatim from
    // `crates/integration-tests/src/zk_fixture.rs` (ACCOUNT/CONTROLLER/
    // NETWORK_PASSPHRASE/NONCE/TIMELOCK_SECS/ACTION consts and the
    // SECRET_HEX/LEAF_STORED_HEX/NULLIFIER_HEX/AUTH_HASH_HEX values, which
    // that module in turn asserts equal
    // `circuits/zk_recovery/fixtures/lifecycle/prover_inputs.json` and the
    // committed real `bb prove` `public_inputs` fixture). If any of these
    // ever drift, regenerate via `just gen-zk-lifecycle-fixture` and update
    // both files together -- never hand-edit one without the other.
    const ACCOUNT: [u8; 32] = [0x11; 32];
    const CONTROLLER: [u8; 32] = [0x22; 32];
    const NETWORK_PASSPHRASE: &str = "Test SDF Network ; September 2015";
    const NONCE: u64 = 1;
    const TIMELOCK_SECS: u32 = 1_209_600;
    const ACTION: u32 = 1;
    // `new_pubkey` for `NEW_PUBKEY_SEED = 424_242` in zk_fixture.rs, copied
    // from `circuits/zk_recovery/fixtures/lifecycle/prover_inputs.json`'s
    // `new_pubkey` field.
    const NEW_PUBKEY_HEX: &str = "0x042bb2f07c58a9bacf9e794ba2b1589292716ca4b05a6d97b97eb293a160898b00f9fa128ee95baeceff2a25348632424406106595b3dd673db63bb3eef0815186";
    const SECRET_HEX: &str = "0x00000000000000000000000000000000d80e5c7596cf3ed7868f8bc89b6cf93c";
    const LEAF_STORED_HEX: &str =
        "0x27cfe62058beb8e80b7c27b5b43225643b3b062f300c3bd28f41ddd20de50880";
    const NULLIFIER_HEX: &str =
        "0x1b2c4afb313af3435729561fee62d1b065c4b3aad8e8fc6ca5447936a2f8edce";
    const AUTH_HASH_HEX: &str =
        "0x111ae1edc6e6854540153d3098793786fe1f37bd208992a95b9d9038d9c37baf";

    fn hex_bytes<const N: usize>(hex: &str) -> [u8; N] {
        let s = hex.strip_prefix("0x").unwrap_or(hex);
        assert_eq!(s.len(), N * 2, "expected {N}-byte hex string, got {s:?}");
        let mut out = [0u8; N];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    /// Builds an unregistered contract `Address` with the given raw id via
    /// the same `AddressPayload` construction
    /// `zk_fixture.rs::fixture_addresses_pin` uses. `split_addr` decodes an
    /// `Address` purely from its XDR payload (no deployed contract required
    /// behind it), so this is sufficient to exercise `hash.rs` in isolation
    /// -- later tasks that actually invoke these addresses will deploy real
    /// contracts at them via `env.register_at`, as the M1 Task 1 harness
    /// does.
    fn addr_from(env: &Env, id: &[u8; 32]) -> Address {
        AddressPayload::ContractIdHash(BytesN::from_array(env, id)).to_address(env)
    }

    #[test]
    fn auth_hash_matches_fixture() {
        let env = Env::default();
        let account = addr_from(&env, &ACCOUNT);
        let controller = addr_from(&env, &CONTROLLER);
        let pass = Bytes::from_slice(&env, NETWORK_PASSPHRASE.as_bytes());
        let pk: BytesN<65> = BytesN::from_array(&env, &hex_bytes::<65>(NEW_PUBKEY_HEX));

        let got = compute_auth_hash(
            &env,
            ACTION,
            &account,
            &pass,
            &controller,
            &pk,
            NONCE,
            TIMELOCK_SECS,
        );

        assert_eq!(
            got,
            BytesN::from_array(&env, &hex_bytes::<32>(AUTH_HASH_HEX)),
            "host auth_hash must match the M1 fixture's circuit-committed auth_hash -- \
             a mismatch here means a real bb-prove proof's public input will never \
             verify against this contract's recompute"
        );
    }

    #[test]
    fn wrap_leaf_matches_fixture() {
        let env = Env::default();
        let account = addr_from(&env, &ACCOUNT);
        let secret = BytesN::from_array(&env, &hex_bytes::<32>(SECRET_HEX));
        let inner = leaf_inner(&env, &secret);

        let got = wrap_leaf(&env, &account, &inner);

        assert_eq!(
            got,
            BytesN::from_array(&env, &hex_bytes::<32>(LEAF_STORED_HEX)),
            "host wrap_leaf must match the M1 fixture's circuit-committed leaf_stored"
        );
    }

    #[test]
    fn compute_nullifier_matches_fixture() {
        let env = Env::default();
        let account = addr_from(&env, &ACCOUNT);
        let secret = BytesN::from_array(&env, &hex_bytes::<32>(SECRET_HEX));

        let got = compute_nullifier(&env, &account, &secret);

        assert_eq!(
            got,
            BytesN::from_array(&env, &hex_bytes::<32>(NULLIFIER_HEX)),
            "host compute_nullifier must match the M1 fixture's circuit-committed nullifier"
        );
    }
}
