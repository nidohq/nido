//! Deterministic G-account safety decisions. No keys, crypto, clocks, storage or I/O.
//!
//! Public keys supplied as evidence MUST come from verified signatures bound to
//! the exact request. These functions do not verify signatures or execute XDR.
//! This initial authority implementation is not yet wired into a wallet/service.

pub mod authority;
