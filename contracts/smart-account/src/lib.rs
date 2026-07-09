#![no_std]
#![allow(dead_code)]

// `pub` (not just `mod`) so `NidoSmartAccountError` (M2 Task 4's guard
// errors) is reachable as `nido_smart_account::contract::NidoSmartAccountError`
// by `nido-integration-tests`' end-to-end guard test, which depends on this
// crate as a plain `rlib` (like `nido-integration-tests` already does for
// `nido-zk-recovery`) purely to decode error codes -- NOT as a `#[contract]`
// wasm-cdylib dependency, so this does not reintroduce the
// `#[no_mangle]`-export collision this crate's own `Cargo.toml` documents
// for depending on `nido-zk-recovery`.
pub mod contract;
