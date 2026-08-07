//! Auxiliary value-mechanics check for case P (NOT the scoping proof).
//!
//! Confirms that a real Stellar Asset Contract `transfer_from(spender = C,
//! from = G, to = C, amount)` genuinely moves funds G -> C once C holds an
//! allowance from G. This runs under `mock_all_auths`, so it deliberately
//! bypasses `do_check_auth` — it proves the value movement + the
//! spender/from/to argument semantics the policy is built on, complementing
//! the authorization-scoping proof in `sweep_scoping.rs`.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

#[test]
fn p_real_sac_transfer_from_moves_g_to_c() {
    let env = Env::default();
    env.mock_all_auths();

    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let token = token::TokenClient::new(&env, &sac.address());
    let mint = token::StellarAssetClient::new(&env, &sac.address());

    let c = Address::generate(&env); // the smart account C (spender + dest)
    let g = Address::generate(&env); // the onboarding source G

    // Fund G with 1000 units.
    mint.mint(&g, &1000);
    assert_eq!(token.balance(&g), 1000);
    assert_eq!(token.balance(&c), 0);

    // G grants C an allowance (this is the "neutralized-G approves C" step that
    // the onboarding flow performs off to the side).
    token.approve(&g, &c, &1000, &10_000);
    assert_eq!(token.allowance(&g, &c), 1000);

    // The sweep: C pulls G's full balance into itself.
    token.transfer_from(&c, &g, &c, &1000);

    assert_eq!(token.balance(&g), 0, "G fully swept");
    assert_eq!(token.balance(&c), 1000, "C received the funds");
    assert_eq!(token.allowance(&g, &c), 0, "allowance consumed");
}
