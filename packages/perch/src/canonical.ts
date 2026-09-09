// Canonical JSON (RFC 8785 / JCS subset) and doc_hash — byte-identical to
// perch-ir's `canon.rs`. This is the whole point of the TS surface: the hash a
// reviewer approves off-chain must match what the Rust compiler and on-chain
// state commit to.
//
// The authoritative, versioned definition of these bytes is `CANONICAL.md` at
// the repo root; this file implements it. String escaping is implemented
// directly (`writeString`) rather than delegated to `JSON.stringify`, so the
// canonical form can never drift with a runtime's serializer.
//
// Parity notes (verified against testdata/ci-publish.*):
//  - Object keys are sorted by UTF-16 code units; JS `Array#sort` on strings
//    already does exactly this, matching Rust's `encode_utf16().cmp`.
//  - Numbers: every number in a PolicyDoc is a u32, so plain decimal (`String`)
//    matches; a non-integer is a bug and throws rather than emit an exponent.
//  - `undefined` fields are omitted; the canonical form never contains `null`.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Version of the canonical form implemented here, as defined by `CANONICAL.md`.
 * A format identifier, not part of the hash preimage — see the Rust
 * `CANON_VERSION` for the full rationale. Any change to the canonicalization
 * rules must bump this in lockstep with perch-ir.
 */
export const CANON_VERSION = 1;

const HEX = '0123456789abcdef';

/** Write `s` as a canonical JSON string literal per RFC 8785 §3.2.2.2 — the
 *  escaping table in `CANONICAL.md`, implemented directly (not `JSON.stringify`)
 *  so the bytes `doc_hash` commits to are defined here, not inherited. */
function writeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\b': out += '\\b'; break;
      case '\t': out += '\\t'; break;
      case '\n': out += '\\n'; break;
      case '\f': out += '\\f'; break;
      case '\r': out += '\\r'; break;
      default: {
        const code = ch.codePointAt(0)!;
        if (code < 0x20) {
          // Remaining C0 control chars: lowercase \u00xx (high byte 00).
          out += '\\u00' + HEX[(code >> 4) & 0xf] + HEX[code & 0xf];
        } else {
          out += ch;
        }
      }
    }
  }
  return out + '"';
}

function write(v: unknown): string {
  if (v === null) {
    // A PolicyDoc never carries null (absent optionals are omitted). Reaching
    // here means malformed input; fail closed rather than emit `null`.
    throw new Error('canonical form must not contain null');
  }
  switch (typeof v) {
    case 'string':
      return writeString(v);
    case 'number':
      if (!Number.isInteger(v)) throw new Error(`non-integer number in canonical form: ${v}`);
      return String(v);
    case 'boolean':
      return v ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(v)) return `[${v.map(write).join(',')}]`;
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${writeString(k)}:${write(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`unserializable value in canonical form: ${typeof v}`);
  }
}

/** Serialize a policy document to its canonical JSON form. */
export function canonicalJson(doc: unknown): string {
  return write(doc);
}

/** Lowercase-hex SHA-256 of the canonical JSON bytes — the document's identity. */
export function docHash(doc: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(doc))));
}
