use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use p256::ecdsa::signature::hazmat::PrehashSigner;
use p256::ecdsa::{Signature, SigningKey};
use sha2::{Digest, Sha256};
use soroban_sdk::testutils::Address as _;
use stellar_accounts::policies::simple_threshold::SimpleThresholdAccountParams;
use stellar_accounts::policies::spending_limit::SpendingLimitAccountParams;
use stellar_accounts::smart_account::{ContextRule, ContextRuleType, Signer};

pub mod world;
pub mod zk;

/// Nido's own contracts, built by `just build-contracts`.
pub const MULTISIG_POLICY_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/nido_multisig_policy.wasm");

pub const SPENDING_LIMIT_POLICY_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/nido_spending_limit_policy.wasm");

pub const PREAUTH_SWEEP_POLICY_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/nido_preauth_sweep_policy.wasm");

/// The factory embeds the same Perch account wasm as [`PERCH_ACCOUNT_WASM`]
/// (`contracts/factory/build.rs`), so uploading [`PERCH_ACCOUNT_WASM`] before
/// `create_account` satisfies its `deploy_v2` hash lookup.
pub const FACTORY_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/nido_factory.wasm");

/// The Perch deployables under test: the exact wasm of Perch's testnet
/// deployment, fetched by `just perch-infra` from the hashes in
/// `vendor/perch/deployments/testnet.json` (each refused unless its sha256
/// and content address match).
pub const PERCH_ACCOUNT_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_account.wasm");
pub const PERCH_RECOVERY_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_recovery.wasm");
pub const PERCH_ZK_POOL_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_zk_pool.wasm");
pub const PERCH_ZK_ADAPTER_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_zk_adapter.wasm");
pub const PERCH_DOC_COMPILER_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_doc_compiler.wasm");
pub const PERCH_INTERPRETER_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_interpreter.wasm");
pub const PERCH_SPENDING_LIMIT_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_spending_limit.wasm");
/// The constructorless, immutable `WebAuthn` verifier every passkey signer
/// names; the factory pins it.
pub const PERCH_WEBAUTHN_VERIFIER_WASM: &[u8] =
    include_bytes!("../../../target/wasm32v1-none/contract/perch_webauthn_verifier.wasm");

/// The Wasm the upgrade tests schedule: a committed copy of Nido's
/// status-message contract (999 bytes). ZK upgrade approvals bind its hash,
/// so it must not be a local build, whose hash varies with the toolchain.
pub const UPGRADE_TARGET_WASM: &[u8] = include_bytes!("../fixtures/upgrade-target.wasm");

/// The account's typed client (Perch's `PerchSmartAccount` surface).
pub use perch_account::PerchAccountClient as SmartAccountClient;

// ---------------------------------------------------------------------
// Policy-mechanics backdoor: the account exports no OZ rule mutators
// (`apply_doc` is the sole policy write path). Tests that exercise a POLICY
// contract's mechanics — session-key scoping, threshold policies, spending
// limits, sweep policies — stage arbitrary rule shapes directly through the
// OZ library against the account's storage via `env.as_contract`. This is a
// test-only backdoor: on a real network a rule exists only if an applied
// document compiled to it. The account and recovery suites never use it.
// ---------------------------------------------------------------------

/// Install a context rule directly (library call, no entry point).
#[must_use]
pub fn install_rule_direct(
    env: &soroban_sdk::Env,
    account: &soroban_sdk::Address,
    context_type: &ContextRuleType,
    name: &str,
    valid_until: Option<u32>,
    signers: &soroban_sdk::Vec<Signer>,
    policies: &soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val>,
) -> ContextRule {
    let name = soroban_sdk::String::from_str(env, name);
    env.as_contract(account, || {
        stellar_accounts::smart_account::add_context_rule(
            env,
            context_type,
            &name,
            valid_until,
            signers,
            policies,
        )
    })
}

/// Add a signer to a rule directly (library call, no entry point).
#[must_use]
pub fn add_signer_direct(
    env: &soroban_sdk::Env,
    account: &soroban_sdk::Address,
    context_rule_id: u32,
    signer: &Signer,
) -> u32 {
    env.as_contract(account, || {
        stellar_accounts::smart_account::add_signer(env, context_rule_id, signer)
    })
}

/// Remove a signer from a rule directly (library call, no entry point).
pub fn remove_signer_direct(
    env: &soroban_sdk::Env,
    account: &soroban_sdk::Address,
    context_rule_id: u32,
    signer_id: u32,
) {
    env.as_contract(account, || {
        stellar_accounts::smart_account::remove_signer(env, context_rule_id, signer_id);
    });
}

/// Attach a policy to a rule directly (library call, no entry point).
#[must_use]
pub fn add_policy_direct(
    env: &soroban_sdk::Env,
    account: &soroban_sdk::Address,
    context_rule_id: u32,
    policy: &soroban_sdk::Address,
    install_param: soroban_sdk::Val,
) -> u32 {
    env.as_contract(account, || {
        stellar_accounts::smart_account::add_policy(env, context_rule_id, policy, install_param)
    })
}

/// Remove a context rule directly (library call, no entry point).
pub fn remove_rule_direct(
    env: &soroban_sdk::Env,
    account: &soroban_sdk::Address,
    context_rule_id: u32,
) {
    env.as_contract(account, || {
        stellar_accounts::smart_account::remove_context_rule(env, context_rule_id);
    });
}

/// Create a deterministic P-256 signing key from a `u64` seed.
///
/// The seed is hashed with SHA-256 to produce the 32-byte scalar. This
/// guarantees that seeds 1, 2, 3, 4, … always yield the same key so tests
/// are reproducible. Never reuse seed 1 for friend keys — `deploy_smart_account`
/// internally uses a random key for the primary passkey signer.
///
/// # Panics
/// Panics if the derived scalar bytes fail to produce a valid `SigningKey`.
#[must_use]
pub fn test_key(seed: u64) -> SigningKey {
    let mut hasher = Sha256::new();
    hasher.update(b"nido-test-key:");
    hasher.update(seed.to_le_bytes());
    let bytes = hasher.finalize();
    SigningKey::from_bytes(&bytes).expect("deterministic key from seed")
}

/// On-chain `WebAuthn` assertion components (soroban-sdk types) suitable for
/// the `WebAuthnVerifier` contract.
pub struct ContractAssertion {
    pub authenticator_data: soroban_sdk::Bytes,
    pub client_data: soroban_sdk::Bytes,
    pub signature: soroban_sdk::BytesN<64>,
    pub key_data: soroban_sdk::Bytes,
}

/// Build a synthetic `WebAuthn` assertion for on-chain verification.
///
/// The `signature_payload` is the 32-byte hash that the Soroban auth framework
/// would produce. The challenge in clientDataJSON is its base64url encoding.
///
/// # Panics
/// Panics if prehash ECDSA signing fails.
#[must_use]
pub fn build_contract_assertion(
    signing_key: &SigningKey,
    env: &soroban_sdk::Env,
    signature_payload: &[u8; 32],
) -> ContractAssertion {
    // Challenge = base64url(signature_payload)
    let challenge_b64 = URL_SAFE_NO_PAD.encode(signature_payload);

    // authenticatorData: 37 bytes minimum (rpIdHash zeroed — the on-chain
    // verifier skips rpIdHash validation).
    // flags = UP(0x01) | UV(0x04) | BE(0x08) | BS(0x10) = 0x1D
    let mut auth_data_raw = [0u8; 37];
    auth_data_raw[32] = 0x1D;
    let authenticator_data = soroban_sdk::Bytes::from_array(env, &auth_data_raw);

    // clientDataJSON
    let client_data_str = std::format!(
        r#"{{"type":"webauthn.get","challenge":"{challenge_b64}","origin":"https://example.com","crossOrigin":false}}"#,
    );
    let client_data = soroban_sdk::Bytes::from_slice(env, client_data_str.as_bytes());

    // message digest = SHA-256(authData || SHA-256(clientData))
    let client_data_hash = env.crypto().sha256(&client_data);
    let mut msg = authenticator_data.clone();
    msg.extend_from_array(&client_data_hash.to_array());
    let digest = env.crypto().sha256(&msg);

    // Prehash sign (we already have the final hash)
    let sig: Signature = signing_key.sign_prehash(&digest.to_array()).unwrap();
    let sig_normalized = sig.normalize_s().unwrap_or(sig);
    let mut sig_bytes = [0u8; 64];
    sig_bytes.copy_from_slice(&sig_normalized.to_bytes());
    let signature = soroban_sdk::BytesN::<64>::from_array(env, &sig_bytes);

    // SEC1 uncompressed public key (65 bytes)
    let pubkey_sec1 = signing_key.verifying_key().to_sec1_bytes();
    let key_data = soroban_sdk::Bytes::from_slice(env, &pubkey_sec1);

    ContractAssertion {
        authenticator_data,
        client_data,
        signature,
        key_data,
    }
}

/// Deploy the `WebAuthn` verifier and a Perch account whose constructor rule
/// ("admin", id 0, scoped to the account itself) is a single passkey signer.
/// Returns the client, account address, verifier address, and signing key.
///
/// This is the bare constructor state: no applied document, no recovery, and
/// no Perch infra registered. Policy-mechanics tests stage further rules with
/// the `*_direct` backdoors above (they land at id 1 and up); account and
/// recovery tests use [`world::World`] instead.
#[must_use]
pub fn deploy_smart_account(
    env: &soroban_sdk::Env,
) -> (
    SmartAccountClient<'_>,
    soroban_sdk::Address,
    soroban_sdk::Address,
    SigningKey,
) {
    let verifier_addr = env.register(PERCH_WEBAUTHN_VERIFIER_WASM, ());
    let signing_key = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let pubkey_sec1 = signing_key.verifying_key().to_sec1_bytes();
    let signer = Signer::External(
        verifier_addr.clone(),
        soroban_sdk::Bytes::from_slice(env, &pubkey_sec1),
    );
    let account_addr = env.register(PERCH_ACCOUNT_WASM, (soroban_sdk::vec![env, signer],));
    let client = SmartAccountClient::new(env, &account_addr);
    (client, account_addr, verifier_addr, signing_key)
}

/// Deploy the multisig policy contract and return its address.
#[must_use]
pub fn deploy_multisig_policy(env: &soroban_sdk::Env) -> soroban_sdk::Address {
    env.register(MULTISIG_POLICY_WASM, (soroban_sdk::Address::generate(env),))
}

/// Build the `policies` map for `add_context_rule` containing a single
/// multisig-policy install with the given threshold.
#[must_use]
pub fn multisig_install_map(
    env: &soroban_sdk::Env,
    multisig_policy_addr: &soroban_sdk::Address,
    threshold: u32,
) -> soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> {
    use soroban_sdk::IntoVal;
    let params = SimpleThresholdAccountParams { threshold };
    let mut m: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> =
        soroban_sdk::Map::new(env);
    m.set(multisig_policy_addr.clone(), params.into_val(env));
    m
}

/// Deploy the spending-limit policy contract and return its address.
#[must_use]
pub fn deploy_spending_limit_policy(env: &soroban_sdk::Env) -> soroban_sdk::Address {
    env.register(
        SPENDING_LIMIT_POLICY_WASM,
        (soroban_sdk::Address::generate(env),),
    )
}

/// Build the `policies` map for `add_context_rule` containing a single
/// spending-limit-policy install with the given limit (stroops) and rolling
/// window (ledgers).
#[must_use]
pub fn spending_limit_install_map(
    env: &soroban_sdk::Env,
    policy_addr: &soroban_sdk::Address,
    spending_limit: i128,
    period_ledgers: u32,
) -> soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> {
    use soroban_sdk::IntoVal;
    let params = SpendingLimitAccountParams {
        spending_limit,
        period_ledgers,
    };
    let mut m: soroban_sdk::Map<soroban_sdk::Address, soroban_sdk::Val> =
        soroban_sdk::Map::new(env);
    m.set(policy_addr.clone(), params.into_val(env));
    m
}

/// Compute the auth digest the smart account's `do_check_auth` will pass to
/// the verifier, given the original signature payload and the chosen
/// context-rule IDs. In OZ v0.7+:
///
///     auth_digest = SHA-256(signature_payload || context_rule_ids.to_xdr())
///
/// Binds the signed message to the rule the caller selected (preventing
/// rule-substitution replay). Use the returned 32 bytes as the
/// `signature_payload` arg to `build_contract_assertion`.
#[must_use]
pub fn compute_auth_digest(
    env: &soroban_sdk::Env,
    signature_payload: &soroban_sdk::crypto::Hash<32>,
    context_rule_ids: &soroban_sdk::Vec<u32>,
) -> [u8; 32] {
    use soroban_sdk::xdr::ToXdr;
    let mut preimage = soroban_sdk::Bytes::from_array(env, &signature_payload.to_array());
    preimage.append(&context_rule_ids.clone().to_xdr(env));
    env.crypto().sha256(&preimage).to_array()
}

/// Build a real External (`WebAuthn`) session signer backed by the deterministic
/// P-256 key [`test_key`]`(seed)`, verified on-chain by the `verifier` contract.
///
/// Returns the signing key (to produce real signatures with [`one_sig`]) and the
/// matching `Signer::External`. Unlike a `Signer::Delegated` (whose auth is a
/// `require_auth_for_args` that `mock_all_auths` satisfies with no real
/// signature), an External signer is authenticated by the verifier contract's
/// actual P-256 check inside `do_check_auth` — which `mock_all_auths` does NOT
/// bypass — so tests using this exercise real signature verification.
#[must_use]
pub fn session_signer(
    env: &soroban_sdk::Env,
    verifier: &soroban_sdk::Address,
    seed: u64,
) -> (SigningKey, Signer) {
    let key = test_key(seed);
    let pubkey = key.verifying_key().to_sec1_bytes();
    (
        key,
        Signer::External(
            verifier.clone(),
            soroban_sdk::Bytes::from_slice(env, &pubkey),
        ),
    )
}

/// Produce a real single-signer `AuthPayload` for rule `rule_id`: sign the auth
/// digest (`sha256(payload || [rule_id].to_xdr())`, see [`compute_auth_digest`])
/// with `key`, wrap it as `WebAuthnSigData`, and map it under `signer`.
///
/// Passing a `key` whose public key does NOT match `signer`'s registered pubkey
/// (or whose digest was signed for a different rule) yields a *forged* payload
/// the `WebAuthn` verifier rejects — the basis of the signature-verification
/// negative tests. All callers here use a single rule id per authorization.
#[must_use]
pub fn one_sig(
    env: &soroban_sdk::Env,
    signer: &Signer,
    key: &SigningKey,
    payload: &soroban_sdk::crypto::Hash<32>,
    rule_id: u32,
) -> stellar_accounts::smart_account::AuthPayload {
    use soroban_sdk::xdr::ToXdr;
    let context_rule_ids = soroban_sdk::vec![env, rule_id];
    let auth_digest = compute_auth_digest(env, payload, &context_rule_ids);
    let assertion = build_contract_assertion(key, env, &auth_digest);
    let sig_data = stellar_accounts::verifiers::webauthn::WebAuthnSigData {
        signature: assertion.signature,
        authenticator_data: assertion.authenticator_data,
        client_data: assertion.client_data,
    };
    let mut signers: soroban_sdk::Map<Signer, soroban_sdk::Bytes> = soroban_sdk::Map::new(env);
    signers.set(signer.clone(), sig_data.to_xdr(env));
    stellar_accounts::smart_account::AuthPayload {
        signers,
        context_rule_ids,
    }
}
