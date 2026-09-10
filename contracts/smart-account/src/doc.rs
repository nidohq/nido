//! SPIKE: perch `apply_doc` for the nido smart account — HYBRID-additive.
//!
//! One entry point (`apply_doc` in `contract.rs`, delegating here) accepts a
//! perch policy document's JSON bytes, cross-calls perch's shared stateless
//! doc-compiler contract to parse/validate/network-bind/lower it, and applies
//! the compiled context rules to this account:
//!
//! - **Hybrid, not doc-only.** Upstream perch (`perch-smart-account`'s
//!   `PerchSmartAccount::apply_doc`) replaces the ENTIRE rule set and hides
//!   OZ's piecemeal mutation surface, so a doc is the sole write path. Nido
//!   deliberately does NOT do that here: this module only manages the rules
//!   IT installed (tracked in `DOC_RIDS`), diffing old-doc-rules out and
//!   new-doc-rules in atomically, while the constructor's default passkey
//!   rule, the zk-recovery rule, session-key rules, and every existing
//!   mutator (`add_signer`, `add_context_rule`, …) stay exactly as they are.
//!   Whether `apply_doc` should BECOME the sole write path is an explicitly
//!   deferred decision — see the PR description.
//! - **Anti-brick by construction.** Upstream's `AdminLockout` check exists
//!   because a doc-only account's admin path comes from the doc itself. In
//!   hybrid mode the default passkey rule survives every apply untouched, so
//!   the account always keeps its non-doc auth path and the check is moot.
//! - **Persistence.** The canonical `doc_hash` (sha256 of the doc's canonical
//!   JSON, computed by the compiler) is stored in instance storage, and the
//!   full submitted doc JSON is emitted as a `DocApplied` event, so the SDK
//!   can recover the document from event history and verify it against the
//!   stored hash (`readPolicy` tiers a/b).
//!
//! The `perch-smart-account` trait crate itself is NOT consumed: it is
//! unpublished, unbuildable as a git dependency (it bakes git-ignored fetched
//! wasm artifacts at build time via `include_str!`/`registry_contract!`), its
//! default `apply_doc` has doc-only wipe-everything semantics, and its
//! storage/install helpers are private. This module mirrors the trait's
//! surface (`apply_doc`, `applied_doc_hash`) and its install shape at the
//! wire level instead — the `CompiledDoc`/`CompiledRule` protocol via the
//! real `perch-doc-compiler` client — which is the part of perch that is
//! actually consumable today.

use perch_doc_compiler::{
    CompiledDoc, CompiledRule, DocCompilerClient, DocCompilerError, RuleScope,
};
use soroban_sdk::{
    contractevent, symbol_short, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};
use stellar_accounts::smart_account::{
    add_context_rule, remove_context_rule, ContextRule, ContextRuleType, SmartAccountStorageKey,
};

use crate::contract::NidoSmartAccountError;

/// Perch's content-addressed "stateless" subregistry on testnet — the
/// deployer of every canonical perch contract instance. Same pin as the SDK's
/// `PERCH_STATELESS_REGISTRY_TESTNET` (`policyDoc/deployment.ts`) and
/// DEPLOYED.md "Perch canonical deployment".
pub const PERCH_STATELESS_REGISTRY: &str =
    "CC6ELNH6YVRRO4WIETIURY3PZLD7NHSDXHRMTJQUT7D733SYVQFYB26O";

/// sha256 of the pinned `perch-doc-compiler` wasm (perch rev `f5676a6`,
/// published to the stateless subregistry). Hex:
/// `3645bd0de34f4896c5e6fd8ca141713eb9f8658728bf16d82026418d4ab0b27f`.
pub const PERCH_DOC_COMPILER_WASM_HASH: [u8; 32] = [
    0x36, 0x45, 0xbd, 0x0d, 0xe3, 0x4f, 0x48, 0x96, 0xc5, 0xe6, 0xfd, 0x8c, 0xa1, 0x41, 0x71, 0x3e,
    0xb9, 0xf8, 0x65, 0x87, 0x28, 0xbf, 0x16, 0xd8, 0x20, 0x26, 0x41, 0x8d, 0x4a, 0xb0, 0xb2, 0x7f,
];

/// sha256 of the pinned `perch-interpreter` wasm (perch-interpreter 0.1.2,
/// perch rev `f5676a6`) — the SAME pin as the SDK's
/// `PERCH_WASM_HASHES.interpreter`. Hex:
/// `f8320d3031e7dffe51fac14177c5353b8818f8e6df3bda6c4c1b714f5ce1d858`.
pub const PERCH_INTERPRETER_WASM_HASH: [u8; 32] = [
    0xf8, 0x32, 0x0d, 0x30, 0x31, 0xe7, 0xdf, 0xfe, 0x51, 0xfa, 0xc1, 0x41, 0x77, 0xc5, 0x35, 0x3b,
    0x88, 0x18, 0xf8, 0xe6, 0xdf, 0x3b, 0xda, 0x6c, 0x4c, 0x1b, 0x71, 0x4f, 0x5c, 0xe1, 0xd8, 0x58,
];

/// Instance storage key for the canonical `doc_hash` of the currently
/// applied policy document. Absent until the first successful `apply_doc`.
const DOC_HASH: Symbol = symbol_short!("DOC_HASH");

/// Instance storage key for the `Vec<u32>` of context-rule ids the LAST
/// successful `apply_doc` installed — the exact set the next apply diffs
/// out. Never contains the default rule, the recovery rule, or any rule
/// installed through the legacy mutators.
const DOC_RIDS: Symbol = symbol_short!("DOC_RIDS");

/// Emitted once per successful `apply_doc`: the canonical `doc_hash` (topic,
/// so indexers can filter by document identity) plus the FULL submitted doc
/// JSON (data), so the document is recoverable from event history alone. The
/// SDK verifies a recovered doc by canonicalizing it client-side and
/// comparing sha256 against the STORED hash — formatting of the submitted
/// bytes therefore doesn't matter, though `buildApplyDocTx` submits canonical
/// bytes so the event carries the canonical form in practice.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DocApplied {
    #[topic]
    pub doc_hash: BytesN<32>,
    pub doc_json: Bytes,
}

/// `deployer(stateless_registry, wasm_hash)` under the current network id —
/// the same pure derivation perch consumers use (`perch-registry-resolve`'s
/// pinned mode; the SDK's `derivePerchContractId`). Pinned, never
/// admin-supplied: a registry republish cannot change which compiler or
/// interpreter a deployed account trusts.
fn derived_infra_address(e: &Env, wasm_hash: &[u8; 32]) -> Address {
    let registry = Address::from_str(e, PERCH_STATELESS_REGISTRY);
    let salt = BytesN::from_array(e, wasm_hash);
    e.deployer().with_address(registry, salt).deployed_address()
}

/// The pinned perch doc-compiler's derived address on this network.
#[must_use]
pub fn compiler_address(e: &Env) -> Address {
    derived_infra_address(e, &PERCH_DOC_COMPILER_WASM_HASH)
}

/// The pinned perch interpreter's derived address on this network.
#[must_use]
pub fn interpreter_address(e: &Env) -> Address {
    derived_infra_address(e, &PERCH_INTERPRETER_WASM_HASH)
}

/// The canonical `doc_hash` of the currently applied policy document, or
/// `None` if no document has ever been applied. Mirrors
/// `PerchSmartAccount::applied_doc_hash` so anyone can check
/// installed == reviewed.
#[must_use]
pub fn applied_doc_hash(e: &Env) -> Option<BytesN<32>> {
    e.storage().instance().get(&DOC_HASH)
}

/// The context-rule ids installed by the last successful `apply_doc` (empty
/// if none). The SDK's `readPolicy` uses this to scope its doc-vs-chain
/// parity check to doc-managed rules only.
#[must_use]
pub fn doc_rule_ids(e: &Env) -> Vec<u32> {
    e.storage()
        .instance()
        .get(&DOC_RIDS)
        .unwrap_or_else(|| Vec::new(e))
}

/// Flatten the compiler's typed refusals into this contract's error space
/// (nido uses plain `#[contracterror]`, not perch's scerr composition, so the
/// mapping is spelled out).
fn compiler_error(err: DocCompilerError) -> NidoSmartAccountError {
    match err {
        DocCompilerError::DocNotUtf8 => NidoSmartAccountError::DocNotUtf8,
        DocCompilerError::DocParse => NidoSmartAccountError::DocParse,
        DocCompilerError::DocInvalid => NidoSmartAccountError::DocInvalid,
        DocCompilerError::WrongNetwork => NidoSmartAccountError::DocWrongNetwork,
        DocCompilerError::DocCompile => NidoSmartAccountError::DocCompile,
    }
}

/// The `apply_doc` body (auth + recovery-pending guard already done by the
/// entry point in `contract.rs`). One invocation, all-or-nothing: any error
/// return or panic unwinds every storage change, so there is never an
/// observable half-migrated rule set.
///
/// # Errors
///
/// `DocNotUtf8`/`DocParse`/`DocInvalid`/`DocWrongNetwork`/`DocCompile` relay
/// the compiler's typed refusals; `DocCompilerUnreachable` is the fail-closed
/// fallback when the cross-call itself fails; `DocCapUnsupported` refuses
/// capped documents (see the comment at the check).
pub fn apply(e: &Env, doc_json: &Bytes) -> Result<BytesN<32>, NidoSmartAccountError> {
    // Stateless compile: parse, validate, network-bind, canonicalize + hash,
    // lower. Every compiler refusal surfaces as a typed error.
    let compiled: CompiledDoc =
        match DocCompilerClient::new(e, &compiler_address(e)).try_compile_doc(doc_json) {
            Ok(Ok(c)) => c,
            Err(Ok(ce)) => return Err(compiler_error(ce)),
            // Conversion failure or host trap: the compiler is missing at the
            // derived address or misbehaving. Fail closed.
            _ => return Err(NidoSmartAccountError::DocCompilerUnreachable),
        };

    // Cumulative caps lower onto a stateful spending-limit policy. Upstream
    // perch attaches ITS content-addressed `perch-spending-limit`; nido's SDK
    // lowers caps onto nido's OWN stock spending-limit policy, whose address
    // is registry-resolved — not derivable here. Rather than silently
    // installing a capped rule WITHOUT its cap (strictly weaker than what the
    // reviewer approved), refuse; capped docs keep using the SDK's per-rule
    // `buildDocInstallTxs` path. Folding caps in is a noted spike gap.
    for rule in compiled.rules.iter() {
        if !rule.cap.is_empty() {
            return Err(NidoSmartAccountError::DocCapUnsupported);
        }
    }

    // Diff out the previous doc's rules — and ONLY those. A doc rule already
    // removed through the legacy mutators since the last apply is skipped
    // (the diff self-heals rather than trapping on a missing id).
    let previous = doc_rule_ids(e);
    for id in previous.iter() {
        if e.storage()
            .persistent()
            .has(&SmartAccountStorageKey::ContextRuleData(id))
        {
            remove_context_rule(e, id);
        }
    }

    // Install the new doc's rules and record their ids as the new diff base.
    let interpreter = interpreter_address(e);
    let mut installed: Vec<u32> = Vec::new(e);
    for rule in compiled.rules.iter() {
        installed.push_back(install_rule(e, &interpreter, &rule).id);
    }

    e.storage().instance().set(&DOC_RIDS, &installed);
    e.storage().instance().set(&DOC_HASH, &compiled.doc_hash);
    DocApplied {
        doc_hash: compiled.doc_hash.clone(),
        doc_json: doc_json.clone(),
    }
    .publish(e);
    Ok(compiled.doc_hash)
}

/// Map one compiled rule onto OZ storage via the same library call the
/// legacy `add_context_rule` entry point uses (and `__check_auth` evaluates
/// against). Mirrors upstream `perch-smart-account::install_rule`, minus the
/// cap branch (refused above).
fn install_rule(e: &Env, interpreter: &Address, rule: &CompiledRule) -> ContextRule {
    let scope = match &rule.scope {
        RuleScope::SelfAdmin => ContextRuleType::CallContract(e.current_contract_address()),
        RuleScope::Contract(addr) => ContextRuleType::CallContract(addr.clone()),
    };
    let mut policies: Map<Address, Val> = Map::new(e);
    if let Some(install) = rule.install.first() {
        policies.set(interpreter.clone(), install.into_val(e));
    }
    add_context_rule(
        e,
        &scope,
        &rule.name,
        rule.valid_until,
        &rule.signers,
        &policies,
    )
}
