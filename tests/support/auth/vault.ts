import { p256 } from '@noble/curves/nist.js';

const enc = new TextEncoder();

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

/** Stable 32-byte credential id for a logical test identity. */
export async function credentialIdForLabel(
  seed: Uint8Array,
  label: string,
): Promise<Uint8Array> {
  return sha256(seed, enc.encode(`g2c-test-cred:${label}`));
}

/**
 * Private scalar derived purely from (seed, credentialId). Because `get()`
 * re-derives from the credentialId it receives, the vault needs no shared
 * mutable state across pages/origins.
 */
export async function privateKeyForCredentialId(
  seed: Uint8Array,
  credentialId: Uint8Array,
): Promise<Uint8Array> {
  let d = await sha256(seed, credentialId);
  // For P-256 essentially every 32-byte value is a valid scalar; loop is a
  // safety net for the negligible out-of-range case.
  while (!p256.utils.isValidSecretKey(d)) {
    d = await sha256(d);
  }
  return d;
}

/** 65-byte uncompressed P-256 public key (0x04 || x || y). */
export function publicKeyFromPrivate(d: Uint8Array): Uint8Array {
  return p256.getPublicKey(d, false);
}
