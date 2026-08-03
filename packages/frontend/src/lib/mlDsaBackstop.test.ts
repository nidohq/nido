import { describe, it, expect } from "vitest";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  generateBackstopKey,
  keyCommitment,
  signDigest,
  verifyDigest,
  saveBackstopKey,
  saveProtectedKey,
  loadBackstopKey,
  clearBackstopKey,
  unlockSeed,
  wrapSeed,
  unwrapSeed,
  seedToMnemonic,
  mnemonicToSeed,
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
    expect(a.seed!).not.toEqual(b.seed!);
    expect(a.seed!.length).toBe(SEED_LEN);
  });

  it("rejects a wrong-length seed", () => {
    expect(() => generateBackstopKey(new Uint8Array(16))).toThrow(/32 bytes/);
  });
});

describe("sign/verify with the nido context", () => {
  it("round-trips a 32-byte digest", () => {
    const key = generateBackstopKey(SEED);
    const sig = signDigest(key.seed!, DIGEST);
    expect(sig.length).toBe(SIG_LEN);
    expect(verifyDigest(sig, DIGEST, key.publicKey)).toBe(true);
  });

  it("binds the context: a context-less verify rejects the signature", () => {
    // The on-chain verifier passes SIG_CONTEXT to FIPS 204 — a signature is
    // only valid under that exact context. Sanity-check the context is
    // actually load-bearing, not decorative.
    const key = generateBackstopKey(SEED);
    const sig = signDigest(key.seed!, DIGEST);
    expect(ml_dsa65.verify(sig, DIGEST, key.publicKey)).toBe(false);
    expect(ml_dsa65.verify(sig, DIGEST, key.publicKey, { context: ML_DSA_CONTEXT })).toBe(true);
  });

  it("rejects a tampered signature and a wrong digest", () => {
    const key = generateBackstopKey(SEED);
    const sig = signDigest(key.seed!, DIGEST);
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

  it("marks a plain key as protection 'plain', and reads a legacy (mode-less) record as plain", () => {
    const store = fakeStore();
    const key = generateBackstopKey(SEED, 1);
    expect(key.protection).toBe("plain");
    // Legacy record written before the `mode` field existed.
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        seedHex: Array.from(key.seed!, (b) => b.toString(16).padStart(2, "0")).join(""),
        publicKeyHex: Array.from(key.publicKey, (b) => b.toString(16).padStart(2, "0")).join(""),
        createdAt: 1,
      }),
    );
    const loaded = loadBackstopKey(store)!;
    expect(loaded.protection).toBe("plain");
    expect(loaded.seed).toEqual(key.seed);
  });
});

describe("mnemonic backup", () => {
  it("round-trips the seed through a 24-word phrase", () => {
    const key = generateBackstopKey(SEED);
    const phrase = seedToMnemonic(key.seed!);
    expect(phrase.split(" ")).toHaveLength(24);
    expect(mnemonicToSeed(phrase)).toEqual(key.seed);
  });

  it("tolerates surrounding/extra whitespace and rejects a bad phrase", () => {
    const phrase = seedToMnemonic(new Uint8Array(SEED_LEN).fill(3));
    expect(mnemonicToSeed(`   ${phrase.replace(/ /g, "  ")}  `)).toEqual(
      new Uint8Array(SEED_LEN).fill(3),
    );
    expect(() => mnemonicToSeed("not a valid phrase at all")).toThrow(/Invalid recovery phrase/);
  });
});

describe("at-rest encryption (PRF-derived key)", () => {
  const PRF = new Uint8Array(32).fill(0x5a);

  it("wrap → unwrap round-trips the seed with the right secret", async () => {
    const salt = new Uint8Array(32).fill(1);
    const credId = new Uint8Array(16).fill(2);
    const wrapped = await wrapSeed(SEED, PRF, salt, credId);
    expect(wrapped.ciphertext).not.toEqual(SEED); // actually encrypted
    expect(wrapped.salt).toEqual(salt);
    expect(wrapped.credentialId).toEqual(credId);
    expect(await unwrapSeed(wrapped, PRF)).toEqual(SEED);
  });

  it("unwrap fails (AES-GCM auth) with the wrong secret", async () => {
    const wrapped = await wrapSeed(SEED, PRF, new Uint8Array(32), new Uint8Array(16));
    const wrongPrf = new Uint8Array(32).fill(0x99);
    await expect(unwrapSeed(wrapped, wrongPrf)).rejects.toBeTruthy();
  });

  it("passkey record persists no plaintext seed and unlocks with the PRF secret", async () => {
    const store = fakeStore();
    const key = generateBackstopKey(SEED, 7);
    const salt = new Uint8Array(32).fill(4);
    const credId = new Uint8Array(16).fill(5);
    const wrapped = await wrapSeed(key.seed!, PRF, salt, credId);
    saveProtectedKey(key.publicKey, wrapped, key.createdAt, store);

    // The serialized record must not contain the raw seed hex.
    expect(store.map.get(STORAGE_KEY)).not.toContain(
      Array.from(SEED, (b) => b.toString(16).padStart(2, "0")).join(""),
    );

    const loaded = loadBackstopKey(store)!;
    expect(loaded.protection).toBe("passkey");
    expect(loaded.seed).toBeUndefined();
    expect(loaded.publicKey).toEqual(key.publicKey);
    expect(loaded.commitment).toEqual(key.commitment);

    // Unlock with the injected PRF secret (bypasses the navigator ceremony).
    const seed = await unlockSeed(loaded, { prfOutput: PRF });
    expect(seed).toEqual(SEED);
    // And that seed reproduces valid signatures.
    const sig = signDigest(seed, DIGEST);
    expect(verifyDigest(sig, DIGEST, loaded.publicKey)).toBe(true);
  });

  it("unlockSeed falls back to a ceremony when a supplied prfOutput is wrong", async () => {
    // A wrong ride-along secret (e.g. from a rotated credential) must not fail
    // closed: unlockSeed should try its own ceremony. Here the credential is
    // absent (no navigator), so the fallback surfaces the recovery-phrase error
    // rather than the raw AES-GCM failure — proving it reached the fallback.
    const store = fakeStore();
    const key = generateBackstopKey(SEED, 1);
    const wrapped = await wrapSeed(key.seed!, PRF, new Uint8Array(32).fill(9), new Uint8Array(16).fill(8));
    saveProtectedKey(key.publicKey, wrapped, key.createdAt, store);
    const loaded = loadBackstopKey(store)!;
    const wrongPrf = new Uint8Array(32).fill(0x01);
    await expect(unlockSeed(loaded, { prfOutput: wrongPrf })).rejects.toThrow(/recovery phrase|passkey/i);
  });
});
