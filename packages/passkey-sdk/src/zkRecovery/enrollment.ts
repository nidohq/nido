//! Client-side enrollment commitments for the ZK-recovery pool. This module
//! deliberately submits the `inner` leaf only -- the DOM_BIND account wrap
//! (`authHash.ts::wrapLeafStored`) is applied ON-CHAIN by the pool at
//! insert time (`insert_for`/legacy `insert`), never here. Pre-wrapping and
//! submitting `stored` instead of `inner` would silently double-wrap on
//! insert and desync every downstream Merkle path/root computation.
import { sha256 } from '@noble/hashes/sha2.js';
import { FIELD_ORDER, fieldToBytes32, type Fr } from './field.js';
import { wrapLeafInner } from './authHash.js';

const encoder = new TextEncoder();

/**
 * The `inner` leaf commitment for a fresh enrollment (`P2_2(DOM_LEAF,
 * secret)`, `fieldToBytes32`-encoded). This is what the SDK submits to the
 * pool's `insert`/`insert_for` -- the pool wraps it with `DOM_BIND` and the
 * target account on-chain (`wrapLeafStored`); the SDK must never compute or
 * submit that wrap itself.
 */
export function commitmentForCreation(secret: Fr): Uint8Array {
  return fieldToBytes32(wrapLeafInner(secret));
}

/**
 * Deterministic dummy commitment for the legacy `create_account` path,
 * byte-matching the factory's `dummy_commitment` EXACTLY
 * (`contracts/factory/src/contract.rs:266-277`):
 * `preimage = utf8("nido-zk-dummy") || salt(32B)`; `digest = sha256(preimage)`;
 * `value = U256::from_be_bytes(digest)`; `reduced = value.rem_euclid(r)`;
 * output = 32-byte BE of `reduced`. A skipped-enrollment client computing
 * this independently must agree byte-for-byte with the factory's on-chain
 * computation.
 */
export function dummyCommitment(saltBytes: Uint8Array): Uint8Array {
  if (saltBytes.length !== 32) {
    throw new Error(`dummyCommitment: expected 32-byte salt, got ${saltBytes.length}`);
  }
  const preimage = new Uint8Array(13 + 32);
  preimage.set(encoder.encode('nido-zk-dummy'), 0);
  preimage.set(saltBytes, 13);
  const digest = sha256(preimage);

  let value = 0n;
  for (const byte of digest) {
    value = (value << 8n) | BigInt(byte);
  }
  const reduced = value % FIELD_ORDER;
  return fieldToBytes32(reduced);
}

/** Enrollment commitment produced for a migrating (new-wasm) account. */
export interface MigrationEnroll {
  commitment: Uint8Array;
}

/**
 * Builds the `insert_for` commitment for a migrating account. The
 * commitment is the same `inner` leaf `commitmentForCreation` produces --
 * the pool wraps it to `account` (DOM_BIND) on-chain, so `account` here is
 * documentation of intent only, not an input to this computation.
 */
export function buildMigrationEnroll(account: string, secret: Fr): MigrationEnroll {
  void account;
  return { commitment: commitmentForCreation(secret) };
}
