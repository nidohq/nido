/**
 * Match a WebAuthn assertion to one of a set of candidate P-256 public keys.
 *
 * Multi-passkey ceremonies (issue #87) collect assertions from DISCOVERABLE
 * credentials — `navigator.credentials.get()` with no `allowCredentials` —
 * so the wallet does not know up front which registered signer the user
 * picked. The assertion itself carries no public key, but the signer set of
 * the rule being satisfied is known, so the key is identified by verifying
 * the signature against each candidate.
 *
 * The on-chain verifier checks the P-256 signature over
 * `SHA-256(authenticatorData || SHA-256(clientDataJSON))`; the same message
 * is reconstructed here. `lowS` is NOT enforced during matching — the
 * authenticator may emit a high-S signature, which `derToCompact` normalizes
 * before anything goes on chain.
 */

import { p256 } from '@noble/curves/nist.js';
import type { PasskeySignature } from './types.js';

/**
 * Return the index of the candidate public key that verifies `sig`, or
 * `null` if none does.
 *
 * @param sig         Parsed assertion (compact 64-byte r||s signature).
 * @param candidates  65-byte SEC1 uncompressed P-256 public keys.
 */
export async function identifyAssertionSigner(
  sig: PasskeySignature,
  candidates: readonly Uint8Array[],
): Promise<number | null> {
  const cdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBuffer(sig.clientDataJson)),
  );
  const msg = new Uint8Array(sig.authenticatorData.byteLength + cdHash.byteLength);
  msg.set(sig.authenticatorData, 0);
  msg.set(cdHash, sig.authenticatorData.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(msg)));

  for (let i = 0; i < candidates.length; i++) {
    try {
      if (
        p256.verify(sig.signature, digest, candidates[i], {
          prehash: false,
          lowS: false,
        })
      ) {
        return i;
      }
    } catch {
      // Malformed candidate key or signature for this curve — not a match.
    }
  }
  return null;
}

/** Copy a Uint8Array into a standalone ArrayBuffer (crypto.subtle is strict
 *  about SharedArrayBuffer-backed and offset views). */
function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
}
