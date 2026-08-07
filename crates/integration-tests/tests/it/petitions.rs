//! Wasm-level tests for `contracts/petitions`, including one REAL-auth-path
//! test that signs a petition through a deployed smart account with a
//! synthetic passkey assertion (no `mock_all_auths`) — the "bug #3" lesson:
//! mock-only suites never exercise `__check_auth`.

use nido_integration_tests::{build_contract_assertion, compute_auth_digest, deploy_smart_account};
use soroban_sdk::xdr::ToXdr as _;
use soroban_sdk::xdr::{
    Hash, HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits,
    ScAddress, ScSymbol, ScVal, SorobanAddressCredentials, SorobanAuthorizationEntry,
    SorobanAuthorizedFunction, SorobanAuthorizedInvocation, SorobanCredentials, VecM, WriteXdr,
};
use soroban_sdk::{Bytes, Env, IntoVal, Map, String, TryFromVal, Val};
use stellar_accounts::smart_account::{AuthPayload, Signer};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

const PETITIONS_WASM: &[u8] =
    include_bytes!("../../../../target/wasm32v1-none/contract/nido_petitions.wasm");

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "PetitionsClient")]
trait PetitionsInterface {
    fn create_petition(
        env: soroban_sdk::Env,
        creator: soroban_sdk::Address,
        title: String,
        body: String,
        goal: Option<u32>,
        deadline: Option<u32>,
    ) -> u32;
    fn sign(env: soroban_sdk::Env, id: u32, signer: soroban_sdk::Address);
    fn has_signed(env: soroban_sdk::Env, id: u32, addr: soroban_sdk::Address) -> bool;
    fn get_signers(
        env: soroban_sdk::Env,
        id: u32,
        start: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<soroban_sdk::Address>;
    fn petition_count(env: soroban_sdk::Env) -> u32;
}

/// Happy-path CRUD through the real wasm under mocked auth.
#[test]
fn petitions_wasm_crud() {
    use soroban_sdk::testutils::Address as _;

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PETITIONS_WASM, ());
    let client = PetitionsClient::new(&env, &id);

    let creator = soroban_sdk::Address::generate(&env);
    let signer = soroban_sdk::Address::generate(&env);

    let pid = client.create_petition(
        &creator,
        &String::from_str(&env, "Fix the bridge"),
        &String::from_str(&env, "It wobbles."),
        &Some(10),
        &None,
    );
    assert_eq!(pid, 0);
    assert_eq!(client.petition_count(), 1);

    client.sign(&pid, &signer);
    assert!(client.has_signed(&pid, &signer));
    assert_eq!(client.get_signers(&pid, &0, &10).len(), 1);
}

/// Sign a petition through the smart account via the REAL host auth path:
/// hand-built `SorobanAuthorizationEntry`, synthetic `WebAuthn` assertion,
/// `env.set_auths` in enforcing mode. Two sequential entries: the smart
/// account first creates the petition, then signs it.
#[test]
fn sign_petition_with_real_passkey_auth() {
    let env = Env::default();
    let (_sa_client, account_addr, verifier_addr, signing_key) = deploy_smart_account(&env);

    let petitions_addr = env.register(PETITIONS_WASM, ());
    let client = PetitionsClient::new(&env, &petitions_addr);

    let title = String::from_str(&env, "Open the commons");
    let body = String::from_str(&env, "We ask for public access.");

    // --- entry 1: create_petition(account, title, body, None, None) ---
    let title_val: Val = title.clone().into_val(&env);
    let body_val: Val = body.clone().into_val(&env);
    let none_u32: Option<u32> = None;
    let none_val: Val = none_u32.into_val(&env);
    let create_args: VecM<ScVal> = std::vec![
        ScVal::Address(ScAddress::from(&account_addr)),
        ScVal::try_from_val(&env, &title_val).unwrap(),
        ScVal::try_from_val(&env, &body_val).unwrap(),
        ScVal::try_from_val(&env, &none_val).unwrap(),
        ScVal::try_from_val(&env, &none_val).unwrap(),
    ]
    .try_into()
    .unwrap();
    let create_entry = build_entry(
        &env,
        &account_addr,
        &verifier_addr,
        &signing_key,
        &petitions_addr,
        "create_petition",
        create_args,
        0xCA01,
    );
    env.set_auths(&[create_entry]);
    let pid = client.create_petition(&account_addr, &title, &body, &None, &None);
    assert_eq!(pid, 0);

    // --- entry 2: sign(0, account) ---
    let sign_args: VecM<ScVal> = std::vec![
        ScVal::U32(0),
        ScVal::Address(ScAddress::from(&account_addr)),
    ]
    .try_into()
    .unwrap();
    let sign_entry = build_entry(
        &env,
        &account_addr,
        &verifier_addr,
        &signing_key,
        &petitions_addr,
        "sign",
        sign_args,
        0xCA02,
    );
    env.set_auths(&[sign_entry]);
    client.sign(&0, &account_addr);

    assert!(client.has_signed(&0, &account_addr));
}

/// Builds a real `SorobanAuthorizationEntry` for `contract.fn_name(args)`
/// authorized by the smart account's synthetic passkey (Default rule id 0).
/// Model: `name_registry_passkey_auth.rs`.
#[allow(clippy::too_many_arguments)]
fn build_entry(
    env: &Env,
    account_addr: &soroban_sdk::Address,
    verifier_addr: &soroban_sdk::Address,
    signing_key: &p256::ecdsa::SigningKey,
    contract_addr: &soroban_sdk::Address,
    fn_name: &str,
    args: VecM<ScVal>,
    nonce: i64,
) -> SorobanAuthorizationEntry {
    let invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: ScAddress::from(contract_addr),
            function_name: ScSymbol(fn_name.try_into().unwrap()),
            args,
        }),
        sub_invocations: VecM::default(),
    };

    let signature_expiration_ledger: u32 = 999_999;
    let network_id = Hash(env.ledger().network_id().to_array());
    let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id,
        nonce,
        signature_expiration_ledger,
        invocation: invocation.clone(),
    });
    let preimage_bytes = preimage.to_xdr(Limits::none()).unwrap();
    let signature_payload = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage_bytes));

    let context_rule_ids = soroban_sdk::vec![env, 0u32];
    let auth_digest = compute_auth_digest(env, &signature_payload, &context_rule_ids);
    let assertion = build_contract_assertion(signing_key, env, &auth_digest);

    let sig_data = WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    };
    let pubkey_sec1 = signing_key.verifying_key().to_sec1_bytes();
    let signer = Signer::External(
        verifier_addr.clone(),
        soroban_sdk::Bytes::from_slice(env, &pubkey_sec1),
    );
    let mut sig_map: Map<Signer, Bytes> = Map::new(env);
    sig_map.set(signer, sig_data.to_xdr(env));
    let auth_payload = AuthPayload {
        signers: sig_map,
        context_rule_ids,
    };
    let payload_val: Val = auth_payload.into_val(env);
    let signature = ScVal::try_from_val(env, &payload_val).unwrap();
    SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: ScAddress::from(account_addr),
            nonce,
            signature_expiration_ledger,
            signature,
        }),
        root_invocation: invocation,
    }
}
