import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { DOM_LEAF, FIELD_ORDER, fieldToBytes32 } from './field.js';
import { p2 } from './poseidon.js';
import { commitmentForCreation, dummyCommitment, buildMigrationEnroll } from './enrollment.js';

// M1 lifecycle fixture (same secret/leaf_stored pinned in authHash.test.ts,
// copied verbatim from `contracts/zk-recovery/src/hash.rs`'s
// `#[cfg(test)] mod tests`). LEAF_STORED is the DOM_BIND-*wrapped* value the
// pool stores on-chain -- the SDK must never submit this, only the `inner`.
const SECRET = BigInt(
  '0x00000000000000000000000000000000d80e5c7596cf3ed7868f8bc89b6cf93c',
);
const LEAF_STORED_HEX = '27cfe62058beb8e80b7c27b5b43225643b3b062f300c3bd28f41ddd20de50880';

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

describe('commitmentForCreation', () => {
  it('equals fieldToBytes32(P2_2(DOM_LEAF, secret)) -- the inner leaf', () => {
    const expected = fieldToBytes32(p2([DOM_LEAF, SECRET]));
    expect(toHex(commitmentForCreation(SECRET))).toBe(toHex(expected));
  });

  it('does NOT equal the DOM_BIND-wrapped LEAF_STORED value (SDK never pre-wraps)', () => {
    expect(toHex(commitmentForCreation(SECRET))).not.toBe(LEAF_STORED_HEX);
  });
});

describe('dummyCommitment', () => {
  const SALT = new Uint8Array(32).fill(0x42);

  it('equals sha256("nido-zk-dummy" || salt) mod r, byte-matching the factory formula', () => {
    const preimage = new Uint8Array(13 + 32);
    preimage.set(new TextEncoder().encode('nido-zk-dummy'), 0);
    preimage.set(SALT, 13);
    const digest = sha256(preimage);
    let value = 0n;
    for (const byte of digest) {
      value = (value << 8n) | BigInt(byte);
    }
    const reduced = value % FIELD_ORDER;
    const expected = fieldToBytes32(reduced);

    expect(toHex(dummyCommitment(SALT))).toBe(toHex(expected));
  });

  it('is canonical (< FIELD_ORDER)', () => {
    const got = dummyCommitment(SALT);
    let value = 0n;
    for (const byte of got) {
      value = (value << 8n) | BigInt(byte);
    }
    expect(value < FIELD_ORDER).toBe(true);
  });
});

describe('buildMigrationEnroll', () => {
  it('returns the same inner commitment as commitmentForCreation (pool wraps to account on-chain)', () => {
    const account = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const { commitment } = buildMigrationEnroll(account, SECRET);
    expect(toHex(commitment)).toBe(toHex(commitmentForCreation(SECRET)));
  });
});
