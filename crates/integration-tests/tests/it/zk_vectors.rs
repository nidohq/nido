//! Cross-language Poseidon2 hash parity: the Soroban on-chain host hash must
//! agree with the Noir-circuit hash at every arity the ZK recovery protocol
//! uses (2, 4, 15). This is the keystone of the ZK recovery feature: if the
//! host and circuit disagree, every downstream `leaf/nullifier/auth_hash` is
//! unprovable.
//!
//! The vectors in `tests/vectors/zk-recovery/vectors.json` are authoritative
//! output from Noir's `Poseidon2::hash` (see `circuits/_poseidon_vectors/`
//! for the generator). This test only asserts that the host construction
//! below reproduces them -- Noir is the source of truth, not this test.

use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{crypto::BnScalar, Bytes, Env, Vec as SVec, U256};

fn p2(env: &Env, inputs: &[[u8; 32]]) -> [u8; 32] {
    let modulus = <BnScalar as Field>::modulus(env);
    let mut v = SVec::new(env);
    for x in inputs {
        v.push_back(U256::from_be_bytes(env, &Bytes::from_array(env, x)).rem_euclid(&modulus));
    }
    let out = poseidon2_hash::<4, BnScalar>(env, &v);
    let mut a = [0u8; 32];
    out.to_be_bytes().copy_into_slice(&mut a);
    a
}

fn hex32(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    assert_eq!(s.len(), 64, "expected 32-byte hex string, got {s:?}");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

#[test]
fn host_poseidon2_matches_noir_vectors() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let vectors = include_str!("../../../../tests/vectors/zk-recovery/vectors.json");
    let v: serde_json::Value = serde_json::from_str(vectors).unwrap();
    let cases = v["poseidon2"]
        .as_array()
        .expect("vectors.json must have a top-level \"poseidon2\" array");
    assert!(
        !cases.is_empty(),
        "vectors.json \"poseidon2\" array must not be empty"
    );

    let mut arities_seen: Vec<usize> = Vec::new();
    for tc in cases {
        let ins: Vec<[u8; 32]> = tc["inputs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| hex32(h.as_str().unwrap()))
            .collect();
        let want = hex32(tc["output"].as_str().unwrap());
        let got = p2(&env, &ins);
        assert_eq!(
            got,
            want,
            "arity {} mismatch (host vs Noir) for inputs {:?}",
            ins.len(),
            tc["inputs"]
        );
        arities_seen.push(ins.len());
    }

    for expected_arity in [2usize, 4, 15] {
        assert!(
            arities_seen.contains(&expected_arity),
            "vectors.json must cover arity {expected_arity}"
        );
    }
}
