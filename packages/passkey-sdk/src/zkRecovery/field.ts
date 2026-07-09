//! Client-side BN254 scalar-field arithmetic and byte encodings for
//! ZK-recovery. This module must reproduce, byte-for-byte, the contract's
//! `contracts/zk-recovery/src/hash.rs` and `contracts/zk-recovery/src/
//! pool.rs:57-60` -- a mismatch here means a real proof's public inputs
//! will never match what the contract recomputes on-chain.

/** A canonical BN254 scalar-field element: `0 <= x < FIELD_ORDER`. */
export type Fr = bigint;

/**
 * BN254 scalar field order `r`, copied byte-for-byte from
 * `contracts/zk-recovery/src/pool.rs:57-60`'s `FIELD_ORDER_BE` array (the
 * hex/decimal forms are derived from these bytes, not transcribed
 * independently, so this can't drift from the contract by a transcription
 * error).
 */
export const FIELD_ORDER_BE: Uint8Array = new Uint8Array([
  0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
  0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
]);

/** BN254 scalar field order `r` as a bigint (`21888242871839275222246405745257275088548364400416034343698204186575808495617`). */
export const FIELD_ORDER: bigint = bytesToBigIntBE(FIELD_ORDER_BE);

/**
 * Domain-separation constants, identical to `contracts/zk-recovery/src/
 * hash.rs:23-26` and circuit `main.nr:6-9` (`DOM_X = BE(sha256(label)) mod
 * r`).
 */
export const DOM_LEAF: Fr = 0x10d2382af89f3c1732985422f0ba530d1dd0ed3066ecce5650b78f0c4ad8274an;
export const DOM_BIND: Fr = 0x14fa8513f19a07697a83cf582b40cb80bb2176f890614912553b81cdff71ec81n;
export const DOM_NULL: Fr = 0x138891cc07f52d2ec29e835298ae2120acd9573ec4a83c573885abf9710b73b2n;
export const DOM_AUTH: Fr = 0x2886eb8be3a3ff75b86ac004fdbe5c17fd2de6ab4fd416d38683a2e0e91d9906n;

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let x = 0n;
  for (const byte of bytes) {
    x = (x << 8n) | BigInt(byte);
  }
  return x;
}

/**
 * Interprets a 48-byte HKDF output block (`okm48`) as a 384-bit big-endian
 * integer and reduces it mod `r`. Used by M1/M2 secret derivation
 * (`derivation.ts`).
 */
export function reduce384(okm48: Uint8Array): Fr {
  if (okm48.length !== 48) {
    throw new Error(`reduce384: expected 48 bytes, got ${okm48.length}`);
  }
  return bytesToBigIntBE(okm48) % FIELD_ORDER;
}

/**
 * BE 16/16-byte split into two zero-extended 32-byte field elements, the
 * convention `main.nr`/`hash.rs::split16` uses for `acct_hi/lo`,
 * `ctrl_hi/lo`, `npass_hi/lo`, `pk_x_hi/lo`, `pk_y_hi/lo`: the 16 source
 * bytes sit in the LOW 16 bytes of each 32-byte BE field
 * (`hi = 0x00...00 || b32[0..16]`, `lo = 0x00...00 || b32[16..32]`).
 */
export function split16(b32: Uint8Array): [Fr, Fr] {
  if (b32.length !== 32) {
    throw new Error(`split16: expected 32 bytes, got ${b32.length}`);
  }
  const hi = bytesToBigIntBE(b32.subarray(0, 16));
  const lo = bytesToBigIntBE(b32.subarray(16, 32));
  return [hi, lo];
}

/**
 * BE-encodes `n` into the low 8 bytes of a field element (top 24 bytes
 * zero), matching `hash.rs::u256_from_u64` -- used for `action`, `nonce`,
 * `timelock_secs`, `pk_prefix`.
 */
export function u256FromU64(n: bigint | number): Fr {
  const x = typeof n === 'number' ? BigInt(n) : n;
  if (x < 0n || x > 0xffffffffffffffffn) {
    throw new Error(`u256FromU64: value out of u64 range: ${x}`);
  }
  return x;
}

/** BE-encodes a canonical field element `x` into a 32-byte array. */
export function fieldToBytes32(x: Fr): Uint8Array {
  if (x < 0n || x >= FIELD_ORDER) {
    throw new Error(`fieldToBytes32: value out of canonical range: ${x}`);
  }
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Parses a 32-byte BE array into a canonical field element, throwing if the
 * value is `>= r` -- mirrors `pool.rs::require_canonical`'s reject-not-
 * reduce policy for client-supplied field elements.
 */
export function bytesToFieldCanonical(b: Uint8Array): Fr {
  if (b.length !== 32) {
    throw new Error(`bytesToFieldCanonical: expected 32 bytes, got ${b.length}`);
  }
  const x = bytesToBigIntBE(b);
  if (x >= FIELD_ORDER) {
    throw new Error('bytesToFieldCanonical: value >= FIELD_ORDER (non-canonical)');
  }
  return x;
}
