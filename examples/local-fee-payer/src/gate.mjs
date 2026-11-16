import { b64, equal, sha256, utf8, verifyAssertion } from './webauthn.mjs';
import { C_ACCOUNT, NETWORK, authPayload, cloneFee, inspectC, rawSignFee } from './stellar.mjs';
import { decide } from './policy.mjs';

export async function feeChallenge(tx, nonce, expiresAt) {
  // Fixed ordered tuple; domain-separated from C's contract authorization.
  return sha256(utf8(JSON.stringify(['nido/fee-lab/v1', NETWORK, C_ACCOUNT, tx.feeSource, b64(tx.hash()), tx.fee, nonce, expiresAt])));
}

export class LocalGate {
  #issued = new Map();
  constructor({ cedar, key, feeAccount = key.publicKey, registration, now = () => Date.now() }) {
    this.cedar = cedar; this.key = key; this.feeAccount = feeAccount; this.registration = registration; this.now = now;
  }
  async prepare(tx, cAssertion) {
    if (tx.networkPassphrase !== NETWORK) throw Error('Wrong network');
    const frozenTx = cloneFee(tx);
    if (frozenTx.feeSource !== this.feeAccount || frozenTx.signatures.length) throw Error('Unexpected fee payer or existing fee signatures');
    const facts = inspectC(frozenTx);
    const publicKey = await verifyAssertion(cAssertion, this.registration, facts.challenge);
    if (!equal(facts.entry.credentials.address.signature.toXdr(), authPayload(cAssertion, publicKey).toXdr())) throw Error('Embedded C signature differs');
    const decision = decide(this.cedar, {
      credentialId: this.registration.credentialId, expectedCredentialId: this.registration.credentialId,
      feeAccount: frozenTx.feeSource, cAccount: facts.account, expectedC: C_ACCOUNT, feeStroops: facts.fee,
      passkeyVerified: true, cAuthorizationVerified: true,
    });
    // The fee assertion is verified below before signing. This preflight does not sign.
    if (!decision.allowed) throw Error('Cedar denied sponsorship');
    const nonce = b64(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = this.now() + 60000;
    const challenge = await feeChallenge(frozenTx, nonce, expiresAt);
    // The gate retains the exact immutable XDR; the UI cannot substitute another tx.
    this.#issued.set(nonce, { xdr: frozenTx.toXdr(), challenge, expiresAt, decision });
    return { nonce, challenge, expiresAt, fee: frozenTx.fee, decision };
  }
  async sign(nonce, feeAssertion) {
    const pending = this.#issued.get(nonce);
    if (!pending) throw Error('Unknown or consumed approval');
    this.#issued.delete(nonce); // Atomic before await: concurrent use cannot double-sign.
    if (this.now() >= pending.expiresAt) throw Error('Approval expired');
    await verifyAssertion(feeAssertion, this.registration, pending.challenge);
    if (this.now() >= pending.expiresAt) throw Error('Approval expired');
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    return rawSignFee(TransactionBuilder.fromXdr(pending.xdr, NETWORK), this.key);
  }
}
