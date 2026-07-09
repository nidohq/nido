// THROWAWAY GENERATOR CIRCUIT -- NOT the ZK recovery circuit.
//
// This package exists solely to produce authoritative Poseidon2 hash
// vectors from Noir's `poseidon` library, which the Rust integration test
// `crates/integration-tests/tests/it/zk_vectors.rs` checks the Soroban
// host's `poseidon2_hash::<4, BnScalar>` construction against.
//
// The real ZK recovery circuit is built in a later task under
// `circuits/zk_recovery/`. Do not confuse the two.
//
// Regenerate vectors with:
//   cd circuits/_poseidon_vectors && ~/.nargo/bin/nargo test --show-output
// then copy the printed hex outputs into
//   tests/vectors/zk-recovery/vectors.json

use poseidon::poseidon2::Poseidon2;

// Domain separation constants used by the ZK recovery protocol (must match
// the values baked into the Soroban contracts and the real circuit).
global DOM_LEAF: Field = 0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a;
global DOM_BIND: Field = 0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81;
global DOM_NULL: Field = 0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2;
global DOM_AUTH: Field = 0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906;

fn main() {}

// Prints a Field as its raw 32-byte big-endian value so the generator
// script can hex-encode it without doing bignum math by hand.
fn print_be_bytes(x: Field) {
    let bytes: [u8; 32] = x.to_be_bytes();
    println(bytes);
}

#[test]
fn vector_arity2_plain() {
    let out = Poseidon2::hash([1, 2], 2);
    print_be_bytes(out);
}

#[test]
fn vector_arity2_dom_leaf() {
    let out = Poseidon2::hash([DOM_LEAF, 1], 2);
    print_be_bytes(out);
}

#[test]
fn vector_arity4_dom_bind() {
    // [DOM_BIND, acct_hi, acct_lo, inner]
    let out = Poseidon2::hash([DOM_BIND, 1, 2, 3], 4);
    print_be_bytes(out);
}

#[test]
fn vector_arity4_dom_null() {
    // [DOM_NULL, acct_hi, acct_lo, secret]
    let out = Poseidon2::hash([DOM_NULL, 1, 2, 4], 4);
    print_be_bytes(out);
}

#[test]
fn vector_arity15_dom_auth() {
    // [DOM_AUTH, ...14 more small distinct field values]
    let out = Poseidon2::hash(
        [DOM_AUTH, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        15,
    );
    print_be_bytes(out);
}
