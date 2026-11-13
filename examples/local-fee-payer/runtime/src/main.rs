//! Local fixture checker, not the complete Perch contract evaluator.
//! WASI Preview 1 command: public JSON on stdin, bounded decision on stdout.
use std::{io::{self, Read}, str::FromStr};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use cedar_policy::{Authorizer, Context, Decision, Entities, EntityUid, PolicySet, Request};
use p256::{ecdsa::{signature::Verifier, Signature, VerifyingKey}, pkcs8::DecodePublicKey};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use stellar_xdr::*;

const NETWORK: &str = "Test SDF Network ; September 2015";
const ORIGIN: &str = "http://wallet.localhost:5199";
const POLICY: &str = include_str!("../fee-policy.cedar");
type Checked<T> = Result<T, String>;
fn digest(bytes: impl AsRef<[u8]>) -> Vec<u8> { Sha256::digest(bytes).to_vec() }
fn hex(bytes: impl AsRef<[u8]>) -> String { bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect() }
fn require(ok: bool, reason: &str) -> Checked<()> { if ok { Ok(()) } else { Err(reason.into()) } }
fn limits() -> Limits { Limits { depth: 64, len: 64 * 1024 } }
fn encoded<T: WriteXdr>(v: &T) -> Checked<Vec<u8>> { v.to_xdr(limits()).map_err(|e| e.to_string()) }
fn decode(s: &str) -> Checked<Vec<u8>> { STANDARD.decode(s).map_err(|_| "Invalid base64".into()) }
fn account(s: &str) -> Checked<ScAddress> { ScAddress::from_str(s).map_err(|_| "Invalid address".into()) }
fn fixture(n: u8) -> ScAddress { ScAddress::Contract(ContractId(Hash([n; 32]))) }
fn bytes(v: &ScVal) -> Checked<&[u8]> { if let ScVal::Bytes(b) = v { Ok(b.as_ref()) } else { Err("Expected bytes".into()) } }
fn vector(v: &ScVal) -> Checked<&[ScVal]> { if let ScVal::Vec(Some(b)) = v { Ok(b.as_ref()) } else { Err("Expected vector".into()) } }
fn field<'a>(v: &'a ScVal, name: &str, count: usize) -> Checked<&'a ScVal> {
    let ScVal::Map(Some(m)) = v else { return Err("Expected map".into()) };
    require(m.len() == count, "Unexpected map fields")?;
    let found: Vec<_> = m.iter().filter(|p| matches!(&p.key, ScVal::Symbol(s) if s.0.as_slice() == name.as_bytes())).collect();
    require(found.len() == 1, "Missing or duplicate field")?; Ok(&found[0].val)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Intent { kind: String, account: String, recipient: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Registration { credential_id: String, spki: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalBudget { contract: String, verifier: String, source: String, action: String,
    latest_ledger: u32, expires: u32 }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input { request_id: String, network: String, envelope: String, intent: Intent,
    registration: Registration, asserted_credential_id: String, fee_account: String,
    #[serde(default)] local_budget: Option<LocalBudget> }

fn check(input: &Input) -> Checked<Value> {
    require(!input.request_id.is_empty() && input.request_id.len() <= 128, "Invalid request ID")?;
    let local = input.local_budget.as_ref();
    let network = if local.is_some() { "Standalone Network ; February 2017" } else { NETWORK };
    require(input.network == network, "Wrong network")?;
    require(input.intent.kind == if local.is_some() { "local-budget-action" } else { "sponsor-demo-transfer" }, "Unsupported intent")?;
    let c = account(&input.intent.account)?;
    require(if local.is_some() { matches!(c, ScAddress::Contract(_)) } else { c == fixture(1) }, "Wrong C account")?;
    let recipient = account(&input.intent.recipient)?;
    require(matches!(recipient, ScAddress::Account(_)), "Recipient must be G")?;
    let fee_address = account(&input.fee_account)?;
    let ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(fee_key))) = fee_address else { return Err("Fee account must be G".into()) };
    let raw = decode(&input.envelope)?;
    let envelope = TransactionEnvelope::from_xdr(&raw, limits()).map_err(|e| e.to_string())?;
    let TransactionEnvelope::TxFeeBump(fb) = envelope else { return Err("Expected fee bump".into()) };
    require(fb.signatures.is_empty(), "Envelope already signed")?;
    require(fb.tx.fee_source == MuxedAccount::Ed25519(fee_key), "Wrong fee source")?;
    let FeeBumpTransactionInnerTx::Tx(inner) = &fb.tx.inner_tx;
    if let Some(b) = local {
        let ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(u))) = account(&b.source)? else { return Err("U must be G".into()) };
        require(inner.tx.source_account == MuxedAccount::Ed25519(u), "Wrong inner source")?;
        require(inner.signatures.is_empty(), "Inner signatures must be wallet-owned")?;
        require(recipient == account(&input.fee_account)?, "Wrong registered F")?;
    }
    require(inner.tx.operations.len() == 1, "One operation required")?;
    let op = &inner.tx.operations[0];
    require(op.source_account.is_none(), "Unexpected operation source")?;
    let OperationBody::InvokeHostFunction(invoke) = &op.body else { return Err("Not a contract invocation".into()) };
    let HostFunction::InvokeContract(call) = &invoke.host_function else { return Err("Wrong host function".into()) };
    let expected_args = if let Some(b) = local {
        require((b.action == "refill" || b.action == "touch") && call.contract_address == c && call.function_name.0.as_slice() == b"execute", "Unsupported wallet action")?;
        vec![ScVal::Address(account(&b.contract)?), ScVal::Symbol(ScSymbol(b.action.as_bytes().to_vec().try_into().unwrap())), ScVal::Vec(Some(ScVec(Vec::<ScVal>::new().try_into().unwrap())))]
    } else {
        require(call.contract_address == fixture(2) && call.function_name.0.as_slice() == b"transfer", "Wrong token or function")?;
        vec![ScVal::Address(c.clone()), ScVal::Address(recipient), ScVal::I128(Int128Parts { hi: 0, lo: 10_000_000 })]
    };
    require(call.args.as_slice() == expected_args, "Intent/envelope mismatch")?;
    require(invoke.auth.len() == 1, "One C authorization required")?;
    let entry = &invoke.auth[0];
    require(entry.root_invocation.sub_invocations.is_empty(), "Unexpected sub-invocations")?;
    require(entry.root_invocation.function == SorobanAuthorizedFunction::ContractFn(call.clone()), "Invocation/auth mismatch")?;
    let SorobanCredentials::Address(creds) = &entry.credentials else { return Err("Wrong credentials".into()) };
    require(creds.address == c, "Wrong C account")?;
    if let Some(b) = local {
        require(creds.signature_expiration_ledger > b.latest_ledger && creds.signature_expiration_ledger <= b.latest_ledger.saturating_add(120) && creds.signature_expiration_ledger <= b.expires, "Expired or unbounded authorization")?;
    } else { require(creds.nonce == 7 && creds.signature_expiration_ledger == 12345, "Wrong fixture nonce/expiry")?; }
    let rules = field(&creds.signature, "context_rule_ids", 2)?;
    let rule = 0;
    require(vector(rules)? == [ScVal::U32(rule)], "Wrong Perch rule IDs")?;
    let signers = field(&creds.signature, "signers", 2)?;
    let ScVal::Map(Some(signers)) = signers else { return Err("Expected signer map".into()) };
    require(signers.len() == 1, "Exactly one passkey signer required")?;
    let signer = vector(&signers[0].key)?;
    require(signer.len() == 3, "Wrong signer shape")?;
    let verifier = if let Some(b) = local { account(&b.verifier)? } else { fixture(3) };
    require(matches!(&signer[0], ScVal::Symbol(s) if s.0.as_slice() == b"External") && signer[1] == ScVal::Address(verifier), "Wrong external verifier")?;
    let pinned_key = VerifyingKey::from_public_key_der(&decode(&input.registration.spki)?).map_err(|_| "Invalid pinned P256 key")?;
    require(bytes(&signer[2])? == pinned_key.to_encoded_point(false).as_bytes(), "Wrong Perch passkey")?;
    require(input.asserted_credential_id == input.registration.credential_id, "Wrong credential ID")?;

    // Recompute addr_oz_v1 from the actual authorization XDR, not caller assertions.
    let preimage = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: Hash(digest(network).try_into().unwrap()), nonce: creds.nonce,
        signature_expiration_ledger: creds.signature_expiration_ledger, invocation: entry.root_invocation.clone(),
    });
    let payload = digest(encoded(&preimage)?);
    let ScAddress::Contract(ContractId(c_hash)) = c else { return Err("C must be contract".into()) };
    let mut bound = b"perch/account/auth-addr-v1".to_vec(); bound.extend(c_hash.0); bound.extend(payload);
    let mut challenge = digest(bound); challenge.extend(encoded(rules)?);
    let challenge = digest(challenge);
    let signature = ScVal::from_xdr(bytes(&signers[0].val)?, limits()).map_err(|e| e.to_string())?;
    let auth = bytes(field(&signature, "authenticator_data", 3)?)?;
    let client_raw = bytes(field(&signature, "client_data", 3)?)?;
    let sig = Signature::from_slice(bytes(field(&signature, "signature", 3)?)?).map_err(|_| "Invalid P256 signature encoding")?;
    let client: Value = serde_json::from_slice(client_raw).map_err(|_| "Invalid client data")?;
    require(client["type"] == "webauthn.get" && client["challenge"] == URL_SAFE_NO_PAD.encode(&challenge), "Wrong passkey challenge")?;
    require(client["origin"] == ORIGIN && (client.get("crossOrigin").is_none() || client["crossOrigin"] == false) && client.get("topOrigin").is_none(), "Wrong passkey origin")?;
    require(auth.len() >= 37 && auth[..32] == digest("wallet.localhost"), "Wrong RP ID")?;
    let flags = auth[32];
    require(flags & 5 == 5 && (flags & 16 == 0 || flags & 8 != 0), "Missing UP/UV or invalid backup flags")?;
    let mut signed = auth.to_vec(); signed.extend(digest(client_raw));
    pinned_key.verify(&signed, &sig).map_err(|_| "Invalid passkey signature")?;

    let principal = EntityUid::from_type_name_and_id("Passkey".parse().unwrap(), input.registration.credential_id.parse().unwrap());
    let resource = EntityUid::from_type_name_and_id("FeeAccount".parse().unwrap(), input.fee_account.parse().unwrap());
    let entities = Entities::from_json_value(json!([{"uid": {"type":"FeeAccount", "id":input.fee_account}, "attrs": {
        "passkey":{"__entity":{"type":"Passkey","id":input.registration.credential_id}},
        "cAccount": input.intent.account, "maxFeeStroops":if local.is_some() {500000} else {1000} }, "parents":[]}]), None).map_err(|e|e.to_string())?;
    let context = Context::from_json_value(json!({"passkeyVerified":true,"cAuthorizationVerified":true,
        "cAccount":input.intent.account,"network":if local.is_some() {"local"} else {"testnet"},"feeStroops":fb.tx.fee}), None).map_err(|e|e.to_string())?;
    let request = Request::new(principal, "Action::\"sponsor\"".parse().unwrap(), resource, context, None).map_err(|e|e.to_string())?;
    let policies = PolicySet::from_str(POLICY).map_err(|e|e.to_string())?;
    let decision = Authorizer::new().is_authorized(&request, &policies, &entities);
    require(decision.decision() == Decision::Allow && decision.diagnostics().errors().next().is_none(), "Cedar denied fee signing")?;
    Ok(json!({"envelopeHash":hex(digest(&raw)), "feeStroops":fb.tx.fee,
        "checks":["exact-intent-xdr","perch-addr-oz-v1","p256-passkey","wallet-rp-origin-uv","cedar-fee-policy"]}))
}

fn main() {
    let mut raw = Vec::new();
    let read = io::stdin().take(128 * 1024 + 1).read_to_end(&mut raw);
    let parsed: Checked<Input> = if read.is_err() || raw.len() > 128 * 1024 { Err("Input limit".into()) }
        else { serde_json::from_slice(&raw).map_err(|e|e.to_string()) };
    let id = parsed.as_ref().map(|i|i.request_id.as_str()).unwrap_or("");
    let result = parsed.as_ref().map_err(|e|e.clone()).and_then(check);
    let mut out = json!({"version":1,"requestId":id,"inputHash":hex(digest(&raw)),"allowed":false});
    match result { Ok(facts) => { out["allowed"]=json!(true); out["facts"]=facts; }, Err(e) => out["reason"]=json!(e) }
    println!("{out}");
}
