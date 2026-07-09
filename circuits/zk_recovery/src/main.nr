use dep::poseidon::poseidon2::Poseidon2;

mod tests;

global DEPTH: u32 = 24;
global DOM_LEAF: Field = 0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274a;
global DOM_BIND: Field = 0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81;
global DOM_NULL: Field = 0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2;
global DOM_AUTH: Field = 0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906;

fn hash2(a: Field, b: Field) -> Field { Poseidon2::hash([a, b], 2) }

fn compute_root(leaf: Field, sib: [Field; DEPTH], bits: [Field; DEPTH]) -> Field {
    let mut cur = leaf;
    for i in 0..DEPTH {
        assert(bits[i] * (1 - bits[i]) == 0);
        cur = if bits[i] == 0 { hash2(cur, sib[i]) } else { hash2(sib[i], cur) };
    }
    cur
}

pub fn main(
    root: pub Field,
    nullifier: pub Field,
    auth_hash: pub Field,
    secret: Field,
    acct_hi: Field, acct_lo: Field,
    path_siblings: [Field; DEPTH],
    path_bits: [Field; DEPTH],
    action: Field,
    npass_hi: Field, npass_lo: Field,
    ctrl_hi: Field, ctrl_lo: Field,
    pk_prefix: Field, pk_x_hi: Field, pk_x_lo: Field, pk_y_hi: Field, pk_y_lo: Field,
    nonce: Field, timelock_secs: Field,
) {
    let inner  = Poseidon2::hash([DOM_LEAF, secret], 2);
    let stored = Poseidon2::hash([DOM_BIND, acct_hi, acct_lo, inner], 4);
    assert(compute_root(stored, path_siblings, path_bits) == root);
    assert(Poseidon2::hash([DOM_NULL, acct_hi, acct_lo, secret], 4) == nullifier);
    assert(Poseidon2::hash(
        [DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo, ctrl_hi, ctrl_lo,
         pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce, timelock_secs], 15) == auth_hash);
}
