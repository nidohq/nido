//! Depth-24 incremental Poseidon2 Merkle frontier + 128-slot historic-root
//! ring (`docs/superpowers/specs/2026-07-02-zk-recovery-design.md` §3.4).
//!
//! Adapted from
//! `../zk/rs-soroban-ultrahonk/tornado_classic/contracts/src/mixer.rs`'s
//! `zeroes_for_tree`/`deposit` (lines ~62-72, ~109-160), which run the same
//! frontier algorithm at `TREE_DEPTH=20` with one instance-storage key per
//! level. This module runs it at `DEPTH=24` (spec: 16.7M leaves) and stores
//! the whole frontier and the whole root ring as single persistent `Vec`s
//! (spec §3.4: "Frontier (24x32 B) and root ring (128x32 B) each a single
//! persistent `Vec`, `extend_ttl(max)` on every write").
//!
//! Interior nodes use the raw (DOM-free) 2-to-1 `hash::p2` -- exactly
//! `circuits/zk_recovery/src/main.nr`'s `hash2` and `mixer.rs`'s
//! `poseidon2_hash2`. Leaves are already `DOM_BIND`-tagged by
//! `hash::wrap_leaf`, so they can't collide with an interior node even
//! though interior hashing itself carries no domain tag.
//!
//! These are plain module functions, not `#[contractimpl]` entry points --
//! M1 Task 4 wraps `insert_leaf` in `insert`/`insert_for` once account
//! binding exists.

use crate::hash::p2;
use crate::types::{RecoveryError, RecoveryKey};
use soroban_sdk::{panic_with_error, Bytes, BytesN, Env, Vec as SorobanVec, U256};

/// Tree depth (spec §3.4: every account burns one leaf at creation, plus
/// re-enrollments -- 16.7M leaves).
pub const DEPTH: u32 = 24;
const MAX_LEAVES: u32 = 1u32 << DEPTH;
/// Historic-root ring capacity (spec §3.4).
const RING_SIZE: u32 = 128;

/// Raw (DOM-free) 2-to-1 interior hash, `P2_2(a, b)`. `hash::p2` already
/// reduces each input mod the BN254 scalar field, so this is a thin
/// bytes<->U256 adapter.
fn hash2(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let a_u256 = U256::from_be_bytes(env, &Bytes::from_array(env, &a.to_array()));
    let b_u256 = U256::from_be_bytes(env, &Bytes::from_array(env, &b.to_array()));
    p2(env, &[a_u256, b_u256])
}

/// `zero[0] = 0x00..00` (the empty-leaf value); `zero[i+1] = hash2(zero[i],
/// zero[i])`. Length `DEPTH + 1`; `zero[DEPTH]` is the empty-tree root
/// (`mixer.rs:62-72`, generalized from `TREE_DEPTH=20` to `DEPTH=24`).
fn zero_chain(env: &Env) -> SorobanVec<BytesN<32>> {
    let mut zeroes = SorobanVec::new(env);
    let mut cur = BytesN::from_array(env, &[0u8; 32]);
    zeroes.push_back(cur.clone());
    for _ in 0..DEPTH {
        cur = hash2(env, &cur, &cur);
        zeroes.push_back(cur.clone());
    }
    zeroes
}

/// Extends a persistent entry's TTL to the network max (spec §3.4,
/// refreshed by every account creation).
fn extend_persistent_max(env: &Env, key: &RecoveryKey) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(key, max, max);
}

/// Loads the persistent frontier `Vec`, or -- on the very first call --
/// builds one seeded with the zero chain. Those seed values are never
/// actually read as siblings: a fresh tree's leaf 0 has every bit 0, so
/// `insert_leaf`'s first pass writes every level before any later insert
/// could read one, matching `mixer.rs`'s per-read
/// `unwrap_or_else(zeroes[i])` default but computed once up front instead.
fn load_frontier(env: &Env, zeroes: &SorobanVec<BytesN<32>>) -> SorobanVec<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&RecoveryKey::Frontier)
        .unwrap_or_else(|| {
            let mut f = SorobanVec::new(env);
            for i in 0..DEPTH {
                f.push_back(zeroes.get_unchecked(i));
            }
            f
        })
}

fn load_ring(env: &Env) -> SorobanVec<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&RecoveryKey::RootRing)
        .unwrap_or_else(|| SorobanVec::new(env))
}

/// The number of leaves inserted so far (also the index the next
/// `insert_leaf` will use).
pub fn next_index(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&RecoveryKey::NextIndex)
        .unwrap_or(0)
}

fn ring_head(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&RecoveryKey::RingHead)
        .unwrap_or(0)
}

/// The most recently computed root, or the depth-24 empty-tree root if no
/// leaf has ever been inserted.
pub fn current_root(env: &Env) -> BytesN<32> {
    let head = ring_head(env);
    if head == 0 {
        return zero_chain(env).get_unchecked(DEPTH);
    }
    let ring = load_ring(env);
    ring.get_unchecked((head - 1) % RING_SIZE)
}

/// True if `root` is retained in the 128-slot historic-root ring, or is the
/// depth-24 empty-tree root (before any insert). The ring's most recently
/// written slot always holds the current root, so this subsumes the
/// "or is the current root" case from the ring scan alone.
pub fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    let head = ring_head(env);
    if head == 0 {
        return *root == zero_chain(env).get_unchecked(DEPTH);
    }
    let ring = load_ring(env);
    let count = core::cmp::min(head, RING_SIZE);
    for i in 0..count {
        let slot = (head - 1 - i) % RING_SIZE;
        if ring.get_unchecked(slot) == *root {
            return true;
        }
    }
    false
}

/// Appends `stored` as the next leaf, updates the incremental frontier
/// (`mixer.rs:109-160` at `DEPTH=24`), pushes the new root into the
/// 128-slot ring at `ring_head % 128`, bumps `ring_head`, extends every
/// persistent entry's TTL to the network max, and increments `next_index`.
/// Returns the inserted leaf's index. Panics with
/// `RecoveryError::TreeFull` once `next_index` would reach `2^24`.
pub fn insert_leaf(env: &Env, stored: &BytesN<32>) -> u32 {
    let idx = next_index(env);
    if idx >= MAX_LEAVES {
        panic_with_error!(env, RecoveryError::TreeFull);
    }

    let zeroes = zero_chain(env);
    let mut frontier = load_frontier(env, &zeroes);

    let mut cur = stored.clone();
    for level in 0..DEPTH {
        let bit = (idx >> level) & 1;
        if bit == 0 {
            // `cur` becomes the left sibling future inserts at this level
            // will pair with; combine with the zero subtree for now.
            frontier.set(level, cur.clone());
            let z = zeroes.get_unchecked(level);
            cur = hash2(env, &cur, &z);
        } else {
            // Combine with the left sibling a prior insert saved.
            let left = frontier.get_unchecked(level);
            cur = hash2(env, &left, &cur);
        }
    }
    let root = cur;

    env.storage()
        .persistent()
        .set(&RecoveryKey::Frontier, &frontier);
    extend_persistent_max(env, &RecoveryKey::Frontier);

    let mut ring = load_ring(env);
    let head = ring_head(env);
    let slot = head % RING_SIZE;
    if slot < ring.len() {
        ring.set(slot, root.clone());
    } else {
        ring.push_back(root.clone());
    }
    env.storage()
        .persistent()
        .set(&RecoveryKey::RootRing, &ring);
    extend_persistent_max(env, &RecoveryKey::RootRing);

    env.storage()
        .instance()
        .set(&RecoveryKey::RingHead, &(head + 1));
    env.storage()
        .instance()
        .set(&RecoveryKey::NextIndex, &(idx + 1));

    idx
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, Address};

    // A storage context to run `merkle.rs`'s module functions under via
    // `env.as_contract` -- this crate has no `#[contract]` struct yet
    // (later M1 tasks add one); this test-only stand-in carries no
    // functions of its own.
    #[contract]
    struct TestContract;

    #[contractimpl]
    impl TestContract {}

    fn setup(env: &Env) -> Address {
        env.register(TestContract, ())
    }

    fn be32_from_u64(x: u64) -> [u8; 32] {
        let mut a = [0u8; 32];
        a[24..32].copy_from_slice(&x.to_be_bytes());
        a
    }

    // ---- Independent reference implementation ---------------------------
    //
    // Deliberately does NOT call `hash2`/`zero_chain`/`insert_leaf`/
    // `current_root` above -- it reimplements the incremental-Merkle
    // frontier algorithm from scratch (adapted from `mixer.rs` tests'
    // `frontier_root_from_leaves`/`zero_at`/`hash2`), so a wrong sibling or
    // level in the module under test actually gets caught rather than
    // trivially agreeing with itself. It reuses `hash::p2` as the leaf
    // primitive -- that primitive is independently proven against the
    // circuit in `hash.rs`'s own tests (M1 Task 2), so re-deriving
    // Poseidon2 by hand here would add risk, not confidence.

    fn ref_hash2(env: &Env, a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
        let a_u256 = U256::from_be_bytes(env, &Bytes::from_array(env, a));
        let b_u256 = U256::from_be_bytes(env, &Bytes::from_array(env, b));
        p2(env, &[a_u256, b_u256]).to_array()
    }

    fn ref_zero_at(env: &Env, level: u32) -> [u8; 32] {
        let mut z = [0u8; 32];
        for _ in 0..level {
            z = ref_hash2(env, &z, &z);
        }
        z
    }

    /// A from-scratch incremental-Merkle accumulator, independent of
    /// `merkle.rs`'s storage-backed frontier. Holds its own in-memory
    /// frontier array and replays the textbook algorithm leaf by leaf.
    struct RefTree<'a> {
        env: &'a Env,
        frontier: [Option<[u8; 32]>; DEPTH as usize],
        next_index: u32,
    }

    impl<'a> RefTree<'a> {
        fn new(env: &'a Env) -> Self {
            Self {
                env,
                frontier: [None; DEPTH as usize],
                next_index: 0,
            }
        }

        fn insert(&mut self, leaf: [u8; 32]) -> [u8; 32] {
            let idx = self.next_index;
            let mut cur = leaf;
            for level in 0..DEPTH {
                let bit = (idx >> level) & 1;
                if bit == 0 {
                    self.frontier[level as usize] = Some(cur);
                    let z = ref_zero_at(self.env, level);
                    cur = ref_hash2(self.env, &cur, &z);
                } else {
                    let left = self.frontier[level as usize]
                        .unwrap_or_else(|| ref_zero_at(self.env, level));
                    cur = ref_hash2(self.env, &left, &cur);
                }
            }
            self.next_index += 1;
            cur
        }
    }

    #[test]
    fn frontier_root_matches_independent_reference() {
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let id = setup(&env);

        let leaves: [[u8; 32]; 8] = core::array::from_fn(|i| {
            let a = be32_from_u64(i as u64);
            let b = be32_from_u64(i as u64 + 100);
            ref_hash2(&env, &a, &b)
        });

        let mut reference = RefTree::new(&env);
        let mut expected_roots: [BytesN<32>; 8] =
            core::array::from_fn(|_| BytesN::from_array(&env, &[0u8; 32]));

        for (n, leaf) in leaves.iter().enumerate() {
            let stored = BytesN::from_array(&env, leaf);
            let idx = env.as_contract(&id, || insert_leaf(&env, &stored));
            assert_eq!(
                idx, n as u32,
                "insert_leaf must return the pre-insert next_index"
            );

            let expected = BytesN::from_array(&env, &reference.insert(*leaf));
            expected_roots[n] = expected.clone();

            let onchain_root = env.as_contract(&id, || current_root(&env));
            assert_eq!(
                onchain_root, expected,
                "on-chain frontier root must match the independent reference recompute after leaf {n}"
            );

            let known = env.as_contract(&id, || is_known_root(&env, &onchain_root));
            assert!(
                known,
                "root after leaf {n} must be known immediately after insert"
            );
        }

        // Every intermediate root (well under the 128-slot ring capacity)
        // must still be retained.
        for (n, expected) in expected_roots.iter().enumerate() {
            let known = env.as_contract(&id, || is_known_root(&env, expected));
            assert!(
                known,
                "intermediate root after leaf {n} should still be retained"
            );
        }

        assert_eq!(
            env.as_contract(&id, || next_index(&env)),
            leaves.len() as u32
        );
    }

    #[test]
    fn empty_tree_root_is_known_before_any_insert() {
        let env = Env::default();
        let id = setup(&env);

        let expected = BytesN::from_array(&env, &ref_zero_at(&env, DEPTH));
        let onchain_root = env.as_contract(&id, || current_root(&env));
        assert_eq!(onchain_root, expected);
        assert!(env.as_contract(&id, || is_known_root(&env, &expected)));
        assert_eq!(env.as_contract(&id, || next_index(&env)), 0);
    }

    #[test]
    fn ring_evicts_oldest_root_after_129_inserts() {
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let id = setup(&env);

        const N: usize = 129;
        let leaves: [[u8; 32]; N] = core::array::from_fn(|i| {
            let a = be32_from_u64(i as u64);
            let b = be32_from_u64(i as u64 + 1_000_000);
            ref_hash2(&env, &a, &b)
        });

        let mut reference = RefTree::new(&env);
        let mut roots: [BytesN<32>; N] =
            core::array::from_fn(|_| BytesN::from_array(&env, &[0u8; 32]));

        for (n, leaf) in leaves.iter().enumerate() {
            let stored = BytesN::from_array(&env, leaf);
            env.as_contract(&id, || insert_leaf(&env, &stored));
            roots[n] = BytesN::from_array(&env, &reference.insert(*leaf));
        }

        // The root produced by the very first insert (index 0) must now be
        // evicted -- it is the 129th-oldest of 129 roots, and the ring
        // only retains the newest 128.
        let evicted = env.as_contract(&id, || is_known_root(&env, &roots[0]));
        assert!(
            !evicted,
            "root after leaf 0 must be evicted once 129 roots have been produced"
        );

        // The latest 128 roots (produced by leaves 1..=128) must all still
        // be retained.
        for (n, root) in roots.iter().enumerate().skip(1) {
            let known = env.as_contract(&id, || is_known_root(&env, root));
            assert!(known, "root after leaf {n} should still be retained");
        }

        let onchain_root = env.as_contract(&id, || current_root(&env));
        assert_eq!(onchain_root, roots[N - 1]);
        assert_eq!(env.as_contract(&id, || next_index(&env)), N as u32);
    }
}
