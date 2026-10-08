/**
 * Multi-signer authorization payloads.
 *
 * The OZ v0.7 smart account verifies authorization against an
 * `AuthPayload { signers: Map<Signer, Bytes>, context_rule_ids: Vec<u32> }`.
 * For the primary-passkey flow there is a single `External` signer (see
 * `injectPasskeySignature` in `auth.ts`). Recovery completion needs MULTIPLE
 * signers in the same map:
 *
 *   - zero or one primary `External` passkey, and
 *   - one `Delegated(friend_account)` entry per friend whose signature counts
 *     toward the multisig-policy threshold.
 *
 * On-chain semantics (stellar-accounts `authenticate`):
 *
 *   match signer {
 *     External(verifier, key) => verifier.verify(auth_digest, key, sig_bytes),
 *     Delegated(addr)         => addr.require_auth_for_args((auth_digest,)),
 *   }
 *
 * Note the asymmetry: for a `Delegated` signer the `Bytes` value in the map is
 * IGNORED — authorization happens through a *nested* Soroban auth entry where
 * the friend's own account authorizes the args `(auth_digest,)`. So for
 * delegated signers we still need a map entry (the contract iterates the map
 * and calls `authenticate` on each, which is what triggers `require_auth`),
 * but its byte payload can be empty. The friend's real signature travels in
 * the auth tree's sub-invocation, assembled by `signFriendSubInvocation`.
 *
 * This module isolates the pure ScVal construction so it can be unit-tested
 * without a chain; the auth-tree wiring lives in the frontend's
 * `recoveryActions`.
 */

import { xdr } from '@stellar/stellar-sdk';
import { authPayloadXdr, type SignerKey } from '@stellar-registry/perch';
import type { PasskeySignature } from './types.js';

/** One signer to include in a multi-signer `AuthPayload`. */
export type SignerSignature =
  | {
      kind: 'external';
      /** WebAuthn verifier contract address. */
      verifierAddress: string;
      /** 65-byte SEC1 uncompressed P-256 public key. */
      publicKey: Uint8Array;
      /** Parsed assertion over the auth digest. */
      passkeySignature: PasskeySignature;
    }
  | {
      kind: 'delegated';
      /** The friend's smart-account address. */
      address: string;
      /**
       * Optional raw signature bytes. Ignored on-chain for `Delegated`
       * signers (authorization flows through the nested auth entry), so this
       * is left empty by default.
       */
      sigData?: Uint8Array;
    };

export interface AuthPayloadSpec {
  /** Per-context rule IDs, aligned by index with the auth contexts. */
  contextRuleIds: readonly number[];
  /** All signers to bundle into the payload's `signers` map. */
  signers: readonly SignerSignature[];
}

/** Encode the `WebAuthnSigData` struct an External signer's bytes carry. */
function webAuthnSigDataBytes(sig: PasskeySignature): Buffer {
  // Soroban struct → ScMap with Symbol keys in alphabetical order.
  const sigDataScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('authenticator_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(sig.authenticatorData)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('client_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(sig.clientDataJson)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(Buffer.from(sig.signature)),
    }),
  ]);
  return sigDataScVal.toXDR();
}

/** `s` as perch-js's signer key and signature bytes. A `Delegated`
 *  signer's bytes are ignored on chain (authorization flows through its own
 *  auth entry), so they default to empty. */
function toPerch(s: SignerSignature): { signer: SignerKey; signature: Uint8Array } {
  return s.kind === 'external'
    ? {
        signer: { kind: 'external', verifier: s.verifierAddress, key: s.publicKey },
        signature: webAuthnSigDataBytes(s.passkeySignature),
      }
    : { signer: { kind: 'delegated', address: s.address }, signature: s.sigData ?? new Uint8Array(0) };
}

/**
 * Construct the OZ v0.7 `AuthPayload` ScVal for one or more signers, as
 * perch-js's `authPayloadXdr` encodes it: an `ScMap` with Symbol keys
 * `context_rule_ids` and `signers`, the signers in the host's key order
 * (`Delegated` before `External`, then field by field), a repeated signer
 * refused. Set it as the credential signature of a
 * `SorobanAddressCredentials` entry.
 */
export function buildAuthPayloadScVal(spec: AuthPayloadSpec): xdr.ScVal {
  if (spec.signers.length === 0) {
    throw new Error('buildAuthPayloadScVal: at least one signer required');
  }
  const bytes = authPayloadXdr({
    contextRuleIds: [...spec.contextRuleIds],
    signers: spec.signers.map(toPerch),
  });
  return xdr.ScVal.fromXDR(Buffer.from(bytes));
}
