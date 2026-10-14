/**
 * Challenge derivation for the wallet's SEP-43 "sign an arbitrary message"
 * ceremony.
 *
 * SECURITY (message-signing domain): a Perch account verifies a transaction/
 * auth assertion against the OZ v0.7 digest
 *
 *     auth_digest = sha256(signature_payload[32] ‖ context_rule_ids.to_xdr())
 *
 * (perch-js `signingDigest`). A WebAuthn assertion carries no notion of what
 * it was "for" — it is just a P-256 signature over a 32-byte challenge. So if
 * the message-signing challenge is derived with the SAME primitive and lives
 * in the SAME preimage space as `auth_digest`, a dApp can present a "message"
 * whose bytes are a malicious authorization preimage, collect a signature under
 * the innocuous "sign this message" prompt, and splice that signature into an
 * on-chain auth entry (`injectPasskeySignature`). The message approval then
 * authorizes an attacker-chosen `execute`/policy change.
 *
 * Defence: derive the message challenge under a fixed, versioned, non-XDR
 * domain prefix so its preimage can never equal an `auth_digest` preimage.
 * An attacker would have to grind a 32-byte `signature_payload` whose leading
 * bytes equal {@link MESSAGE_SIGNING_DOMAIN}; since `signature_payload` is
 * itself a SHA-256 output, matching a prefix this long is infeasible.
 */

import { hash } from '@stellar/stellar-sdk';

/**
 * Domain-separation prefix for arbitrary-message signing. Versioned so the
 * encoding can evolve without a new version silently validating as an old one.
 * The exact byte string is a security parameter: changing or shortening it
 * narrows the gap between the message and authorization preimage spaces.
 */
export const MESSAGE_SIGNING_DOMAIN = 'Nido signed message (v1):\n';

/**
 * The 32-byte WebAuthn challenge the wallet signs for an arbitrary message.
 * Domain-separated from the transaction/auth digest (see module docs).
 */
export function deriveMessageChallenge(message: string): Uint8Array {
  const domain = Buffer.from(MESSAGE_SIGNING_DOMAIN, 'utf-8');
  const body = Buffer.from(message, 'utf-8');
  return new Uint8Array(hash(Buffer.concat([domain, body])));
}
