/**
 * ML-DSA (post-quantum backstop) auth-payload helpers.
 *
 * The nido-ml-dsa-verifier contract's SigData is the XDR of
 * `#[contracttype] MlDsaSigData { public_key: Bytes, signature: Bytes }`,
 * and its on-chain signer key_data is the 32-byte SHA-256 commitment to the
 * 1952-byte public key. These helpers mirror `injectPasskeySignature` for a
 * signature produced locally with an ML-DSA key (no WebAuthn ceremony) —
 * the caller signs `computeAuthDigest(payload, contextRuleIds)` with FIPS
 * 204 context `nido-mldsa-v1` and hands the raw signature here.
 */

import { xdr, type Operation } from '@stellar/stellar-sdk';
import { injectSignedAuthPayload } from './auth.js';

/** ML-DSA-65 encoded public key length (bytes). */
export const ML_DSA_PK_LEN = 1952;
/** ML-DSA-65 signature length (bytes). */
export const ML_DSA_SIG_LEN = 3309;

/**
 * Encode `MlDsaSigData { public_key, signature }` the way the contract's
 * `from_xdr` expects: an ScMap with Symbol keys in alphabetical order
 * (`public_key` < `signature`), serialized to XDR bytes.
 *
 * Lengths are asserted up front — the contract TRAPS on undecodable
 * sig_data rather than returning false, so malformed input must never
 * reach the wire.
 */
export function encodeMlDsaSigData(publicKey: Uint8Array, signature: Uint8Array): Buffer {
  if (publicKey.length !== ML_DSA_PK_LEN) {
    throw new Error(`ML-DSA public key must be ${ML_DSA_PK_LEN} bytes, got ${publicKey.length}`);
  }
  if (signature.length !== ML_DSA_SIG_LEN) {
    throw new Error(`ML-DSA signature must be ${ML_DSA_SIG_LEN} bytes, got ${signature.length}`);
  }
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('public_key'),
      val: xdr.ScVal.scvBytes(Buffer.from(publicKey)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(Buffer.from(signature)),
    }),
  ]).toXDR();
}

export interface MlDsaSignature {
  /** ML-DSA verifier contract address. */
  verifierAddress: string;
  /** 32-byte SHA-256 commitment to the public key (on-chain key_data). */
  commitment: Uint8Array;
  /** 1952-byte encoded ML-DSA-65 public key. */
  publicKey: Uint8Array;
  /** 3309-byte signature over the auth digest (context `nido-mldsa-v1`). */
  signature: Uint8Array;
}

/**
 * Inject an ML-DSA-signed `AuthPayload` into the transaction's first auth
 * entry — the ML-DSA twin of `injectPasskeySignature`. The SAME
 * `contextRuleIds` (the backstop rule id) and expiration offset must have
 * been used when computing the signed digest.
 */
export function injectMlDsaSignature(
  transaction: { operations: readonly Operation[] },
  mlDsaSignature: MlDsaSignature,
  lastLedger: number,
  expirationLedgerOffset?: number,
  contextRuleIds: readonly number[] = [0],
): void {
  injectSignedAuthPayload(
    transaction,
    [
      {
        kind: 'external-bytes',
        verifierAddress: mlDsaSignature.verifierAddress,
        keyData: mlDsaSignature.commitment,
        sigData: encodeMlDsaSigData(mlDsaSignature.publicKey, mlDsaSignature.signature),
      },
    ],
    lastLedger,
    expirationLedgerOffset,
    contextRuleIds,
  );
}
