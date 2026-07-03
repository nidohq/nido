//! `initiate_recovery` (spec §3.3): verifies a REAL ZK proof end-to-end by
//! cross-calling the deployed `zk-verifier` contract, runs the ordered
//! validity checks, reserves the nullifier, and stores a timelocked
//! `PendingRecovery` record.
//!
//! Permissionless by design (no `require_auth` anywhere in this module) --
//! the entire security property comes from the proof verifying against an
//! `auth_hash` this contract recomputes itself from the call's own
//! arguments (`hash::compute_auth_hash`), not from trusting the caller's
//! identity. A caller cannot swap `new_pubkey`/`nonce`/`timelock_secs`/etc.
//! without invalidating the proof's `auth_hash` public input (proven by
//! this module's `tampered_new_pubkey_fails_proof_verification`-style
//! coverage in `crates/integration-tests/tests/it/zk_recovery_lifecycle.rs`).
//!
//! This file adds a second `#[contractimpl] impl ZkRecovery` block
//! alongside `pool.rs`'s -- `soroban_sdk::contractimpl`'s macro expansion
//! only generates the `ZkRecoveryClient` *type* once (from the `#[contract]`
//! struct declaration in `pool.rs`); every `#[contractimpl]` block
//! (`impl_only`) merely adds an `impl ZkRecoveryClient { ... }` extending
//! that same client with its methods. So `ZkRecoveryClient` ends up with
//! `insert`/`insert_for`/... from `pool.rs` AND `initiate_recovery`/
//! `get_pending`/`next_nonce` from here, on one client type.

use crate::hash::compute_auth_hash;
use crate::merkle::is_known_root;
#[allow(unused_imports)] // ZkRecoveryArgs/ZkRecoveryClient are referenced by
// the `#[contractimpl]` macro expansion below, not
// directly by name in this file's source.
use crate::pool::{config, ZkRecovery, ZkRecoveryArgs, ZkRecoveryClient};
use crate::types::{
    NullifierState, PendingRecovery, RecoveryError, RecoveryInitiated, RecoveryKey,
};
use soroban_sdk::{
    contractimpl, panic_with_error, Address, Bytes, BytesN, Env, IntoVal, InvokeError, Symbol, Val,
    Vec as SorobanVec,
};

/// `action = 1` means "initiate recovery" in the `zk_recovery` circuit's
/// protocol (`circuits/zk_recovery/src/main.nr`).
const ACTION_INITIATE: u32 = 1;

/// Rolling rate-limit window: 90 days, in seconds (spec §3.3).
const RATE_WINDOW_SECS: u64 = 90 * 24 * 3600;
/// Max initiations allowed per account within `RATE_WINDOW_SECS` (spec §3.3).
const RATE_LIMIT_MAX: u32 = 3;

/// Extends a persistent entry's TTL to the network max, mirroring
/// `merkle.rs::extend_persistent_max` (duplicated rather than made `pub` --
/// this module's keys are unrelated to the Merkle frontier's).
fn extend_persistent_max(env: &Env, key: &RecoveryKey) {
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(key, max, max);
}

fn stored_nonce(env: &Env, account: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&RecoveryKey::Nonce(account.clone()))
        .unwrap_or(0)
}

fn bump_nonce(env: &Env, account: &Address, nonce: u64) {
    let key = RecoveryKey::Nonce(account.clone());
    env.storage().persistent().set(&key, &nonce);
    extend_persistent_max(env, &key);
}

/// Prunes timestamps older than `RATE_WINDOW_SECS`, panics
/// `RateLimited` if `>= RATE_LIMIT_MAX` remain, otherwise appends `now` and
/// persists.
fn check_rate_limit(env: &Env, account: &Address, now: u64) {
    let key = RecoveryKey::RateWindow(account.clone());
    let window: SorobanVec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| SorobanVec::new(env));

    let cutoff = now.saturating_sub(RATE_WINDOW_SECS);
    let mut pruned: SorobanVec<u64> = SorobanVec::new(env);
    for ts in window.iter() {
        if ts >= cutoff {
            pruned.push_back(ts);
        }
    }
    if pruned.len() >= RATE_LIMIT_MAX {
        panic_with_error!(env, RecoveryError::RateLimited);
    }
    pruned.push_back(now);
    env.storage().persistent().set(&key, &pruned);
    extend_persistent_max(env, &key);
}

/// `root(32) || nullifier(32) || auth_hash(32)`, the UltraHonk verifier's
/// expected `public_inputs` encoding for this circuit.
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

/// Cross-calls `verifier.verify_proof(public_inputs, proof)` (pattern:
/// `../zk/rs-soroban-ultrahonk/tornado_classic/contracts/src/mixer.rs:87-99`).
/// `try_invoke_contract` is used (not a typed client) so a verifier-side
/// panic/error surfaces as an `Err` here instead of aborting this contract's
/// whole invocation before we can map it to `RecoveryError::VerificationFailed`.
fn verify_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: Bytes,
    proof: Bytes,
) -> Result<(), ()> {
    let mut args: SorobanVec<Val> = SorobanVec::new(env);
    args.push_back(public_inputs.into_val(env));
    args.push_back(proof.into_val(env));
    env.try_invoke_contract::<(), InvokeError>(verifier, &Symbol::new(env, "verify_proof"), args)
        .map_err(|_| ())?
        .map_err(|_| ())
}

#[contractimpl]
impl ZkRecovery {
    /// Starts a timelocked recovery for `account` (spec §3.3, ordered
    /// checks). Permissionless -- no `require_auth`. Returns
    /// `executable_after`.
    #[allow(clippy::too_many_arguments)]
    pub fn initiate_recovery(
        env: Env,
        account: Address,
        new_pubkey: BytesN<65>,
        nonce: u64,
        timelock_secs: u32,
        root: BytesN<32>,
        nullifier: BytesN<32>,
        proof: Bytes,
    ) -> u64 {
        let cfg = config(&env);
        let now = env.ledger().timestamp();

        // 1. No live pending -- a pending past its `expires_at` is
        // stale/supersedable, not blocking. Superseding a stale pending must
        // also release its nullifier reservation: `N = Poseidon2(DOM_NULL,
        // account, secret)` is deterministic per (account, secret) with no
        // nonce, so without this release the next `initiate_recovery` for
        // this account would recompute the SAME `N`, find it still
        // `Reserved` in step 3 below, and panic `NullifierReserved` --
        // permanently bricking recovery for the account after any single
        // expired attempt. Only release on the STALE path (a LIVE pending
        // still panics `PendingExists`, unchanged), and only when the
        // reservation is still `Reserved(account)` -- a `Spent` nullifier
        // (already permanently consumed by a completion) is deliberately
        // left untouched.
        let pending_key = RecoveryKey::Pending(account.clone());
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<_, PendingRecovery>(&pending_key)
        {
            if now < existing.expires_at {
                panic_with_error!(&env, RecoveryError::PendingExists);
            }
            let existing_nullifier_key = RecoveryKey::Nullifier(existing.nullifier.clone());
            if let Some(NullifierState::Reserved(reserved_for)) =
                env.storage()
                    .persistent()
                    .get::<_, NullifierState>(&existing_nullifier_key)
            {
                if reserved_for == account {
                    env.storage().persistent().remove(&existing_nullifier_key);
                }
            }
        }

        // 2. `root` must be a currently-known Merkle root.
        if !is_known_root(&env, &root) {
            panic_with_error!(&env, RecoveryError::UnknownRoot);
        }

        // 3. `nullifier` must not already be reserved or spent.
        let nullifier_key = RecoveryKey::Nullifier(nullifier.clone());
        if let Some(state) = env
            .storage()
            .persistent()
            .get::<_, NullifierState>(&nullifier_key)
        {
            match state {
                NullifierState::Reserved(_) => {
                    panic_with_error!(&env, RecoveryError::NullifierReserved)
                }
                NullifierState::Spent => panic_with_error!(&env, RecoveryError::NullifierSpent),
            }
        }

        // 4. `nonce` must be exactly one past the stored value; bump it.
        let expected_nonce = stored_nonce(&env, &account) + 1;
        if nonce != expected_nonce {
            panic_with_error!(&env, RecoveryError::InvalidNonce);
        }
        bump_nonce(&env, &account, nonce);

        // 5. `timelock_secs` must meet the floor and match the configured
        // delay exactly.
        if (timelock_secs as u64) < cfg.timelock_floor_secs {
            panic_with_error!(&env, RecoveryError::TimelockTooShort);
        }
        if (timelock_secs as u64) != cfg.delay_secs {
            panic_with_error!(&env, RecoveryError::TimelockMismatch);
        }

        // 6. Rate limit: <= 3 initiations per rolling 90-day window.
        check_rate_limit(&env, &account, now);

        // 7. Recompute auth_hash from THIS call's own arguments (not
        // trusted from the caller) and verify the real proof against it --
        // this is what binds the proof to these exact arguments.
        let expected_auth_hash = compute_auth_hash(
            &env,
            ACTION_INITIATE,
            &account,
            &cfg.network_passphrase,
            &env.current_contract_address(),
            &new_pubkey,
            nonce,
            timelock_secs,
        );
        let public_inputs = assemble_public_inputs(&env, &root, &nullifier, &expected_auth_hash);
        if verify_proof(&env, &cfg.verifier, public_inputs, proof).is_err() {
            panic_with_error!(&env, RecoveryError::VerificationFailed);
        }

        // 8. Reserve the nullifier and store the pending record.
        env.storage()
            .persistent()
            .set(&nullifier_key, &NullifierState::Reserved(account.clone()));
        extend_persistent_max(&env, &nullifier_key);

        let executable_after = now + cfg.delay_secs;
        let expires_at = executable_after + cfg.completion_window_secs;
        let pending = PendingRecovery {
            new_pubkey: new_pubkey.clone(),
            nullifier,
            initiated_at: now,
            executable_after,
            expires_at,
        };
        env.storage().persistent().set(&pending_key, &pending);
        extend_persistent_max(&env, &pending_key);

        let new_pubkey_hash = env
            .crypto()
            .sha256(&Bytes::from_array(&env, &new_pubkey.to_array()))
            .to_bytes();
        RecoveryInitiated {
            account: &account,
            new_pubkey_hash: &new_pubkey_hash,
            executable_after: &executable_after,
        }
        .publish(&env);

        // 9. Return `executable_after`.
        executable_after
    }

    /// View: the live-or-stale pending recovery record for `account`, if
    /// any. Callers wanting strictly-live semantics should compare
    /// `expires_at` against the current ledger timestamp themselves.
    pub fn get_pending(env: Env, account: Address) -> Option<PendingRecovery> {
        env.storage()
            .persistent()
            .get(&RecoveryKey::Pending(account))
    }

    /// View: the next nonce `initiate_recovery` will accept for `account`.
    pub fn next_nonce(env: Env, account: Address) -> u64 {
        stored_nonce(&env, &account) + 1
    }
}
