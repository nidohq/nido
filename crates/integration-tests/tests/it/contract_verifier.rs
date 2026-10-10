//! Perch's `WebAuthn` verifier contract (the deployed wasm every Nido passkey
//! signer names) against Nido's synthetic assertions, through the contract's
//! own `verify` entry point: the key bytes and the XDR `WebAuthnSigData`, as an
//! account's `__check_auth` passes them.

use nido_integration_tests::{
    build_contract_assertion, ContractAssertion, PERCH_WEBAUTHN_VERIFIER_WASM,
};
use p256::ecdsa::SigningKey;
use soroban_sdk::{vec, xdr::ToXdr, Address, Bytes, BytesN, Env, IntoVal, Symbol};
use stellar_accounts::verifiers::webauthn::WebAuthnSigData;

/// Whether the verifier at `verifier` accepts `sig` over `payload` by `key`.
/// A trap counts as a refusal, like a `false`.
fn verifies(
    env: &Env,
    verifier: &Address,
    payload: &[u8; 32],
    key: &Bytes,
    sig: &WebAuthnSigData,
) -> bool {
    let args = vec![
        env,
        Bytes::from_array(env, payload).into_val(env),
        key.into_val(env),
        sig.clone().to_xdr(env).into_val(env),
    ];
    matches!(
        env.try_invoke_contract::<bool, soroban_sdk::Error>(
            verifier,
            &Symbol::new(env, "verify"),
            args
        ),
        Ok(Ok(true))
    )
}

fn sig_data(a: &ContractAssertion) -> WebAuthnSigData {
    WebAuthnSigData {
        signature: a.signature.clone(),
        authenticator_data: a.authenticator_data.clone(),
        client_data: a.client_data.clone(),
    }
}

fn setup() -> (Env, Address, SigningKey) {
    let env = Env::default();
    let verifier = env.register(PERCH_WEBAUTHN_VERIFIER_WASM, ());
    let signing_key = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    (env, verifier, signing_key)
}

#[test]
fn verify_webauthn_assertion_on_chain() {
    let (env, verifier, key) = setup();
    // A 32-byte signature payload, as the auth framework would produce it.
    let payload: [u8; 32] = [
        0x4b, 0xb7, 0xa8, 0xb9, 0x96, 0x09, 0xb0, 0xb8, 0xb1, 0xd5, 0x34, 0x69, 0x4b, 0xb1, 0xf3,
        0x1f, 0x12, 0x91, 0x38, 0xa2, 0xf2, 0xa1, 0x1f, 0x8e, 0x87, 0x02, 0xee, 0xdb, 0xb7, 0x92,
        0x92, 0x2e,
    ];
    let assertion = build_contract_assertion(&key, &env, &payload);
    assert!(verifies(
        &env,
        &verifier,
        &payload,
        &assertion.key_data,
        &sig_data(&assertion)
    ));
}

#[test]
fn reject_wrong_challenge_on_chain() {
    let (env, verifier, key) = setup();
    let assertion = build_contract_assertion(&key, &env, &[1u8; 32]);
    assert!(
        !verifies(
            &env,
            &verifier,
            &[2u8; 32],
            &assertion.key_data,
            &sig_data(&assertion)
        ),
        "should reject mismatched challenge"
    );
}

#[test]
fn reject_wrong_key_on_chain() {
    let (env, verifier, key) = setup();
    let wrong = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
    let payload = [3u8; 32];
    let assertion = build_contract_assertion(&key, &env, &payload);
    let wrong_key = Bytes::from_slice(&env, &wrong.verifying_key().to_sec1_bytes());
    assert!(
        !verifies(&env, &verifier, &payload, &wrong_key, &sig_data(&assertion)),
        "should reject wrong public key"
    );
}

/// P-256 group order `n`, big-endian. `n - s` maps a canonical low-S
/// signature to its (equally valid, under raw ECDSA) high-S counterpart.
const P256_ORDER_BE: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xbc, 0xe6, 0xfa, 0xad, 0xa7, 0x17, 0x9e, 0x84, 0xf3, 0xb9, 0xca, 0xc2, 0xfc, 0x63, 0x25, 0x51,
];

/// Big-endian 256-bit subtraction `a - b`, assuming `a >= b` (true here since
/// `s < n`). Used only to derive the high-S counterpart of a low-S scalar.
// `diff` is held in [0, 0x1FF] by the `0x100 +` bias, so `diff as u8` (its low
// byte) is the exact result digit -- no real truncation.
#[allow(clippy::cast_possible_truncation)]
fn sub_be_32(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow = 0u16;
    for i in (0..32).rev() {
        let diff = 0x100u16 + u16::from(a[i]) - u16::from(b[i]) - borrow;
        out[i] = diff as u8;
        borrow = u16::from(diff < 0x100);
    }
    out
}

/// ECDSA signature malleability: for any valid signature `(r, s)`, `(r, n - s)`
/// is an equally valid signature over the same message under raw ECDSA. The
/// wallet's passkey path (soroban host `secp256r1_verify`, via OZ
/// `webauthn::verify`) enforces the canonical LOW-S form (`s < n/2`), so the
/// high-S counterpart must be REJECTED even though it is mathematically valid.
/// Without this, a network attacker could reshape a signature (changing the
/// tx/auth-entry signature bytes, hence its hash) without the passkey. This
/// pins that malleability protection at the verifier boundary: the ONLY change
/// between the accepted and rejected inputs is `s -> n - s`.
#[test]
fn reject_high_s_malleated_signature_on_chain() {
    let (env, verifier, key) = setup();
    let payload = [7u8; 32];
    let assertion = build_contract_assertion(&key, &env, &payload);

    // `build_contract_assertion` normalises to low-S, so split r||s and flip s
    // to its high-S counterpart n - s.
    let low = assertion.signature.to_array();
    let mut s = [0u8; 32];
    s.copy_from_slice(&low[32..]);
    let mut malleated = low;
    malleated[32..].copy_from_slice(&sub_be_32(&P256_ORDER_BE, &s));

    // The canonical low-S signature verifies, so the only defect below is
    // the S-value.
    assert!(
        verifies(
            &env,
            &verifier,
            &payload,
            &assertion.key_data,
            &sig_data(&assertion)
        ),
        "the canonical low-S signature must verify"
    );
    let high = WebAuthnSigData {
        signature: BytesN::<64>::from_array(&env, &malleated),
        ..sig_data(&assertion)
    };
    assert!(
        !verifies(&env, &verifier, &payload, &assertion.key_data, &high),
        "high-S malleated signature must be rejected (ECDSA malleability protection)"
    );
}
