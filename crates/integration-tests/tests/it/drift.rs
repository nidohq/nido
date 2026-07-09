//! Task 11 (M2 residual): cross-crate constant drift guard.
//!
//! `ZkRecoveryInstallParams` is duplicated across
//! `contracts/zk-recovery/src/types.rs` (the real `Policy::AccountParams`
//! type, consumed by `contracts/zk-recovery/src/policy.rs`) and
//! `contracts/smart-account/src/contract.rs` (reconstructed inline -- both
//! are `#[contract]` crates and cannot Cargo-depend on each other without
//! colliding their `#[no_mangle]` exports at wasm link time; see either
//! file's doc comment). This crate is the one place BOTH real definitions
//! are simultaneously reachable, as plain `rlib` dev-dependencies (see
//! `Cargo.toml`'s notes on `nido-zk-recovery`/`nido-smart-account`) rather
//! than production dependencies, so no wasm collision applies here.
//!
//! `#[contracttype]` structs encode purely structurally on the ledger (an
//! `ScMap` keyed by sorted field-name symbols -- no nominal type tag), so a
//! fixed instance of one definition, converted to `Val`, MUST decode as the
//! other definition and compare equal. If the two structs' field
//! name/order/type ever diverge, one direction of this round trip fails to
//! decode (a `TryFromVal`/`FromVal` panic) or decodes to a mismatched value,
//! and this test fails -- exactly the drift this guard exists to catch.

use nido_smart_account::contract::ZkRecoveryInstallParams as SaInstallParams;
use nido_zk_recovery::types::ZkRecoveryInstallParams as ZkInstallParams;
use soroban_sdk::{Env, FromVal, IntoVal, Val};

#[test]
fn zk_recovery_install_params_structurally_match_across_crates() {
    let env = Env::default();

    let zk_params = ZkInstallParams { version: 1 };
    let sa_params = SaInstallParams { version: 1 };

    let zk_val: Val = zk_params.clone().into_val(&env);
    let sa_val: Val = sa_params.clone().into_val(&env);

    // zk-recovery's real type must decode as smart-account's copy.
    let zk_as_sa = SaInstallParams::from_val(&env, &zk_val);
    assert_eq!(
        zk_as_sa, sa_params,
        "nido_zk_recovery::types::ZkRecoveryInstallParams no longer decodes as \
         nido_smart_account::contract::ZkRecoveryInstallParams -- the two hand-duplicated \
         definitions have drifted apart"
    );

    // And the reverse: smart-account's inline copy must decode as
    // zk-recovery's real type.
    let sa_as_zk = ZkInstallParams::from_val(&env, &sa_val);
    assert_eq!(
        sa_as_zk, zk_params,
        "nido_smart_account::contract::ZkRecoveryInstallParams no longer decodes as \
         nido_zk_recovery::types::ZkRecoveryInstallParams -- the two hand-duplicated \
         definitions have drifted apart"
    );
}

/// `merkle::DEPTH` (spec: depth-24 incremental pool), checked from this
/// second reachable crate. Redundant with
/// `nido_zk_recovery::pool::tests::field_order_and_merkle_depth_match_canonical`'s
/// own assertion (that one is the ONLY place `FIELD_ORDER_BE` itself can be
/// checked, since it's private) -- kept here too since `DEPTH` is `pub` and
/// this file is otherwise the natural home for the `ZkRecoveryInstallParams`
/// guard above.
#[test]
fn merkle_depth_is_24() {
    assert_eq!(nido_zk_recovery::merkle::DEPTH, 24);
}
