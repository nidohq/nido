import { p256 } from '@noble/curves/p256';

/** Build a WebAuthn-shaped assertion the on-chain verifier accepts, using a
 *  raw P-256 private key (no authenticator involvement).
 *
 *  Mirrors `build_contract_assertion` in `crates/integration-tests/src/lib.rs`.
 *  The on-chain verifier (`stellar_accounts::verifiers::webauthn`) enforces:
 *  - `digest == SHA-256(authenticatorData || SHA-256(clientDataJSON))`
 *  - challenge in clientDataJSON equals base64url(signature_payload)
 *
 *  The signature is RFC-6979 deterministic with low-S normalization (Stellar
 *  contract auth requires low-S).
 */
export interface SyntheticAssertion {
  authenticatorData: Uint8Array; // 37 bytes
  clientDataJSON: Uint8Array;
  signature: Uint8Array;         // 64 bytes (r || s), low-S
}

export async function buildSyntheticAssertion(
  privateKeyD: Uint8Array,
  payload32: Uint8Array,
): Promise<SyntheticAssertion> {
  if (payload32.byteLength !== 32) {
    throw new Error('buildSyntheticAssertion: payload must be 32 bytes');
  }

  const challenge = bytesToB64u(payload32);
  const clientDataJSON = new TextEncoder().encode(
    `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://example.com","crossOrigin":false}`,
  );
  // authenticatorData: 32-byte rpIdHash (zero — verifier skips this check) +
  // 1 flags byte (UP|UV|BE|BS = 0x1D) + 4 zero counter bytes = 37 bytes.
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = 0x1d;

  const cdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', clientDataJSON),
  );
  const msg = new Uint8Array(authenticatorData.byteLength + cdHash.byteLength);
  msg.set(authenticatorData, 0);
  msg.set(cdHash, authenticatorData.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', msg));

  // RFC-6979 prehash sign with low-S enforcement.
  // In @noble/curves v1.x, p256.sign() returns a Signature object;
  // .toCompactRawBytes() gives 64 bytes (r||s).
  const signature = p256.sign(digest, privateKeyD, { lowS: true }).toCompactRawBytes();

  return { authenticatorData, clientDataJSON, signature };
}

function bytesToB64u(b: Uint8Array): string {
  let s = btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
