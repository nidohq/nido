//! Preauthorized-sweep policy scoping proof — the deliverable.
//!
//! Each test drives OZ's real `do_check_auth` against a production smart account
//! C (deployed from `SMART_ACCOUNT_WASM`) that has ONE sweep rule installed:
//!   - context type: `CallContract(sac)`  (pins to a single token contract)
//!   - signers:      `[External(verifier, P-256 pubkey)]`  (the sweep signer)
//!   - policies:     `[PreauthSweepPolicy { source: G }]`
//!
//! `deploy_smart_account` already creates the passkey Default rule at id 0, so
//! the sweep rule installed second lands at id 1 (see [`SWEEP_RULE_ID`]).
//!
//! The sweep signer is a real `Signer::External` (`WebAuthn`), so every
//! authorization carries a REAL P-256 signature over the `do_check_auth` auth
//! digest, verified on-chain by the `WebAuthn` verifier contract — exactly the
//! path `spending_limit_policy.rs` exercises. `mock_all_auths` is used ONLY for
//! setup ops (`add_context_rule`) and the policy's internal
//! `smart_account.require_auth()` inside `enforce`; it does NOT and cannot
//! satisfy the signer under test (the verifier's crypto check is not a
//! `require_auth`). [`forged_signature_rejected`] proves this: the same
//! perfectly-scoped sweep is REJECTED when its signature is forged, which
//! `mock_all_auths` could never have caught. The negative scoping cases below
//! therefore fail for the policy/scoping reason, never an incidental signature
//! error, because they all carry a valid signature.
//!
//! Cases: P (allowed sweep + arbitrary non-negative amounts), N1 (wrong dest),
//! N2 (wrong source), N (wrong spender), N3a (other function /
//! approve on same token), N3b (other contract entirely), forged-signature
//! rejection, bound completeness (signer in no other rule), plus an auxiliary
//! value-movement check that the SAC `transfer_from` actually moves funds
//! G -> C.

use nido_integration_tests::{
    deploy_smart_account, one_sig, session_signer, test_key, PREAUTH_SWEEP_POLICY_WASM,
};
use nido_preauth_sweep_policy::{PreauthSweepParams, SweepError};
use p256::ecdsa::SigningKey;
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    symbol_short, token, vec, Address, Bytes, Env, IntoVal, Map, String, Symbol, Val,
};
use stellar_accounts::smart_account::{do_check_auth, ContextRuleType, Signer};

/// The passkey Default rule is id 0; the sweep rule is installed second, so it
/// lands at id 1.
const SWEEP_RULE_ID: u32 = 1;

/// Deterministic-key seed for the sweep signer's P-256 key.
const SWEEP_KEY_SEED: u64 = 7;

/// Deploy the preauthorized-sweep policy contract from its wasm and return its
/// address.
fn deploy_preauth_sweep_policy(env: &Env) -> Address {
    env.register(PREAUTH_SWEEP_POLICY_WASM, ())
}

/// Build the `policies` map for `add_context_rule` with a single
/// preauth-sweep-policy install recording `source_g` as the account this rule
/// may sweep FROM.
fn preauth_sweep_install_map(
    env: &Env,
    policy_addr: &Address,
    source_g: &Address,
) -> Map<Address, Val> {
    let params = PreauthSweepParams {
        source: source_g.clone(),
    };
    let mut m: Map<Address, Val> = Map::new(env);
    m.set(policy_addr.clone(), params.into_val(env));
    m
}

/// The world: the production smart-account address C, the SAC token address the
/// rule is pinned to, the recorded onboarding source G, the real (`WebAuthn`)
/// sweep signer plus its P-256 signing key, and an unrelated attacker.
struct World {
    env: Env,
    account: Address, // C
    sac: Address,     // the token this rule is pinned to
    source_g: Address,
    sweep_key: SigningKey, // signs the auth digest for the sweep signer
    sweep_signer: Signer,  // External(verifier, sweep_key pubkey)
    attacker: Address,
}

/// Deploy account + policy and install the sweep rule scoped to `CallContract(sac)`.
fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();

    let (client, account, verifier, _passkey) = deploy_smart_account(&env);
    let sac = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let source_g = Address::generate(&env);
    let attacker = Address::generate(&env);

    let policy_addr = deploy_preauth_sweep_policy(&env);
    // A REAL External/WebAuthn signer — authentication is the verifier's
    // on-chain P-256 check, not a mocked require_auth.
    let (sweep_key, sweep_signer) = session_signer(&env, &verifier, SWEEP_KEY_SEED);

    client.add_context_rule(
        &ContextRuleType::CallContract(sac.clone()),
        &String::from_str(&env, "onboarding-sweep"),
        &None,
        &vec![&env, sweep_signer.clone()],
        &preauth_sweep_install_map(&env, &policy_addr, &source_g),
    );

    World {
        env,
        account,
        sac,
        source_g,
        sweep_key,
        sweep_signer,
        attacker,
    }
}

/// Build the auth context the host produces for
/// `SAC.transfer_from(spender, from, to, amount)`.
fn transfer_from_ctx(
    env: &Env,
    sac: &Address,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) -> Context {
    Context::Contract(ContractContext {
        contract: sac.clone(),
        fn_name: Symbol::new(env, "transfer_from"),
        args: vec![
            env,
            spender.into_val(env),
            from.into_val(env),
            to.into_val(env),
            amount.into_val(env),
        ],
    })
}

/// Build the auth context for a plain `SAC.transfer(from, to, amount)`.
fn transfer_ctx(env: &Env, sac: &Address, from: &Address, to: &Address, amount: i128) -> Context {
    Context::Contract(ContractContext {
        contract: sac.clone(),
        fn_name: symbol_short!("transfer"),
        args: vec![
            env,
            from.into_val(env),
            to.into_val(env),
            amount.into_val(env),
        ],
    })
}

/// The fixed signature payload every authorization signs over. Any 32-byte hash
/// works — `do_check_auth` binds it to the chosen rule id via the auth digest.
fn sig_payload(env: &Env) -> soroban_sdk::crypto::Hash<32> {
    env.crypto().sha256(&Bytes::from_array(env, &[0x7A_u8; 32]))
}

/// Run `do_check_auth` for a single context under the account frame, carrying a
/// REAL sweep-signer signature over the auth digest, capturing any panic so
/// negative cases can assert the specific rejection code.
fn run(world: &World, ctx: Context) -> std::thread::Result<()> {
    let env = &world.env;
    let hash = sig_payload(env);
    let auth = one_sig(
        env,
        &world.sweep_signer,
        &world.sweep_key,
        &hash,
        SWEEP_RULE_ID,
    );
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&world.account, || {
            do_check_auth(env, &hash, &auth, &vec![env, ctx]).unwrap();
        });
    }))
}

/// Extract the panic payload as a `String` (contract errors surface as
/// `Error(Contract, #N)` strings).
fn panic_message(payload: &(dyn std::any::Any + Send)) -> std::string::String {
    payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default()
}

/// Assert a caught panic carries a specific `SweepError` (`Error(Contract, #N)`).
fn assert_sweep_error(result: std::thread::Result<()>, err: SweepError, what: &str) {
    let msg = panic_message(result.expect_err(what).as_ref());
    let needle = std::format!("#{}", err as u32);
    assert!(
        msg.contains(&needle),
        "expected {err:?} (Error(Contract, {needle})) for [{what}], got: {msg}"
    );
}

/// The sweep-policy scope codes. A correctly-scoped call that is rejected must
/// NOT carry any of these — its rejection came from somewhere else (rule scope,
/// signer membership, or signature verification).
const SWEEP_SCOPE_CODES: [SweepError; 4] = [
    SweepError::WrongSpender,
    SweepError::WrongSource,
    SweepError::WrongDestination,
    SweepError::NotTransferFrom,
];

/// Assert a caught panic is the smart account's own upstream rejection (the
/// rule's `CallContract` scope refusing a foreign contract) — i.e. the
/// rejection happened UPSTREAM of the policy. Verifies it is a Contract error
/// and NOT any sweep-policy code, proving `enforce` was never reached.
fn assert_unvalidated_context(result: std::thread::Result<()>, what: &str) {
    let msg = panic_message(result.expect_err(what).as_ref());
    assert!(
        msg.contains("Error(Contract"),
        "expected a contract error for [{what}], got: {msg}"
    );
    for code in SWEEP_SCOPE_CODES {
        let sweep_needle = std::format!("#{}", code as u32);
        assert!(
            !msg.contains(&sweep_needle),
            "[{what}] should reject at the rule scope, before the policy, but got sweep code {sweep_needle}: {msg}"
        );
    }
}

// ---------------------------------------------------------------------------
// P — allowed: sweep signer authorizes transfer_from(C, G, C, amount).
// ---------------------------------------------------------------------------
#[test]
fn p_sweep_from_g_to_c_authorizes() {
    let w = setup();
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.account, 42);
    run(&w, ctx).expect("sweep transfer_from(C, G, C, amount) must be authorized");
}

// Amount is caller-chosen; any non-negative amount is allowed (the bound is on
// spender/source/dest/function, not magnitude).
#[test]
fn p_sweep_allows_arbitrary_nonnegative_amount() {
    let w = setup();
    for amt in [0_i128, 1, 1_000_000, i128::MAX] {
        let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.account, amt);
        run(&w, ctx).unwrap_or_else(|_| panic!("amount {amt} should be allowed"));
    }
}

// ---------------------------------------------------------------------------
// N1 — wrong destination: transfer_from(C, G, ATTACKER, amount) -> rejected.
// (Correct spender + source, so genuinely the `to` check.)
// ---------------------------------------------------------------------------
#[test]
fn n1_wrong_destination_rejected() {
    let w = setup();
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.attacker, 42);
    assert_sweep_error(run(&w, ctx), SweepError::WrongDestination, "N1 wrong dest");
}

// ---------------------------------------------------------------------------
// N2 — wrong source: transfer_from(C, OTHER, C, amount) -> rejected.
// (Correct spender + dest, so genuinely the `from` check.)
// ---------------------------------------------------------------------------
#[test]
fn n2_wrong_source_rejected() {
    let w = setup();
    let other = Address::generate(&w.env);
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &other, &w.account, 42);
    assert_sweep_error(run(&w, ctx), SweepError::WrongSource, "N2 wrong source");
}

// ---------------------------------------------------------------------------
// N (hardening) — wrong spender: transfer_from(ATTACKER, G, C, amount) with a
// perfect from/to but args[0] != C -> rejected by the defense-in-depth spender
// check. Proves the rule can never front C's authority for a pull initiated by
// anyone but C (relevant for a nonstandard token pinned at install).
// ---------------------------------------------------------------------------
#[test]
fn n_wrong_spender_rejected() {
    let w = setup();
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.attacker, &w.source_g, &w.account, 42);
    assert_sweep_error(run(&w, ctx), SweepError::WrongSpender, "N wrong spender");
}

// ---------------------------------------------------------------------------
// N3a — other function / self-spend: sweep signer tries a plain
// transfer(C, ATTACKER, amount) on the SAME token -> rejected by the policy
// (fn_name != transfer_from). Proves the sweep key cannot spend C's own funds.
// ---------------------------------------------------------------------------
#[test]
fn n3a_other_function_same_token_rejected() {
    let w = setup();
    let ctx = transfer_ctx(&w.env, &w.sac, &w.account, &w.attacker, 42);
    assert_sweep_error(
        run(&w, ctx),
        SweepError::NotTransferFrom,
        "N3a self-spend via transfer",
    );
}

// approve(C, ATTACKER, ...) — hand an allowance to an attacker — also rejected.
#[test]
fn n3a_approve_rejected() {
    let w = setup();
    let ctx = Context::Contract(ContractContext {
        contract: w.sac.clone(),
        fn_name: symbol_short!("approve"),
        args: vec![
            &w.env,
            w.account.into_val(&w.env),
            w.attacker.into_val(&w.env),
            1_000_000_i128.into_val(&w.env),
            1000_u32.into_val(&w.env),
        ],
    });
    assert_sweep_error(run(&w, ctx), SweepError::NotTransferFrom, "N3a approve");
}

// ---------------------------------------------------------------------------
// N3b — other contract entirely: the sweep signer tries transfer_from on a
// DIFFERENT token contract -> rejected UPSTREAM by the rule's CallContract(sac)
// scope, before the policy is ever consulted.
// ---------------------------------------------------------------------------
#[test]
fn n3b_other_contract_rejected_at_scope() {
    let w = setup();
    let other_token = Address::generate(&w.env);
    // Even a perfectly-shaped transfer_from(C, G, C) but on the WRONG contract.
    let ctx = transfer_from_ctx(
        &w.env,
        &other_token,
        &w.account,
        &w.source_g,
        &w.account,
        42,
    );
    assert_unvalidated_context(run(&w, ctx), "N3b foreign contract");
}

// ---------------------------------------------------------------------------
// Signature verification (the point of the real-auth conversion): the SAME
// perfectly-scoped sweep transfer_from(C, G, C, amount) that
// `p_sweep_from_g_to_c_authorizes` accepts is REJECTED when its signature is
// forged (signed by a different key than the one registered in the sweep
// signer). It must fail on signature/auth verification — NOT any policy scope
// code — proving these tests now verify signatures. Under the old
// `Signer::Delegated` + `mock_all_auths` setup this forgery would have been
// silently accepted.
// ---------------------------------------------------------------------------
#[test]
fn forged_signature_rejected() {
    let w = setup();
    let env = &w.env;
    let hash = sig_payload(env);
    // Same allowed call as case P — only the signature differs.
    let ctx = transfer_from_ctx(env, &w.sac, &w.account, &w.source_g, &w.account, 42);

    // Forge: sign the auth digest with a DIFFERENT key than the sweep signer's
    // registered pubkey. `one_sig` maps this signature under the real sweep
    // signer, so the WebAuthn verifier checks it against the real pubkey and
    // rejects it.
    let forged_key = test_key(SWEEP_KEY_SEED + 1);
    let forged = one_sig(env, &w.sweep_signer, &forged_key, &hash, SWEEP_RULE_ID);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&w.account, || {
            do_check_auth(env, &hash, &forged, &vec![env, ctx]).unwrap();
        });
    }));

    let msg = panic_message(
        result
            .expect_err("forged signature must be rejected")
            .as_ref(),
    );
    // The rejection is a signature/auth failure, NOT a policy-scope decision:
    // the call is perfectly scoped, so no sweep code may appear.
    for code in [
        SweepError::WrongSpender,
        SweepError::WrongSource,
        SweepError::WrongDestination,
        SweepError::NotTransferFrom,
        SweepError::NegativeAmount,
        SweepError::MalformedArgs,
    ] {
        let needle = std::format!("#{}", code as u32);
        assert!(
            !msg.contains(&needle),
            "forged signature must fail signature verification, not the policy scope; got {needle}: {msg}"
        );
    }
}

// ---------------------------------------------------------------------------
// Bound completeness: the sweep signer is a member of ONLY the sweep rule.
// Aiming the auth at the real Default/passkey rule (id 0) — which the sweep
// signer is NOT a member of — while supplying the sweep signer (with a real
// signature over rule 0) must fail.
// ---------------------------------------------------------------------------
#[test]
fn sweep_signer_belongs_to_no_other_rule() {
    let w = setup();
    let env = &w.env;
    let hash = sig_payload(env);
    // A real, well-formed signature — but bound to rule id 0, the passkey rule
    // the sweep signer is not a member of.
    let auth = one_sig(env, &w.sweep_signer, &w.sweep_key, &hash, 0u32);
    let ctx = transfer_from_ctx(env, &w.sac, &w.account, &w.source_g, &w.account, 42);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&w.account, || {
            do_check_auth(env, &hash, &auth, &vec![env, ctx]).unwrap();
        });
    }));
    assert!(
        result.is_err(),
        "sweep signer must not authorize a rule it is not a member of"
    );
}

// ---------------------------------------------------------------------------
// Auxiliary value-mechanics check for case P (NOT the scoping proof).
//
// Confirms a real SAC transfer_from(spender = C, from = G, to = C, amount)
// genuinely moves funds G -> C once C holds an allowance from G. Runs under
// mock_all_auths (bypassing do_check_auth) to prove the value movement + the
// spender/from/to argument semantics the policy is built on.
// ---------------------------------------------------------------------------
#[test]
fn p_real_sac_transfer_from_moves_g_to_c() {
    let env = Env::default();
    env.mock_all_auths();

    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = token::TokenClient::new(&env, &sac.address());
    let mint = token::StellarAssetClient::new(&env, &sac.address());

    let c = Address::generate(&env); // the smart account C (spender + dest)
    let g = Address::generate(&env); // the onboarding source G

    // Fund G with 1000 units.
    mint.mint(&g, &1000);
    assert_eq!(token.balance(&g), 1000);
    assert_eq!(token.balance(&c), 0);

    // G grants C an allowance (the "neutralized-G approves C" onboarding step).
    token.approve(&g, &c, &1000, &10_000);
    assert_eq!(token.allowance(&g, &c), 1000);

    // The sweep: C pulls G's full balance into itself.
    token.transfer_from(&c, &g, &c, &1000);

    assert_eq!(token.balance(&g), 0, "G fully swept");
    assert_eq!(token.balance(&c), 1000, "C received the funds");
    assert_eq!(token.allowance(&g, &c), 0, "allowance consumed");
}
