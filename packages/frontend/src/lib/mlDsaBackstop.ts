/**
 * mlDsaBackstop.ts — post-quantum (ML-DSA-65 / FIPS 204) backstop key logic
 * for the demo at /security/pq-backstop/.
 *
 * Mirrors the on-chain `nido-ml-dsa-verifier` contract's format exactly:
 * - the signer's on-chain `key_data` is the 32-byte SHA-256 commitment to the
 *   1952-byte encoded public key (OZ caps external key data at 256 bytes);
 * - every signature binds the FIPS 204 domain-separation context
 *   `nido-mldsa-v1` — the contract verifies with the same context, so a
 *   signature made here is what `__check_auth` would accept.
 *
 * We persist the 32-byte keygen SEED, not the expanded 4032-byte secret key:
 * `ml_dsa65.keygen(seed)` is deterministic, so the seed fully determines the
 * keypair and is what a future mnemonic export (#145) would back up. Storage
 * is plain localStorage FOR THE DEMO ONLY — see issue #145 for why that is
 * not a custody answer (XSS-readable, evictable, single-device).
 */

import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** FIPS 204 context string — must match the contract's `SIG_CONTEXT`. */
export const ML_DSA_CONTEXT: Uint8Array = new TextEncoder().encode("nido-mldsa-v1");

export const SEED_LEN = 32;
/** ML-DSA-65 encoded public key length (bytes). */
export const PK_LEN = 1952;
/** ML-DSA-65 signature length (bytes). */
export const SIG_LEN = 3309;

/** localStorage slot for the demo backstop key record. */
export const STORAGE_KEY = "nido:mldsa-backstop:v1";

export interface BackstopKey {
  /** 32-byte keygen seed — the actual secret to protect. */
  seed: Uint8Array;
  /** 1952-byte encoded ML-DSA-65 public key. */
  publicKey: Uint8Array;
  /** 32-byte SHA-256 commitment to the public key = on-chain `key_data`. */
  commitment: Uint8Array;
  /** Unix ms when the key was generated (0 when unknown). */
  createdAt: number;
}

/** Subset of the Web Storage API the persistence helpers need (injectable in tests). */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The on-chain signer `key_data`: SHA-256 over the encoded public key. */
export function keyCommitment(publicKey: Uint8Array): Uint8Array {
  return sha256(publicKey);
}

/**
 * Generate a backstop keypair. Pass a fixed `seed` for deterministic output
 * (tests); omit it to draw 32 fresh CSPRNG bytes.
 */
export function generateBackstopKey(seed?: Uint8Array, now: number = Date.now()): BackstopKey {
  const s = seed ?? crypto.getRandomValues(new Uint8Array(SEED_LEN));
  if (s.length !== SEED_LEN) throw new Error(`seed must be ${SEED_LEN} bytes`);
  const { publicKey } = ml_dsa65.keygen(s);
  return { seed: s, publicKey, commitment: keyCommitment(publicKey), createdAt: now };
}

/** Sign a 32-byte digest (the Soroban auth payload shape) with the nido context. */
export function signDigest(seed: Uint8Array, digest: Uint8Array): Uint8Array {
  const { secretKey } = ml_dsa65.keygen(seed);
  return ml_dsa65.sign(digest, secretKey, { context: ML_DSA_CONTEXT });
}

/** Verify a signature the way the on-chain verifier would (same context). */
export function verifyDigest(
  sig: Uint8Array,
  digest: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ml_dsa65.verify(sig, digest, publicKey, { context: ML_DSA_CONTEXT });
}

interface StoredRecord {
  v: 1;
  seedHex: string;
  publicKeyHex: string;
  createdAt: number;
}

export function saveBackstopKey(key: BackstopKey, store: KeyStore): void {
  const record: StoredRecord = {
    v: 1,
    seedHex: bytesToHex(key.seed),
    publicKeyHex: bytesToHex(key.publicKey),
    createdAt: key.createdAt,
  };
  store.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** Load the stored key, or null when absent/corrupt (corrupt records are ignored, not thrown). */
export function loadBackstopKey(store: KeyStore): BackstopKey | null {
  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw) as Partial<StoredRecord>;
    if (record.v !== 1 || !record.seedHex || !record.publicKeyHex) return null;
    const seed = hexToBytes(record.seedHex);
    const publicKey = hexToBytes(record.publicKeyHex);
    if (seed.length !== SEED_LEN || publicKey.length !== PK_LEN) return null;
    return {
      seed,
      publicKey,
      commitment: keyCommitment(publicKey),
      createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearBackstopKey(store: KeyStore): void {
  store.removeItem(STORAGE_KEY);
}
