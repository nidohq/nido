//! Shared setup for the recovery-completion comparison written up in
//! `docs/recovery/stage2-findings.md`. `recovery_stage2_variant_a.rs`
//! (completion via the EXISTING `apply_doc`) and `recovery_stage2_variant_b.rs`
//! (completion via the dedicated `complete_recovery`) build on the SAME
//! account + `nido-recovery-doc-completion` controller + real perch
//! doc-compiler setup, differing only in which entry point the completing
//! call targets — this module holds that shared setup plus the
//! `SorobanAuthorizationEntry` builders both variant files need to drive the
//! REAL host authorization dispatch (not `mock_all_auths`, which bypasses
//! `__check_auth`/`Policy::enforce` entirely — see `deploy`'s doc comment).
//!
//! Not every helper here is used by both variant files (`cargo test` warns
//! on the unused half depending on which file is compiled) — harmless dead
//! code in a shared test-only module, not a coverage gap.
#![allow(dead_code)]

use nido_integration_tests::{
    deploy_smart_account_with_recovery, SmartAccountClient, PERCH_DOC_COMPILER_WASM,
    PERCH_INTERPRETER_WASM, SPENDING_LIMIT_POLICY_WASM,
};
use nido_recovery_doc_completion::{DocRecoveryCompletion, DocRecoveryCompletionClient};
use nido_smart_account::doc::{compiler_address, interpreter_address, NIDO_SPENDING_LIMIT_POLICY};
use p256::ecdsa::SigningKey;
use sha2::{Digest, Sha256};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::xdr::{
    InvokeContractArgs, ScAddress, ScSymbol, ScVal, SorobanAddressCredentials,
    SorobanAuthorizationEntry, SorobanAuthorizedFunction, SorobanAuthorizedInvocation,
    SorobanCredentials, VecM,
};
use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal, Map, TryFromVal, Val, Vec as SVec};
use stellar_accounts::smart_account::AuthPayload;

pub const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

/// Bind the unit env's chain to the testnet passphrase the fixture docs
/// declare (mirrors `apply_doc.rs::bind_testnet`).
pub fn bind_testnet(env: &Env) {
    let id: [u8; 32] = Sha256::digest(TESTNET_PASSPHRASE.as_bytes()).into();
    env.ledger().with_mut(|l| l.network_id = id);
}

/// Register the deployed perch compiler + interpreter at the account's
/// derived content addresses, plus nido's stock spending-limit policy —
/// mirrors `apply_doc.rs::register_infra`. Must run AFTER [`bind_testnet`].
pub fn register_infra(env: &Env) -> (Address, Address, Address) {
    let compiler = compiler_address(env);
    env.register_at(&compiler, PERCH_DOC_COMPILER_WASM, ());
    let interpreter = interpreter_address(env);
    env.register_at(&interpreter, PERCH_INTERPRETER_WASM, ());
    let spending_limit = Address::from_str(env, NIDO_SPENDING_LIMIT_POLICY);
    env.register_at(
        &spending_limit,
        SPENDING_LIMIT_POLICY_WASM,
        (Address::generate(env),),
    );
    (compiler, interpreter, spending_limit)
}

/// Soroban `Address` -> `std::string::String` (strkey) for splicing real
/// deployed addresses into fixture doc JSON (mirrors `apply_doc.rs::addr_str`).
pub fn addr_str(addr: &Address) -> String {
    let s = addr.to_string();
    let mut buf = std::vec![0u8; s.len() as usize];
    s.copy_into_slice(&mut buf);
    String::from_utf8(buf).expect("strkey is ascii")
}

pub fn hex_lower(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

/// The canonical byte form of a fixture doc — what `apply_doc`/
/// `complete_recovery` require (non-canonical submissions are refused).
pub fn canonicalize(doc_json: &str) -> String {
    perch_ir::canonical_json(&perch_ir::from_json(doc_json).expect("fixture doc parses"))
}

pub fn canonical_doc_hash(env: &Env, doc_json: &str) -> BytesN<32> {
    let digest: [u8; 32] = Sha256::digest(canonicalize(doc_json).as_bytes()).into();
    BytesN::from_array(env, &digest)
}

/// A single self-admin rule naming `key_hex` as sole owner — the target
/// document shape recovery completes to (a real key rotation via the
/// document layer, not a raw signer swap).
pub fn admin_doc(network: &str, verifier: &str, key_hex: &str) -> String {
    format!(
        r#"{{
  "version": 1,
  "network": "{network}",
  "signers": [
    {{ "id": "recovered-owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "admin",
      "scope": {{ "type": "self-admin" }},
      "principals": {{ "type": "all", "signers": ["recovered-owner"] }} }}
  ]
}}"#
    )
}

/// A syntactically valid document with NO self-admin rule. `doc::apply`
/// compiles it successfully but then refuses it at the anti-brick check
/// (`DocAdminLockout`) — i.e. it fails INSIDE the install pipeline, after
/// authorization. Committing a recovery attempt's target to this doc's hash
/// is how the atomicity tests exercise "authorized completion, failed
/// pipeline" deterministically (a required property for both completion
/// variants compared here: a failed install must not leave a spent attempt).
pub fn admin_lockout_doc(network: &str, verifier: &str, key_hex: &str, target: &str) -> String {
    format!(
        r#"{{
  "version": 1,
  "network": "{network}",
  "signers": [
    {{ "id": "recovered-owner", "verifier": "{verifier}", "key": "{key_hex}" }}
  ],
  "rules": [
    {{ "name": "pay-only",
      "scope": {{ "type": "contract", "address": "{target}" }},
      "principals": {{ "type": "all", "signers": ["recovered-owner"] }} }}
  ]
}}"#
    )
}

pub struct Setup<'a> {
    pub account: SmartAccountClient<'a>,
    pub account_addr: Address,
    pub verifier_addr: Address,
    pub signing_key: SigningKey,
    pub controller: DocRecoveryCompletionClient<'a>,
    pub controller_addr: Address,
    /// The "controlled test authenticator" address — stands in for guardian
    /// quorum / a verified ZK proof, so this comparison can isolate the
    /// completion-mechanism question from guardian/ZK evidence work (see
    /// `docs/recovery/stage2-findings.md`). `initiate`/`cancel` require its
    /// real `require_auth`.
    pub authority: Address,
    /// The zero-signer `CallContract(self)` recovery rule's id, installed at
    /// construction.
    pub recovery_rule_id: u32,
}

/// Deploys the `WebAuthn` verifier + smart account (constructor-installed
/// recovery rule pointing at a fresh `DocRecoveryCompletion` controller),
/// binds the ledger to the testnet passphrase, registers the real perch
/// doc-compiler/interpreter/spending-limit infra, and enrolls a fresh
/// authority address for the account. Does not call `initiate` — callers
/// needing a pending attempt call that themselves against
/// `setup.controller`.
///
/// Uses `env.mock_all_auths()` for this setup only. Tests that need to
/// distinguish WHICH context rule authorized a given completion call must
/// use `env.set_auths` with a hand-built `SorobanAuthorizationEntry`
/// afterwards (see [`recovery_rule_entry`]) — `mock_all_auths` bypasses the
/// account's own `__check_auth`/`Policy::enforce` entirely (it is a blanket
/// host-level "this address's authorization is satisfied" shortcut), so it
/// cannot be used to prove anything about which rule authorized a call. This
/// mirrors `zk_recovery_completion.rs`'s own setup/precision-test split.
#[must_use]
pub fn setup(env: &Env) -> Setup<'_> {
    bind_testnet(env);
    register_infra(env);

    let controller_addr = env.register(DocRecoveryCompletion, ());
    let controller = DocRecoveryCompletionClient::new(env, &controller_addr);

    env.mock_all_auths();
    let (account, account_addr, verifier_addr, signing_key) =
        deploy_smart_account_with_recovery(env, Some(&controller_addr));

    let authority = Address::generate(env);
    controller.enroll(&account_addr, &authority);

    let recovery_rule_id = account
        .recovery_rule_id()
        .expect("constructor installs the recovery rule when Some(controller) is passed");

    Setup {
        account,
        account_addr,
        verifier_addr,
        signing_key,
        controller,
        controller_addr,
        authority,
        recovery_rule_id,
    }
}

/// Builds a zero-signer `SorobanAuthorizationEntry` for a self-call to
/// `fn_name` with a single `doc_json` argument, authorized via
/// `context_rule_ids = [rule_id]` and an EMPTY `AuthPayload.signers` map —
/// mirrors `zk_recovery_completion.rs`'s `self_call_entry`. For `rule_id =
/// setup.recovery_rule_id`, this is exactly the shape the recovery
/// controller's zero-signer rule accepts (no signature needed; the attached
/// `Policy::enforce` is the entire authorization).
#[must_use]
pub fn zero_signer_entry(
    env: &Env,
    account_addr: &Address,
    fn_name: &str,
    doc_json: &Bytes,
    rule_id: u32,
) -> SorobanAuthorizationEntry {
    let args: SVec<Val> = soroban_sdk::vec![env, doc_json.into_val(env)];
    let args_scval: VecM<ScVal> = args
        .iter()
        .map(|v| ScVal::try_from_val(env, &v).unwrap())
        .collect::<std::vec::Vec<_>>()
        .try_into()
        .unwrap();

    let invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: ScAddress::from(account_addr),
            function_name: ScSymbol(fn_name.try_into().unwrap()),
            args: args_scval,
        }),
        sub_invocations: VecM::default(),
    };

    let auth_payload = AuthPayload {
        signers: Map::new(env),
        context_rule_ids: soroban_sdk::vec![env, rule_id],
    };
    let payload_val: Val = auth_payload.into_val(env);
    let signature = ScVal::try_from_val(env, &payload_val).unwrap();

    SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: ScAddress::from(account_addr),
            nonce: 0x00C0_FFEE,
            signature_expiration_ledger: 999_999,
            signature,
        }),
        root_invocation: invocation,
    }
}
