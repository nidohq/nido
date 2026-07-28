import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  generateBackstopKey,
  keyCommitment,
  signDigest,
  verifyDigest,
  saveBackstopKey,
  loadBackstopKey,
  clearBackstopKey,
  ML_DSA_CONTEXT,
  PK_LEN,
  SIG_LEN,
  SEED_LEN,
  STORAGE_KEY,
  type KeyStore,
} from "./mlDsaBackstop.js";

const SEED = new Uint8Array(SEED_LEN).fill(7);
const DIGEST = new Uint8Array(32).fill(0xab);

function fakeStore(): KeyStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("generateBackstopKey", () => {
  it("is deterministic over the seed and matches the contract's sizes", () => {
    const a = generateBackstopKey(SEED, 123);
    const b = generateBackstopKey(SEED, 456);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.publicKey.length).toBe(PK_LEN);
    expect(a.commitment).toEqual(sha256(a.publicKey));
    expect(a.commitment.length).toBe(32);
    expect(a.createdAt).toBe(123);
  });

  it("draws a fresh random seed when none is given", () => {
    const a = generateBackstopKey();
    const b = generateBackstopKey();
    expect(a.seed).not.toEqual(b.seed);
    expect(a.seed.length).toBe(SEED_LEN);
  });

  it("rejects a wrong-length seed", () => {
    expect(() => generateBackstopKey(new Uint8Array(16))).toThrow(/32 bytes/);
  });
});

describe("sign/verify with the nido context", () => {
  it("round-trips a 32-byte digest", () => {
    const key = generateBackstopKey(SEED);
    const sig = signDigest(key.seed, DIGEST);
    expect(sig.length).toBe(SIG_LEN);
    expect(verifyDigest(sig, DIGEST, key.publicKey)).toBe(true);
  });

  it("binds the context: a context-less verify rejects the signature", () => {
    // The on-chain verifier passes SIG_CONTEXT to FIPS 204 — a signature is
    // only valid under that exact context. Sanity-check the context is
    // actually load-bearing, not decorative.
    const key = generateBackstopKey(SEED);
    const sig = signDigest(key.seed, DIGEST);
    expect(ml_dsa65.verify(sig, DIGEST, key.publicKey)).toBe(false);
    expect(ml_dsa65.verify(sig, DIGEST, key.publicKey, { context: ML_DSA_CONTEXT })).toBe(true);
  });

  it("rejects a tampered signature and a wrong digest", () => {
    const key = generateBackstopKey(SEED);
    const sig = signDigest(key.seed, DIGEST);
    const tampered = sig.slice();
    tampered[100] ^= 0x01;
    expect(verifyDigest(tampered, DIGEST, key.publicKey)).toBe(false);
    const otherDigest = new Uint8Array(32).fill(0xcd);
    expect(verifyDigest(sig, otherDigest, key.publicKey)).toBe(false);
  });
});

describe("storage round-trip", () => {
  it("save → load reproduces seed, public key, and commitment", () => {
    const store = fakeStore();
    const key = generateBackstopKey(SEED, 1234);
    saveBackstopKey(key, store);
    const loaded = loadBackstopKey(store);
    expect(loaded).not.toBeNull();
    expect(loaded!.seed).toEqual(key.seed);
    expect(loaded!.publicKey).toEqual(key.publicKey);
    expect(loaded!.commitment).toEqual(key.commitment);
    expect(loaded!.createdAt).toBe(1234);
  });

  it("returns null on absent, corrupt, or wrong-shaped records", () => {
    const store = fakeStore();
    expect(loadBackstopKey(store)).toBeNull();
    store.setItem(STORAGE_KEY, "not json {");
    expect(loadBackstopKey(store)).toBeNull();
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 1, seedHex: "abcd", publicKeyHex: "ff" }));
    expect(loadBackstopKey(store)).toBeNull();
  });

  it("clear removes the record", () => {
    const store = fakeStore();
    saveBackstopKey(generateBackstopKey(SEED), store);
    clearBackstopKey(store);
    expect(loadBackstopKey(store)).toBeNull();
  });
});
