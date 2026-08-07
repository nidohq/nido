//! Preauthorized-sweep scoping proof — the deliverable.
//!
//! Each test drives OZ's real `do_check_auth` against a smart account C that
//! has ONE sweep rule installed:
//!   - context type: `CallContract(sac)`  (pins to a single token contract)
//!   - signers:      `[Delegated(sweep_key)]`  (the dedicated sweep signer)
//!   - policies:     `[PreauthSweepPolicy { source: G }]`
//!
//! We reuse OZ's `add_context_rule` + `do_check_auth` library fns directly (the
//! same functions the Nido smart-account contract wraps), so the account itself
//! is just the address-context the rules live under — no separate account wasm
//! needed. The sweep signer is `Signer::Delegated`, so authentication is a
//! plain `require_auth_for_args` satisfied by `mock_all_auths`; this isolates
//! the test to POLICY / rule scoping, not signature cryptography. The negative
//! cases therefore fail for the policy/scoping reason, never an incidental
//! signature error.
//!
//! Cases: P (allowed sweep), N1 (wrong dest), N2 (wrong source),
//! N3a (other function on same token), N3b (other contract entirely).

use preauth_sweep_policy::{PreauthSweepParams, PreauthSweepPolicy, SweepError};
use soroban_sdk::auth::{Context, ContractContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{
    contract, symbol_short, vec, Address, Bytes, Env, IntoVal, Map, String, Symbol, Val,
};
use stellar_accounts::smart_account::{
    add_context_rule, do_check_auth, AuthPayload, ContextRuleType, Signer,
};

const SWEEP_RULE_ID: u32 = 0; // first rule created under a fresh account.

/// Minimal stub standing in for the Nido smart account C. It carries no logic:
/// its only job is to be a REAL deployed contract so `e.storage().instance()`
/// (used by OZ's `add_context_rule`/`do_check_auth` for the rule registry)
/// exists in its frame. The auth core is exercised via the `do_check_auth`
/// library fn directly, exactly as the repo's own integration tests do.
#[contract]
pub struct StubAccount;

/// The world: a generated smart-account address C, the SAC token address, the
/// recorded onboarding source G, the sweep signer, and an unrelated attacker.
struct World {
    env: Env,
    account: Address, // C
    sac: Address,     // the token this rule is pinned to
    source_g: Address,
    sweep_signer: Signer,
    attacker: Address,
}

/// Deploy the policy and install the sweep rule under a fresh account address.
fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();

    let account = env.register(StubAccount, ()); // C — a real deployed contract
    let sac = Address::generate(&env); // a token contract address (placeholder)
    let source_g = Address::generate(&env);
    let sweep_key = Address::generate(&env);
    let attacker = Address::generate(&env);

    let policy_addr = env.register(PreauthSweepPolicy, (Address::generate(&env),));

    let sweep_signer = Signer::Delegated(sweep_key);

    // policies map: { policy_addr -> PreauthSweepParams { source: G } }
    let mut policies: Map<Address, Val> = Map::new(&env);
    policies.set(
        policy_addr.clone(),
        PreauthSweepParams { source: source_g.clone() }.into_val(&env),
    );

    // Install the rule *as* the account (its rules live in account storage).
    env.as_contract(&account, || {
        add_context_rule(
            &env,
            &ContextRuleType::CallContract(sac.clone()),
            &String::from_str(&env, "onboarding-sweep"),
            None,
            &vec![&env, sweep_signer.clone()],
            &policies,
        );
    });

    World { env, account, sac, source_g, sweep_signer, attacker }
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
        args: vec![env, from.into_val(env), to.into_val(env), amount.into_val(env)],
    })
}

/// AuthPayload naming the sweep rule and carrying the sweep signer. For a
/// Delegated signer the sig bytes are unused (auth is `require_auth_for_args`,
/// mocked), so empty bytes suffice.
fn sweep_auth(env: &Env, signer: &Signer) -> AuthPayload {
    let mut m: Map<Signer, Bytes> = Map::new(env);
    m.set(signer.clone(), Bytes::new(env));
    AuthPayload { signers: m, context_rule_ids: vec![env, SWEEP_RULE_ID] }
}

/// Run `do_check_auth` for a single context under the account frame, capturing
/// any panic so negative cases can assert the specific rejection code.
fn run(world: &World, ctx: Context) -> std::thread::Result<()> {
    let env = &world.env;
    let account = &world.account;
    let auth = sweep_auth(env, &world.sweep_signer);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.as_contract(account, || {
            do_check_auth(
                env,
                &env.crypto().sha256(&Bytes::from_array(env, &[0x7Au8; 32])),
                &auth,
                &vec![env, ctx],
            )
            .unwrap();
        });
    }))
}

/// Assert a caught panic carries a specific `SweepError` (Error(Contract, #N)).
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

/// Assert a caught panic is the smart-account's own `UnvalidatedContext`
/// (the rule's CallContract scope rejecting a foreign contract) — i.e. the
/// rejection happened UPSTREAM of the policy. Its numeric code lives in
/// stellar_accounts::smart_account::SmartAccountError.
fn assert_unvalidated_context(result: std::thread::Result<()>, what: &str) {
    let payload = result.expect_err(what);
    let msg = payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default();
    // SmartAccountError::UnvalidatedContext discriminant (see stellar-accounts
    // storage.rs). Assert it is a Contract error and NOT any SweepError code,
    // proving the policy was never reached.
    assert!(
        msg.contains("Error(Contract"),
        "expected a contract error for [{what}], got: {msg}"
    );
    for code in [
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
// source/dest/function, not magnitude).
#[test]
fn p_sweep_allows_arbitrary_nonnegative_amount() {
    let w = setup();
    for amt in [0i128, 1, 1_000_000, i128::MAX] {
        let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.account, amt);
        run(&w, ctx).unwrap_or_else(|_| panic!("amount {amt} should be allowed"));
    }
}

// ---------------------------------------------------------------------------
// N1 — wrong destination: transfer_from(C, G, ATTACKER, amount) -> rejected.
// ---------------------------------------------------------------------------
#[test]
fn n1_wrong_destination_rejected() {
    let w = setup();
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.attacker, 42);
    assert_sweep_error(run(&w, ctx), SweepError::WrongDestination, "N1 wrong dest");
}

// ---------------------------------------------------------------------------
// N2 — wrong source: transfer_from(C, OTHER, C, amount) -> rejected.
// ---------------------------------------------------------------------------
#[test]
fn n2_wrong_source_rejected() {
    let w = setup();
    let other = Address::generate(&w.env);
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &other, &w.account, 42);
    assert_sweep_error(run(&w, ctx), SweepError::WrongSource, "N2 wrong source");
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
    assert_sweep_error(run(&w, ctx), SweepError::NotTransferFrom, "N3a self-spend via transfer");
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
            1_000_000i128.into_val(&w.env),
            1000u32.into_val(&w.env),
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
    let ctx = transfer_from_ctx(&w.env, &other_token, &w.account, &w.source_g, &w.account, 42);
    assert_unvalidated_context(run(&w, ctx), "N3b foreign contract");
}

// ---------------------------------------------------------------------------
// Bound completeness: the sweep signer is a member of ONLY the sweep rule.
// Naming a different (nonexistent) rule id fails; and the passkey-style Default
// rule is intentionally absent here so there is no rule the sweep key can ride.
// ---------------------------------------------------------------------------
#[test]
fn sweep_signer_belongs_to_no_other_rule() {
    let w = setup();
    // Point the auth at rule id 1 (never created) while supplying the sweep
    // signer — must fail (no such rule / signer not in it).
    let mut m: Map<Signer, Bytes> = Map::new(&w.env);
    m.set(w.sweep_signer.clone(), Bytes::new(&w.env));
    let auth = AuthPayload { signers: m, context_rule_ids: vec![&w.env, 1u32] };
    let ctx = transfer_from_ctx(&w.env, &w.sac, &w.account, &w.source_g, &w.account, 42);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        w.env.as_contract(&w.account, || {
            do_check_auth(
                &w.env,
                &w.env.crypto().sha256(&Bytes::from_array(&w.env, &[0x01u8; 32])),
                &auth,
                &vec![&w.env, ctx],
            )
            .unwrap();
        });
    }));
    assert!(result.is_err(), "sweep signer must not authorize a rule it is not a member of");
}
