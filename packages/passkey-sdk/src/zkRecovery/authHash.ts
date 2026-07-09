//! Client-side reconstruction of the `zk_recovery` circuit's Poseidon2
//! commitments (leaf wrap, nullifier, `auth_hash`) -- the TypeScript twin of
//! `contracts/zk-recovery/src/hash.rs`. This module must reproduce the
//! circuit's/contract's field elements exactly, or a real proof's public
//! inputs will never match what the contract recomputes on-chain (see
//! `authHash.test.ts`'s pinned `hash.rs` fixture, the parity gate for this
//! file -- a mismatch there is a HARD STOP, not something to fudge).
import { sha256 } from '@noble/hashes/sha2.js';
import { DOM_LEAF, DOM_BIND, DOM_NULL, DOM_AUTH, split16, u256FromU64, type Fr } from './field.js';
import { p2 } from './poseidon.js';

const encoder = new TextEncoder();

/**
 * `inner = P2_2(DOM_LEAF, secret)` (`main.nr:36`, `hash.rs::leaf_inner`).
 * This is the commitment the SDK submits at enrollment (`insert_for`) --
 * the pool wraps it with `DOM_BIND` on-chain (`wrapLeafStored` mirrors that
 * wrap for client-side path/root computation only, never for submission).
 */
export function wrapLeafInner(secret: Fr): Fr {
  return p2([DOM_LEAF, secret]);
}

/**
 * `stored = P2_4(DOM_BIND, acct_hi, acct_lo, inner)` (`main.nr:37`,
 * `hash.rs::wrap_leaf`) -- the leaf value the tree actually stores. On-chain
 * this wrap is computed BY THE POOL at insert time, not submitted by the
 * client; this function exists so the SDK can independently derive the same
 * leaf value for local path/root computation (`merkle.ts`) and test parity.
 */
export function wrapLeafStored(accountId32: Uint8Array, inner: Fr): Fr {
  const [acctHi, acctLo] = split16(accountId32);
  return p2([DOM_BIND, acctHi, acctLo, inner]);
}

/**
 * `N = P2_4(DOM_NULL, acct_hi, acct_lo, secret)` (`main.nr:39`,
 * `hash.rs::compute_nullifier`) -- the nullifier the SDK submits as a public
 * input alongside a recovery proof.
 */
export function computeNullifier(accountId32: Uint8Array, secret: Fr): Fr {
  const [acctHi, acctLo] = split16(accountId32);
  return p2([DOM_NULL, acctHi, acctLo, secret]);
}

/** `computeAuthHash` parameters -- one recovery-affecting call's full context. */
export interface AuthHashParams {
  /** 1 = initiate, 2 = cancel, 3 = revoke. */
  action: 1 | 2 | 3;
  accountId32: Uint8Array;
  networkPassphrase: string;
  controllerId32: Uint8Array;
  /**
   * 65-byte uncompressed secp256r1 pubkey (`0x04 || x(32) || y(32)`), or
   * `null` for actions 2/3 (cancel/revoke), which carry no new key.
   */
  newPubkey65: Uint8Array | null;
  nonce: bigint;
  timelockSecs: number;
}

/**
 * `auth_hash = P2_15(DOM_AUTH, action, acct_hi, acct_lo, npass_hi, npass_lo,
 * ctrl_hi, ctrl_lo, pk_prefix, pk_x_hi, pk_x_lo, pk_y_hi, pk_y_lo, nonce,
 * timelock_secs)` (`main.nr:40-42`, `hash.rs::compute_auth_hash`) -- the
 * controller's canonicalization recompute. Field order here is EXACT and
 * load-bearing: any reordering silently produces a different (wrong)
 * `auth_hash` that still "looks like" a valid field element, so a mismatch
 * would only surface as an on-chain verification failure, not a type error.
 */
export function computeAuthHash(p: AuthHashParams): Fr {
  const domAuth = DOM_AUTH;
  const actionF = u256FromU64(p.action);
  const [acctHi, acctLo] = split16(p.accountId32);

  const npassHash = sha256(encoder.encode(p.networkPassphrase));
  const [npassHi, npassLo] = split16(npassHash);

  const [ctrlHi, ctrlLo] = split16(p.controllerId32);

  let pkPrefix: Fr = 0n;
  let pkXHi: Fr = 0n;
  let pkXLo: Fr = 0n;
  let pkYHi: Fr = 0n;
  let pkYLo: Fr = 0n;
  if (p.newPubkey65 !== null) {
    if (p.newPubkey65.length !== 65) {
      throw new Error(
        `computeAuthHash: newPubkey65 must be 65 bytes, got ${p.newPubkey65.length}`,
      );
    }
    pkPrefix = u256FromU64(p.newPubkey65[0]);
    const pkX = p.newPubkey65.subarray(1, 33);
    const pkY = p.newPubkey65.subarray(33, 65);
    [pkXHi, pkXLo] = split16(pkX);
    [pkYHi, pkYLo] = split16(pkY);
  }

  const nonceF = u256FromU64(p.nonce);
  const timelockF = u256FromU64(p.timelockSecs);

  return p2([
    domAuth,
    actionF,
    acctHi,
    acctLo,
    npassHi,
    npassLo,
    ctrlHi,
    ctrlLo,
    pkPrefix,
    pkXHi,
    pkXLo,
    pkYHi,
    pkYLo,
    nonceF,
    timelockF,
  ]);
}

