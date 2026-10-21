import { describe, it, expect } from 'vitest';
import { deriveMessageChallenge, MESSAGE_SIGNING_DOMAIN } from './messageSigning';
import { hash } from '@stellar/stellar-sdk';
import { ruleIdsXdr } from '@stellar-registry/perch';

/**
 * A Perch account verifies an on-chain authorization against
 *   auth_digest = sha256(bound ‖ context_rule_ids.to_xdr())
 * where `bound` folds in the account address, but the OZ rule-id layer is
 * still a plain sha256 over a 32-byte payload ‖ the rule-ids XDR — the
 * preimage space the message ceremony must stay out of.
 *
 * The "sign an arbitrary message" ceremony must NOT be able to produce a
 * signature over any such digest, or a message approval could be replayed as
 * a transaction/policy authorization. (The SDK's `computeAuthDigest` binds the
 * account address into `bound` on top of this, which only widens the gap.)
 */
describe('message-signing domain separation', () => {
  it('a message whose bytes form an auth-digest preimage cannot yield that digest', () => {
    // An attacker-chosen authorization: the 32-byte value the rule-id layer
    // hashes (on chain the account's `bound`; here we pick printable bytes so
    // the preimage round-trips losslessly through UTF-8, which is all an
    // exploit needs — the attacker grinds until its bytes are UTF-8-encodable).
    const signaturePayload = new Uint8Array(32).fill(0x41); // "AAAA…"
    const ruleIds = [7];

    // The rule-id layer's preimage: signature_payload ‖ ruleIds XDR.
    const idsXdr = ruleIdsXdr(ruleIds);
    const preimage = new Uint8Array(signaturePayload.length + idsXdr.length);
    preimage.set(signaturePayload);
    preimage.set(idsXdr, signaturePayload.length);
    const authDigest = new Uint8Array(hash(Buffer.from(preimage)));

    // The dApp hands the user a "message" that decodes to exactly that preimage.
    const message = Buffer.from(preimage).toString('utf-8');
    // Sanity: the message re-encodes to the preimage with no lossy characters,
    // so bare SHA-256 of it would equal the auth digest.
    expect(new Uint8Array(Buffer.from(message, 'utf-8'))).toEqual(preimage);

    // The message challenge must be domain-separated from the auth digest.
    expect(deriveMessageChallenge(message)).not.toEqual(authDigest);
  });

  it('is prefixed with a non-empty versioned domain tag', () => {
    expect(MESSAGE_SIGNING_DOMAIN.length).toBeGreaterThanOrEqual(16);
    // The domain tag is pure ASCII text, never XDR, so it cannot be the start
    // of a signature_payload ‖ rule-id preimage by construction.
    expect(/^[\x20-\x7e\n]+$/.test(MESSAGE_SIGNING_DOMAIN)).toBe(true);
  });

  it('is deterministic and binds the whole message', () => {
    expect(deriveMessageChallenge('hello')).toEqual(deriveMessageChallenge('hello'));
    expect(deriveMessageChallenge('hello')).not.toEqual(deriveMessageChallenge('hello '));
    expect(deriveMessageChallenge('hello')).toHaveLength(32);
  });
});
