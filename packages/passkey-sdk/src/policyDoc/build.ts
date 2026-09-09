/**
 * Building perch PolicyDocs with nido conventions.
 *
 * Thin layer over `@stellar-registry/perch`'s request/builder surface:
 * WebAuthn passkey signers become `external(<webauthn verifier>, <pubkey>)`
 * declarations, delegated session keys become `delegated(G…)` (CAP-0071 —
 * the host authenticates the address inside the account's own auth entry).
 *
 * The raw perch builder (`policy()`, `external()`, `delegated()`, arg
 * predicates) is re-exported from this module's barrel for documents these
 * helpers don't cover.
 */

import { requestToPolicyDoc } from '@stellar-registry/perch';
import type {
  Permission,
  PolicyDoc,
  SignerDecl,
} from '@stellar-registry/perch';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { LoweredCap } from './types.js';

/** A signer under nido conventions, converted to a perch `SignerDecl` by
 *  {@link buildPolicyDoc}. */
export type NidoSigner =
  | {
      id: string;
      kind: 'passkey';
      /** WebAuthn verifier contract address (resolve via
       *  `fetchRegistryAddress('verifier')`). */
      verifier: string;
      /** SEC1 uncompressed P-256 public key (65 bytes) or its hex. */
      publicKey: Uint8Array | string;
    }
  | {
      id: string;
      kind: 'delegated';
      /** G… account or C… contract strkey, host-authenticated (CAP-0071). */
      address: string;
    };

function toSignerDecl(s: NidoSigner): SignerDecl {
  if (s.kind === 'passkey') {
    const key = typeof s.publicKey === 'string' ? s.publicKey : bytesToHex(s.publicKey);
    return { id: s.id, verifier: s.verifier, key };
  }
  return { id: s.id, address: s.address };
}

/**
 * Build a validated PolicyDoc from nido signers plus perch permissions
 * (each permission becomes one rule; `cap` is supported — see
 * `@stellar-registry/perch`'s `Permission`). Throws on any schema violation,
 * fail-closed.
 */
export function buildPolicyDoc(req: {
  network?: string;
  signers: NidoSigner[];
  permissions: Permission[];
}): PolicyDoc {
  return requestToPolicyDoc({
    ...(req.network !== undefined ? { network: req.network } : {}),
    signers: req.signers.map(toSignerDecl),
    permissions: req.permissions,
  });
}

/**
 * The v1 template: a scoped session key — one delegated signer restricted to
 * one contract's named functions, with an expiry, optionally composed with a
 * cumulative spending cap (which lowers onto the stock spending-limit policy
 * as a sibling of the interpreter on the same context rule).
 */
export interface ScopedSessionKeyDocOptions {
  /** The delegated session key (G… account strkey). */
  sessionAddress: string;
  /** The one contract the key may call. */
  targetContract: string;
  /** Allowed function names on that contract; omit for "any function". */
  functions?: string[];
  /** First ledger at/after which the permission stops (exclusive bound). */
  notAfterLedger?: number;
  /** Cumulative spending cap over a rolling window. */
  cap?: LoweredCap;
  /** Network passphrase to bind the doc to. */
  network?: string;
  /** Rule name (defaults to "session"). */
  name?: string;
  /** Signer id in the doc (defaults to "session"). */
  signerId?: string;
}

/** Build the v1 scoped-session-key document. */
export function scopedSessionKeyDoc(opts: ScopedSessionKeyDocOptions): PolicyDoc {
  const signerId = opts.signerId ?? 'session';
  return buildPolicyDoc({
    ...(opts.network !== undefined ? { network: opts.network } : {}),
    signers: [{ id: signerId, kind: 'delegated', address: opts.sessionAddress }],
    permissions: [
      {
        name: opts.name ?? 'session',
        on: { contract: opts.targetContract },
        by: [signerId],
        ...(opts.functions !== undefined ? { functions: opts.functions } : {}),
        ...(opts.notAfterLedger !== undefined ? { until: opts.notAfterLedger } : {}),
        ...(opts.cap !== undefined
          ? {
              cap: {
                limit: opts.cap.limitStroops.toString(),
                'period-ledgers': opts.cap.periodLedgers,
              },
            }
          : {}),
      },
    ],
  });
}
