//! Shared setup for Stage 3 (`firstmate/data/perch-zk-recovery-scout-p5/follow-up.md`
//! §8; `contracts/recovery-controller`) integration tests. Builds directly on
//! `recovery_stage2_common.rs`'s real-account + real-doc-pipeline setup and
//! `SorobanAuthorizationEntry` builder — completion is still Variant A
//! (gating the account's EXISTING `apply_doc`), just via the mode-dispatching
//! `RecoveryController` instead of Stage 2's single-authority
//! `DocRecoveryCompletion`.
#![allow(dead_code)]

use nido_integration_tests::{
    deploy_smart_account_with_recovery, SmartAccountClient, PERCH_DOC_COMPILER_WASM,
    PERCH_INTERPRETER_WASM, SPENDING_LIMIT_POLICY_WASM,
};
use nido_recovery_controller::types::{AuthMode, PendingActivityPolicy, Profile, RecoveryConfig};
use nido_recovery_controller::{RecoveryController, RecoveryControllerClient};
use nido_smart_account::doc::{compiler_address, interpreter_address, NIDO_SPENDING_LIMIT_POLICY};
use p256::ecdsa::SigningKey;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::{
    InvokeContractArgs, ScAddress, ScSymbol, ScVal, SorobanAddressCredentials,
    SorobanAuthorizationEntry, SorobanAuthorizedFunction, SorobanAuthorizedInvocation,
    SorobanCredentials, VecM,
};
use soroban_sdk::{Address, Bytes, BytesN, Env, IntoVal, Map, TryFromVal, Val, Vec as SVec};
use stellar_accounts::smart_account::AuthPayload;

pub use crate::recovery_stage2_common::{
    addr_str, admin_doc, admin_lockout_doc, bind_testnet, canonical_doc_hash, canonicalize,
    hex_lower, TESTNET_PASSPHRASE,
};

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

pub struct GuardianOnlySetup<'a> {
    pub account: SmartAccountClient<'a>,
    pub account_addr: Address,
    pub verifier_addr: Address,
    pub signing_key: SigningKey,
    pub controller: RecoveryControllerClient<'a>,
    pub controller_addr: Address,
    pub guardians: SVec<Address>,
    pub threshold: u32,
    pub recovery_rule_id: u32,
    pub baseline_doc_hash: BytesN<32>,
}

/// Deploys a real smart account (constructor-installed recovery rule
/// pointing at a fresh `RecoveryController`), binds testnet, registers the
/// real perch doc-compiler/interpreter/spending-limit infra, and enrolls a
/// `GuardianOnly`/`Loss` config with `n` guardians and the given `threshold`
/// (follow-up.md §5.2 HARD requirement: no verifier/pool configured at all).
#[must_use]
pub fn setup_guardian_only(
    env: &Env,
    n: u32,
    threshold: u32,
    baseline_doc_hash: BytesN<32>,
) -> GuardianOnlySetup<'_> {
    bind_testnet(env);
    register_infra(env);

    let controller_addr = env.register(RecoveryController, ());
    let controller = RecoveryControllerClient::new(env, &controller_addr);

    env.mock_all_auths();
    let (account, account_addr, verifier_addr, signing_key) =
        deploy_smart_account_with_recovery(env, Some(&controller_addr));

    let mut guardians: SVec<Address> = SVec::new(env);
    for _ in 0..n {
        guardians.push_back(Address::generate(env));
    }

    let cfg = RecoveryConfig {
        mode: AuthMode::GuardianOnly,
        profile: Profile::Loss,
        guardians: guardians.clone(),
        guardian_threshold: threshold,
        verifier: None,
        zk_pool: None,
        network_passphrase: Bytes::from_slice(env, TESTNET_PASSPHRASE.as_bytes()),
        baseline_doc_hash: baseline_doc_hash.clone(),
        delay_secs: 1000,
        expiry_secs: 1000,
        max_cancels: 3,
        version: 1,
        pending_activity_policy: PendingActivityPolicy::Freeze,
    };
    controller.enroll(&account_addr, &cfg);

    let recovery_rule_id = account
        .recovery_rule_id()
        .expect("constructor installs the recovery rule when Some(controller) is passed");

    GuardianOnlySetup {
        account,
        account_addr,
        verifier_addr,
        signing_key,
        controller,
        controller_addr,
        guardians,
        threshold,
        recovery_rule_id,
        baseline_doc_hash,
    }
}

/// Builds a zero-signer `SorobanAuthorizationEntry` for a self-call to
/// `apply_doc` with a single `doc_json` argument, authorized via
/// `context_rule_ids = [rule_id]` and an EMPTY `AuthPayload.signers` map —
/// identical to `recovery_stage2_common::zero_signer_entry`, duplicated here
/// (rather than re-exported) since it is a small, self-contained builder and
/// Stage 3's completion vehicle is always `apply_doc` (no Variant B).
#[must_use]
pub fn zero_signer_apply_doc_entry(
    env: &Env,
    account_addr: &Address,
    doc_json: &Bytes,
    rule_id: u32,
    nonce: i64,
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
            function_name: ScSymbol("apply_doc".try_into().unwrap()),
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
            nonce,
            signature_expiration_ledger: 999_999,
            signature,
        }),
        root_invocation: invocation,
    }
}
