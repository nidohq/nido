//! Wire types this account cross-calls against. They are copied by hand, not
//! imported, because every one of these lives in a separately deployed
//! `#[contract]` crate. Depending on these from the crates directly would compile its
//! `#[contract]`-annotated code straight into this account's own wasm
//! build, colliding both crates' exported entry-point symbols
//! (`__constructor`, `install`, `enforce`, …) at link time. This is a mechanical
//! constraint of Soroban's contract macros, unrelated to which team or
//! repo the other contract lives in. `#[contractclient]` (in `doc.rs`/
//! `contract.rs`) solves the function-call half of this by generating a
//! caller-only stub with no exported symbols; the types below are the
//! other half — concrete Rust shapes the compiler needs to encode/decode
//! values against those stubs, kept in sync by hand.
//!
//! Naming convention: Compiled* are from perch's compiler
//!
//! Two groups of mirrored types, matching two different contracts:
//!
//! - **Perch's compiler output** (`DocCompilerError` through
//!   `CompiledZkVerifierConfig`) — transcribed from the DEPLOYED wasm's
//!   actual interface (`stellar contract fetch` + `stellar contract info
//!   interface`), NOT from perch's source, because the two can drift: this
//!   pattern was adopted after the ORIGINAL testnet compiler (wasm
//!   `3645bd0d…` — long since superseded; see `doc.rs` for the current
//!   pin) predated perch's cap-lowering (#54) — its `CompiledRule` had
//!   FIVE fields (no `cap`), while consuming the `perch-doc-compiler`
//!   CRATE at a source rev gave SIX-field types and made every live
//!   `apply_doc` trap with `Error(Object, UnexpectedSize)` decoding the
//!   compiler's return. The fixtures under
//!   `crates/integration-tests/fixtures/perch/` are the actual fetched
//!   bytes, sha256-pinned to the hashes in `doc.rs`, so a type/artifact
//!   skew fails locally instead of live.
//! - **Nido's own `recovery-controller`** (`AuthMode`, `Profile`,
//!   `RecoveryConfig`) mirrors that crate's native argument type for
//!   `enroll`, not perch's schema. No version-drift risk here (nido builds
//!   and deploys both crates together), but the same wasm-linking
//!   constraint above still applies, so the type is copied, not imported.

use soroban_sdk::{contracttype, Address, Bytes, BytesN, String, Val, Vec};
use stellar_accounts::smart_account::Signer;

// --- Perch's compiler output --------------------------------------------

/// Everything the deployed compiler can refuse (its exact error spec).
#[soroban_sdk_tools::scerr]
pub enum DocCompilerError {
    /// The submitted document bytes are not UTF-8.
    DocNotUtf8,
    /// The document failed fail-closed parsing.
    DocParse,
    /// The document failed semantic validation.
    DocInvalid,
    /// The document names no network, or one that is not this chain.
    WrongNetwork,
    /// The document cannot be lowered to rules.
    DocCompile,
}

/// Where a compiled rule applies (deployed spec).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RuleScope {
    SelfAdmin,
    Contract(Address),
}

/// A cumulative spend cap (deployed 0.2.1 spec), lowered onto OZ
/// `SpendingLimitAccountParams` at install time.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledCap {
    pub period_ledgers: u32,
    pub spending_limit: i128,
}

/// One compiled rule, as the deployed 0.2.1 compiler returns it — six
/// fields including `cap`. `install` is deliberately `Vec<Val>` rather than
/// a mirrored `InstallParams`: this account only passes the value through
/// to the interpreter's policy-install map, so the raw `Val` avoids
/// mirroring the interpreter's whole program type surface.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledRule {
    pub cap: Vec<CompiledCap>,
    pub install: Vec<Val>,
    pub name: String,
    pub scope: RuleScope,
    pub signers: Vec<Signer>,
    pub valid_until: Option<u32>,
}

/// A compiled document (deployed spec).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledDoc {
    pub doc_hash: BytesN<32>,
    pub rules: Vec<CompiledRule>,
    pub recovery: Vec<CompiledRecoveryConfig>,
}

// Wire form of [`perch_ir::RecoveryConfig`]: resolved addresses and decoded
/// bytes, exactly as [`CompiledRule`] is to [`perch_ir::Rule`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledRecoveryConfig {
    pub profile: RecoveryProfile,
    pub mode: CompiledRecoveryMode,
    pub controller: Address,
    /// `Some` ⇒ suspected-compromise recovery is enrolled, restoring the
    /// document this hash names. A plain `Option`, unlike
    /// [`CompiledRule::install`]/`cap`/[`CompiledDoc::recovery`] above:
    /// `BytesN<32>` is a host-builtin type (its own direct `ScVal`
    /// conversion), not a `#[contracttype]` struct, so the derive-macro
    /// limitation those fields work around doesn't apply here.
    pub baseline: Option<BytesN<32>>,
    /// Fingerprint of each replaceable signer's *physical credential*
    /// (`sha256` of a tagged encoding of its `SignerMethod` — verifier+key for
    /// `external`, the address for `delegated`), resolved from
    /// `doc.signers` at compile time — not the document-local signer id
    /// string. Revocation must survive the id being reused for a different
    /// physical key in a later document, so the controller tracks the
    /// credential itself.
    pub replaceable: Vec<BytesN<32>>,
    pub delay_ledgers: u32,
    pub expiry_ledgers: u32,
    pub max_cancels: u32,
    pub pending_activity: CompiledPendingActivityPolicy,
}

/// Wire form of [`perch_ir::RecoveryProfile`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RecoveryProfile {
    Loss,
    Protected,
}

/// Wire form of [`perch_ir::PendingActivityPolicy`]. No default, same as the
/// document-level type — see its doc comment.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CompiledPendingActivityPolicy {
    Freeze,
    Continue,
}

/// Wire form of [`perch_ir::RecoveryMode`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum CompiledRecoveryMode {
    GuardianOnly(CompiledGuardianSet),
    ZkOnly(CompiledZkVerifierConfig),
    Combined(CompiledGuardianSet, CompiledZkVerifierConfig),
}

/// Wire form of [`perch_ir::GuardianSet`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledGuardianSet {
    pub guardians: Vec<Address>,
    pub quorum: u32,
}

/// Wire form of [`perch_ir::ZkVerifierConfig`].
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledZkVerifierConfig {
    pub verifier: Address,
    /// Decoded from the document's hex `circuit-id`.
    pub circuit_id: Bytes,
    /// A membership-pool contract's address, for ZK schemes that prove
    /// knowledge of one fixed secret against a set the pool contract tracks;
    /// `None` for schemes with no pool. `Address` is a host-builtin type, so
    /// (unlike [`CompiledRule::install`]/`cap`) a plain `Option` works here.
    pub pool: Option<Address>,
}

// --- Nido's recovery-controller wire types---
// See contracts/recovery-controller/src/types.rs
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthMode {
    GuardianOnly,
    ZkOnly,
    Combined,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Profile {
    Loss,
    Protected,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PendingActivityPolicy {
    Freeze,
    Continue,
    Restrict,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecoveryConfig {
    pub mode: AuthMode,
    pub profile: Profile,
    pub guardians: Vec<Address>,
    pub guardian_threshold: u32,
    pub verifier: Option<Address>,
    pub zk_pool: Option<Address>,
    pub network_passphrase: Bytes,
    pub baseline_doc_hash: BytesN<32>,
    pub delay_secs: u64,
    pub expiry_secs: u64,
    pub max_cancels: u32,
    pub version: u32,
    pub pending_activity_policy: PendingActivityPolicy,
}
