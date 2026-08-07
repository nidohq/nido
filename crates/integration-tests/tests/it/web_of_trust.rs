//! Wasm-level tests for `contracts/web-of-trust`: vouch graph consistency and
//! the ed25519 pre-vouch claim flow, plus a pinned claim-payload fixture that
//! the dapp's TypeScript payload builder must match byte-for-byte.

use std::fmt::Write as _;

use ed25519_dalek::Signer as _;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::xdr::ToXdr as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};

const WOT_WASM: &[u8] =
    include_bytes!("../../../../target/wasm32v1-none/contract/nido_web_of_trust.wasm");

const CLAIM_DOMAIN: &[u8] = b"adsum:claim_vouch";

/// Pinned, known-valid strkeys for the payload fixture (values borrowed from
/// DEPLOYED.md/relayer docs purely as valid fixture inputs; nothing is
/// invoked on them — only their XDR encodings matter).
const FIXTURE_CONTRACT: &str = "CDBL7MNO7UI5OAAIC67UIWKQ4P3S6RVQSFCQXUHUW6TOFCXSYRPNHY4S";
/// Pinned claimant for the payload fixture.
const FIXTURE_CLAIMANT: &str = "GAL42RUBXKQSVSJWBXFTBB4GFKMPQXA3SOJVGP6UMRJT2SGEIR63JFK2";

/// Pinned claim-payload bytes (hex) for `FIXTURE_CONTRACT`/`FIXTURE_CLAIMANT`.
/// Captured once via `claim_payload_fixture`'s `--nocapture` output, then
/// pasted here as the permanent pin. The dapp's TS `buildClaimPayload` test
/// must reproduce these exact bytes — the two are one protocol.
const CLAIM_PAYLOAD_FIXTURE_HEX: &str = "0000001200000001c2bfb1aefd11d7000817bf445950e3f72f46b091450bd0f4b7a6e28af2c45ed3616473756d3a636c61696d5f766f75636800000012000000000000000017cd4681baa12ac9360dcb3087862a98f85c1b9393533fd464533d48c4447db4";

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "WotClient")]
trait WotInterface {
    fn vouch(env: soroban_sdk::Env, from: Address, to: Address);
    fn revoke(env: soroban_sdk::Env, from: Address, to: Address);
    fn has_vouched(env: soroban_sdk::Env, from: Address, to: Address) -> bool;
    fn vouches_given(env: soroban_sdk::Env, a: Address) -> Vec<Address>;
    fn vouches_received(env: soroban_sdk::Env, a: Address) -> Vec<Address>;
    fn pre_vouch(
        env: soroban_sdk::Env,
        from: Address,
        key: BytesN<32>,
        expires: Option<u32>,
        max_claims: u32,
    );
    fn claim_vouch(env: soroban_sdk::Env, key: BytesN<32>, to: Address, sig: BytesN<64>);
}

fn claim_payload(env: &Env, contract: &Address, to: &Address) -> std::vec::Vec<u8> {
    let mut payload = contract.clone().to_xdr(env);
    payload.append(&Bytes::from_slice(env, CLAIM_DOMAIN));
    payload.append(&to.clone().to_xdr(env));
    let mut out = std::vec![0u8; payload.len() as usize];
    payload.copy_into_slice(&mut out);
    out
}

#[test]
fn wasm_vouch_graph_roundtrip() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(WOT_WASM, ());
    let client = WotClient::new(&env, &id);

    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.vouch(&a, &b);
    assert!(client.has_vouched(&a, &b));
    assert_eq!(client.vouches_received(&b).len(), 1);
    client.revoke(&a, &b);
    assert!(!client.has_vouched(&a, &b));
    assert_eq!(client.vouches_received(&b).len(), 0);
}

#[test]
fn wasm_claim_flow_end_to_end() {
    let env = Env::default();
    env.mock_all_auths(); // covers pre_vouch's require_auth; claim needs none
    let id = env.register(WOT_WASM, ());
    let client = WotClient::new(&env, &id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let sk = ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]);
    let key = BytesN::from_array(&env, &sk.verifying_key().to_bytes());

    client.pre_vouch(&alice, &key, &None, &1);
    let sig = sk.sign(&claim_payload(&env, &id, &bob));
    client.claim_vouch(&key, &bob, &BytesN::from_array(&env, &sig.to_bytes()));

    assert!(client.has_vouched(&alice, &bob));
}

/// Pins the claim payload bytes for fixed inputs. The dapp's TS
/// `buildClaimPayload(contractId, to)` test must produce EXACTLY these bytes
/// (see the adsum dapp plan). If this test ever changes, the TS fixture must
/// change with it — the two are one protocol.
#[test]
fn claim_payload_fixture() {
    let env = Env::default();
    let contract = Address::from_str(&env, FIXTURE_CONTRACT);
    let to = Address::from_str(&env, FIXTURE_CLAIMANT);
    let payload = claim_payload(&env, &contract, &to);
    let hex = payload
        .iter()
        .fold(std::string::String::new(), |mut out, b| {
            let _ = write!(out, "{b:02x}");
            out
        });
    std::println!("CLAIM_PAYLOAD_FIXTURE_HEX = {hex}");
    assert_eq!(hex, CLAIM_PAYLOAD_FIXTURE_HEX);
}
