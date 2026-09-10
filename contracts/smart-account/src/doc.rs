//! SPIKE: perch `apply_doc` for the nido smart account — DOC-ONLY (the
//! captain's ruling on this spike: `apply_doc` is the sole policy write path,
//! including for the dapp).
//!
//! One entry point (`apply_doc` in `contract.rs`, delegating here) accepts a
//! perch policy document's JSON bytes, cross-calls perch's shared stateless
//! doc-compiler contract to parse/validate/network-bind/lower it, and applies
//! the compiled context rules to this account:
//!
//! - **Doc-only.** `apply_doc` atomically replaces EVERY context rule except
//!   the protected zk-recovery rule. OZ's piecemeal mutation surface is not
//!   exported (the sole survivor, `add_context_rule`, is hard-gated to the
//!   zk-recovery completion window — see `contract.rs`). The constructor's
//!   default passkey rule exists only until the first apply; from then on
//!   the document IS the policy.
//! - **Anti-brick (`DocAdminLockout`).** Re-imported from upstream perch
//!   (`ensure_admin_survives`): because the apply replaces the default rule
//!   too, the incoming rule set must contain at least one policy-free,
//!   cap-free self-admin rule with a signer, or the owner could be locked
//!   out; refused before touching anything.
//! - **Caps.** A capped doc rule attaches nido's STOCK spending-limit policy
//!   (the stateful cumulative cap the stateless interpreter cannot express)
//!   beside the interpreter, resolved from the pinned deployed address below
//!   — same audited-pin pattern as the compiler/interpreter. OZ enforces all
//!   attached policies (AND).
//! - **Persistence.** The canonical `doc_hash` (sha256 of the doc's canonical
//!   JSON, computed by the compiler) is stored in instance storage; the FULL
//!   canonical doc JSON is stored in a persistent entry (`get_applied_doc` —
//!   the lossless, no-indexer read path) AND emitted as a `DocApplied` event
//!   (the eventual recovery method). `apply_doc` refuses non-canonical byte
//!   submissions, so both copies verify against the stored hash by a bare
//!   sha256.
//!
//! The `perch-smart-account` trait crate itself is NOT consumed: it is
//! unpublished, unbuildable as a git dependency (it bakes git-ignored fetched
//! wasm artifacts at build time via `include_str!`/`registry_contract!`), and
//! its storage/install helpers are private. This module mirrors the trait's
//! surface (`apply_doc`, `applied_doc_hash`) and its install shape at the
//! wire level instead — the `CompiledDoc`/`CompiledRule` protocol via the
//! real `perch-doc-compiler` client — which is the part of perch that is
//! actually consumable today. The rule-set semantics now match upstream
//! doc-only apart from the preserved recovery rule and the completion gate.

use perch_doc_compiler::{
    CompiledDoc, CompiledRule, DocCompilerClient, DocCompilerError, RuleScope,
};
use soroban_sdk::{
    contractevent, symbol_short, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};
use stellar_accounts::policies::spending_limit::SpendingLimitAccountParams;
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

/// Nido's STOCK spending-limit policy (testnet deploy, DEPLOYED.md) — the
/// stateful cumulative-cap policy capped doc rules attach beside the
/// interpreter. Nido-owned deploys are not content-addressed, so this is a
/// pinned deployed ADDRESS rather than a derived one — the same
/// audited-constant pattern as [`PERCH_STATELESS_REGISTRY`]. The SDK's
/// `lowerDoc` lowers caps onto this same deployment, so doc-lowering parity
/// holds across the SDK and this contract.
pub const NIDO_SPENDING_LIMIT_POLICY: &str =
    "CCJMCPGADKMVKYOIZXMV7UWH62XYDAIT6GJRNJPQSZ2CHPOF4K2AU2QC";

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

/// PERSISTENT storage key for the full canonical doc JSON of the currently
/// applied policy document — the lossless on-chain copy behind
/// `get_applied_doc` (the showcase's no-indexer read path; the `DocApplied`
/// event remains the eventual recovery method).
///
/// Persistent, NOT instance, deliberately: the instance entry is loaded on
/// EVERY invocation of this account — including every `__check_auth` — so a
/// KB-scale JSON blob there would tax every transaction the account signs.
/// A persistent entry is read only when actually accessed (this view, or
/// the overwrite on re-apply), and is archivable/restorable under normal
/// rent rules. The 32-byte `doc_hash` and the small rule-id vec stay in
/// instance storage. Rent: one persistent entry of ~doc-JSON size per
/// account; this spike does not bump its TTL (noted shortcut).
const DOC_JSON: Symbol = symbol_short!("DOC_JSON");

/// Emitted once per successful `apply_doc`: the canonical `doc_hash` (topic,
/// so indexers can filter by document identity) plus the FULL doc JSON
/// (data), so the document is recoverable from event history alone. The
/// bytes are the CANONICAL form by construction (`apply_doc` refuses
/// non-canonical submissions), so a recovered doc verifies against the
/// stored hash by a bare sha256.
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

/// The full canonical doc JSON of the currently applied policy document,
/// or `None` if no document has been applied. Lossless by construction:
/// `apply_doc` refuses non-canonical submissions (`DocNotCanonical`), so
/// these bytes sha256 directly to [`applied_doc_hash`] — no client-side
/// canonicalization needed to verify.
#[must_use]
pub fn applied_doc(e: &Env) -> Option<Bytes> {
    e.storage().persistent().get(&DOC_JSON)
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
/// fallback when the cross-call itself fails; `DocNotCanonical` refuses
/// submissions that are not the canonical byte form; `DocCapUnsupported`
/// refuses capped documents (see the comments at each check).
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

    // The submitted bytes must BE the canonical form: sha256(doc_json) must
    // equal the compiler's canonical doc_hash. Perch's compiler is
    // deliberately format-agnostic (pretty and minified twins compile to the
    // same hash), but this account also STORES the bytes as the lossless
    // on-chain policy (`get_applied_doc`) and emits them in the event — so
    // canonical-only keeps one invariant everywhere: stored == emitted ==
    // canonical, and either verifies against the stored hash by a bare
    // sha256, no client-side canonicalization needed. The SDK's
    // `buildApplyDocTx` always submits canonical bytes. (A spike-flagged
    // divergence from upstream perch, easy to relax.)
    let submitted_hash = e.crypto().sha256(doc_json).to_bytes();
    if submitted_hash != compiled.doc_hash {
        return Err(NidoSmartAccountError::DocNotCanonical);
    }

    // Anti-brick (upstream perch's `ensure_admin_survives`, re-imported by
    // the doc-only ruling): the apply below replaces the default rule too,
    // so the incoming rule set must itself carry the owner's path — at
    // least one policy-free, cap-free self-admin rule with a signer. A doc
    // whose admin path depended on the interpreter (or a cap) could brick
    // the account on an interpreter refusal; refuse before touching
    // anything.
    let admin_survives = compiled.rules.iter().any(|r| {
        matches!(r.scope, RuleScope::SelfAdmin)
            && !r.signers.is_empty()
            && r.install.is_empty()
            && r.cap.is_empty()
    });
    if !admin_survives {
        return Err(NidoSmartAccountError::DocAdminLockout);
    }

    // DOC-ONLY replace: remove EVERY live rule except the protected
    // zk-recovery rule (whose lifecycle stays with the announce-then-execute
    // machinery in `contract.rs` — a document can neither remove nor mutate
    // it). One invocation — all-or-nothing; there is no observable
    // half-migrated state. This intentionally also removes the
    // constructor's default passkey rule (first apply) and any
    // post-recovery "recovered" rule the completion path installed (the new
    // owner's next apply supersedes it via the doc's admin rule).
    let recovery_rule = crate::contract::NidoSmartAccount::recovery_rule_id(e);
    let next_id: u32 = e
        .storage()
        .instance()
        .get(&SmartAccountStorageKey::NextId)
        .unwrap_or(0);
    for id in 0..next_id {
        if Some(id) != recovery_rule
            && e.storage()
                .persistent()
                .has(&SmartAccountStorageKey::ContextRuleData(id))
        {
            remove_context_rule(e, id);
        }
    }

    // Install the document's rules and record their ids (the doc-managed
    // set — everything on this account except the recovery rule).
    let interpreter = interpreter_address(e);
    let mut installed: Vec<u32> = Vec::new(e);
    for rule in compiled.rules.iter() {
        installed.push_back(install_rule(e, &interpreter, &rule).id);
    }

    e.storage().instance().set(&DOC_RIDS, &installed);
    e.storage().instance().set(&DOC_HASH, &compiled.doc_hash);
    // The lossless on-chain copy (canonical by the check above). Overwritten
    // wholesale on every apply; the event below remains the eventual
    // recovery method once an indexer exists.
    e.storage().persistent().set(&DOC_JSON, doc_json);
    DocApplied {
        doc_hash: compiled.doc_hash.clone(),
        doc_json: doc_json.clone(),
    }
    .publish(e);
    Ok(compiled.doc_hash)
}

/// Map one compiled rule onto OZ storage via the same library call
/// `__check_auth` evaluates against. Mirrors upstream
/// `perch-smart-account::install_rule`, with the cap branch attaching
/// nido's stock spending-limit deployment (pinned address) instead of
/// perch's content-addressed one. OZ enforces every attached policy (AND):
/// the interpreter's per-call program AND the rolling cap must both pass;
/// the metered token is the rule's `CallContract` scope.
fn install_rule(e: &Env, interpreter: &Address, rule: &CompiledRule) -> ContextRule {
    let scope = match &rule.scope {
        RuleScope::SelfAdmin => ContextRuleType::CallContract(e.current_contract_address()),
        RuleScope::Contract(addr) => ContextRuleType::CallContract(addr.clone()),
    };
    let mut policies: Map<Address, Val> = Map::new(e);
    if let Some(install) = rule.install.first() {
        policies.set(interpreter.clone(), install.into_val(e));
    }
    if let Some(cap) = rule.cap.first() {
        let spending_limit = Address::from_str(e, NIDO_SPENDING_LIMIT_POLICY);
        let params = SpendingLimitAccountParams {
            spending_limit: cap.spending_limit,
            period_ledgers: cap.period_ledgers,
        };
        policies.set(spending_limit, params.into_val(e));
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
