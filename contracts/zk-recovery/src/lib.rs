#![no_std]
#![allow(dead_code)]

//! `contracts/zk-recovery` -- the global Poseidon2 Merkle commitment pool,
//! timelocked recovery state machine, and OZ `Policy` completion authority
//! (`docs/superpowers/specs/2026-07-02-zk-recovery-design.md` §3).
//!
//! M1 Task 2 scaffolds the crate and lands the host-hashing module
//! (`hash.rs`) plus storage/error/event types (`types.rs`). M1 Task 3 adds
//! `merkle.rs` (frontier + root ring). M1 Task 4 adds `pool.rs`, which
//! introduces this crate's first `#[contract]` struct (`pool::ZkRecovery`)
//! with the account-bound `insert`/`insert_for` entry points. Later M1 tasks
//! add `controller.rs` (`initiate_recovery`/`cancel_recovery`/
//! `burn_nullifier`) and `policy.rs` (the OZ `Policy` completion impl) as
//! more `#[contractimpl]` blocks on the same `ZkRecovery` contract.

pub mod hash;
pub mod merkle;
pub mod pool;
pub mod types;
