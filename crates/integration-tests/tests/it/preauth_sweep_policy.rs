//! Preauthorized-sweep policy scoping proof — the deliverable.
//!
//! Each test drives OZ's real `do_check_auth` against a production smart account
//! C (deployed from `SMART_ACCOUNT_WASM`) that has ONE sweep rule installed:
//!   - context type: `CallContract(sac)`  (pins to a single token contract)
//!   - signers:      `[Delegated(sweep_key)]`  (the dedicated sweep signer)
//!   - policies:     `[PreauthSweepPolicy { source: G }]`
//!
//! `deploy_smart_account` already creates the passkey Default rule at id 0, so
//! the sweep rule installed second lands at id 1 (see [`SWEEP_RULE_ID`]).
//!
//! The sweep signer is `Signer::Delegated`, so authentication is a plain
//! `require_auth_for_args` satisfied by `mock_all_auths`; this isolates the
//! tests to POLICY / rule scoping, not signature cryptography — the negative
//! cases therefore fail for the policy/scoping reason, never an incidental
//! signature error. (`spending_limit_policy.rs` exercises the External-signer /
//! real-WebAuthn path separately; it is orthogonal to the scoping claim here.)
//!
//! Cases: P (allowed sweep + arbitrary non-negative amounts), N1 (wrong dest),
//! N2 (wrong source), N3a (other function / approve on same token), N3b (other
//! contract entirely), the new N (wrong spender) hardening case, bound
//! completeness (signer in no other rule), plus an auxiliary value-movement
//! check that the SAC `transfer_from` actually moves funds G -> C.

use nido_integration_tests::{deploy_smart_account, PREAUTH_SWEEP_POLICY_WASM};
use nido_preauth_sweep_policy::{PreauthSweepParams, SweepError};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    symbol_short, token, vec, Address, Bytes, Env, IntoVal, Map, String, Symbol, Val,
};
use stellar_accounts::smart_account::{do_check_auth, AuthPayload, ContextRuleType, Signer};

/// The passkey Default rule is id 0; the sweep rule is installed second, so it
/// lands at id 1.
const SWEEP_RULE_ID: u32 = 1;

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
/// rule is pinned to, the recorded onboarding source G, the sweep signer, and
/// an unrelated attacker.
struct World {
    env: Env,
    account: Address, // C
    sac: Address,     // the token this rule is pinned to
    source_g: Address,
    sweep_signer: Signer,
    attacker: Address,
}

/// Deploy account + policy and install the sweep rule scoped to `CallContract(sac)`.
fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();

    let (client, account, _verifier, _passkey) = deploy_smart_account(&env);
    let sac = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let source_g = Address::generate(&env);
    let sweep_key = Address::generate(&env);
    let attacker = Address::generate(&env);

    let policy_addr = deploy_preauth_sweep_policy(&env);
    let sweep_signer = Signer::Delegated(sweep_key);

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

/// `AuthPayload` naming the given rule and carrying the sweep signer. For a
/// Delegated signer the sig bytes are unused (auth is `require_auth_for_args`,
/// mocked), so empty bytes suffice.
fn sweep_auth(env: &Env, signer: &Signer, rule_id: u32) -> AuthPayload {
    let mut m: Map<Signer, Bytes> = Map::new(env);
    m.set(signer.clone(), Bytes::new(env));
    AuthPayload {
        signers: m,
        context_rule_ids: vec![env, rule_id],
    }
}

/// Run `do_check_auth` for a single context under the account frame, capturing
/// any panic so negative cases can assert the specific rejection code.
fn run(world: &World, ctx: Context) -> std::thread::Result<()> {
    let env = &world.env;
    let auth = sweep_auth(env, &world.sweep_signer, SWEEP_RULE_ID);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(&world.account, || {
            do_check_auth(
                env,
                &env.crypto().sha256(&Bytes::from_array(env, &[0x7A_u8; 32])),
                &auth,
                &vec![env, ctx],
            )
            .unwrap();
        });
    }))
}

/// Assert a caught panic carries a specific `SweepError` (`Error(Contract, #N)`).
fn assert_sweep_error(result: std::thread::Result<()>, err: SweepError, what: &str) {
    let payload = result.expect_err(what);
    let msg = payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default();
    let needle = std::format!("#{}", err as u32);
    assert!(
        msg.contains(&needle),
        "expected {err:?} (Error(Contract, {needle})) for [{what}], got: {msg}"
    );
}

/// Assert a caught panic is the smart account's own upstream rejection (the
/// rule's `CallContract` scope refusing a foreign contract) — i.e. the
/// rejection happened UPSTREAM of the policy. Verifies it is a Contract error
/// and NOT any sweep-policy code, proving `enforce` was never reached.
fn assert_unvalidated_context(result: std::thread::Result<()>, what: &str) {
    let payload = result.expect_err(what);
    let msg = payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default();
    assert!(
        msg.contains("Error(Contract"),
        "expected a contract error for [{what}], got: {msg}"
    );
    for code in [
        SweepError::WrongSpender as u32,
        SweepError::WrongSource as u32,
        SweepError::WrongDestination as u32,
        SweepError::NotTransferFrom as u32,
    ] {
        let sweep_needle = std::format!("#{code}");
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
// Bound completeness: the sweep signer is a member of ONLY the sweep rule.
// Aiming the auth at the real Default/passkey rule (id 0) — which the sweep
// signer is NOT a member of — while supplying the sweep signer must fail.
// ---------------------------------------------------------------------------
#[test]
fn sweep_signer_belongs_to_no_other_rule() {
    let w = setup();
    // Point the auth at the Default rule id 0 (the passkey rule) while
    // supplying the sweep signer — the signer is not in it, so it must fail.
    let auth = sweep_auth(&w.env, &w.sweep_signer, 0u32);
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.account, 42);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        w.env.as_contract(&w.account, || {
            do_check_auth(
                &w.env,
                &w.env
                    .crypto()
                    .sha256(&Bytes::from_array(&w.env, &[0x01_u8; 32])),
                &auth,
                &vec![&w.env, ctx],
            )
            .unwrap();
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
