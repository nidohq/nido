//! Small shared byte helpers for the `recoveryStage3` module — accepting
//! either a hex string (with or without `0x`) or raw bytes for 32-byte
//! contract fields (`target_doc_hash`, `baseline_doc_hash`, `root`,
//! `nullifier`, credential ids, ...), and normalizing to a `Buffer` (what
//! the generated bindings' `Spec.funcArgsToScVals` expects for `Bytes`/
//! `BytesN<N>` arguments).
import { Buffer } from 'buffer';

/** Normalizes a 32-byte field (hex string or bytes) to a `Buffer`. Throws on
 *  any other length — every contract field this module builds requiring
 *  this helper is a fixed `BytesN<32>`. */
export function toBytes32(input: Uint8Array | string, argName: string): Buffer {
  return toBytesN(input, 32, argName);
}

/** Normalizes a fixed-length byte field (hex string or bytes) to a `Buffer`. */
export function toBytesN(input: Uint8Array | string, length: number, argName: string): Buffer {
  if (typeof input === 'string') {
    const hex = input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
    if (hex.length !== length * 2) {
      throw new Error(`${argName}: expected a ${length}-byte (${length * 2} hex digit) string, got ${hex.length} digits`);
    }
    return Buffer.from(hex, 'hex');
  }
  if (input.length !== length) {
    throw new Error(`${argName}: expected ${length} bytes, got ${input.length}`);
  }
  return Buffer.from(input);
}

/** Normalizes arbitrary-length bytes (hex string or bytes) to a `Buffer` —
 *  for variable-length fields like `proof`. */
export function toBytes(input: Uint8Array | string): Buffer {
  if (typeof input === 'string') {
    const hex = input.startsWith('0x') || input.startsWith('0X') ? input.slice(2) : input;
    return Buffer.from(hex, 'hex');
  }
  return Buffer.from(input);
}
