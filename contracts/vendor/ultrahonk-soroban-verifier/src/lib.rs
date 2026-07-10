#![cfg_attr(not(feature = "std"), no_std)]
// DELIBERATE, REVIEWED EXCEPTION to "never hand-edit contracts/vendor/
// ultrahonk-soroban-verifier/src/ -- see ../CHECKSUMS.sha256 +
// scripts/check-vendor-drift.sh at the repo root, which checksum-guard this
// tree against drift/hand-edits":
//
// nido's `just check` gate runs `cargo clippy --all --tests --
// -Dclippy::pedantic`, which flags ~130 purely-stylistic findings across
// this vendored tree (missing `#[must_use]`, doc-comment backticks,
// `#[inline(always)]` advice, etc.) -- upstream's own style choices, not a
// nido regression. "Fixing" them would mean silently hand-editing vendored,
// unaudited third-party code, exactly what the checksum guard exists to
// prevent.
//
// Excluding this crate from clippy's sweep does NOT work: `cargo clippy`
// sets `RUSTC_WORKSPACE_WRAPPER=clippy-driver` for the whole workspace, so
// it re-lints every workspace member (this crate included) with the
// caller's `-D` flags whenever ANY dependent (nido-zk-verifier) is
// clippy-checked, regardless of `--exclude`/`-p`. A Cargo.toml `[lints]`
// table doesn't help either -- it only becomes another command-line lint
// flag, and the command-line flags's ordering (extra `cargo clippy --
// args` are appended after Cargo's own `[lints]`-derived flags) means the
// caller's `-D clippy::pedantic` still wins. Only a genuine in-source
// attribute is more specific than any command-line lint flag, hence this
// one deliberate, reviewed, single-line exception (see the commit that
// added this line for the accompanying, minimal CHECKSUMS.sha256 update --
// it covers only this line).
#![allow(clippy::pedantic)]

#[cfg(not(feature = "std"))]
extern crate alloc;

pub mod debug;
pub mod ec;
pub mod field;
pub mod hash;
pub mod relations;
pub mod shplemini;
pub mod sumcheck;
pub mod transcript;
pub mod types;
pub mod utils;
pub mod verifier;
// Proof size is dynamic based on log_n — use utils::expected_proof_fields(log_n)

pub use ec::{EcOps, SorobanEc};
pub use verifier::UltraHonkVerifier;

#[cfg(feature = "std")]
pub use ec::ArkEc;
