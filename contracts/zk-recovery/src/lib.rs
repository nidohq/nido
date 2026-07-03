#![no_std]
#![allow(dead_code)]

//! `contracts/zk-recovery` -- the global Poseidon2 Merkle commitment pool,
//! timelocked recovery state machine, and OZ `Policy` completion authority
//! (`docs/superpowers/specs/2026-07-02-zk-recovery-design.md` §3).
//!
//! M1 Task 2 scaffolds the crate and lands the host-hashing module
//! (`hash.rs`) plus storage/error/event types (`types.rs`). Later M1 tasks
//! add `merkle.rs` (frontier + root ring), `pool.rs` (account-bound
//! inserts), `controller.rs` (`initiate_recovery`/`cancel_recovery`/
//! `burn_nullifier`), and `policy.rs` (the OZ `Policy` completion impl) --
//! and wire a `#[contract]` struct here once those exist.

pub mod hash;
pub mod types;
