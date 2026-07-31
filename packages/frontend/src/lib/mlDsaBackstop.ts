/**
 * mlDsaBackstop.ts — post-quantum (ML-DSA-65 / FIPS 204) backstop key logic.
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
 * keypair.
 *
 * ## Custody (issue #145)
 * The seed can be stored two ways:
 * - `plain`  — raw seed in localStorage. XSS-readable and evictable; the
 *   dev-preview default and the fallback when passkey protection isn't
 *   available.
 * - `passkey` — the seed is AES-GCM encrypted at rest under a key derived (via
 *   HKDF) from a WebAuthn PRF secret. The PRF secret only materialises during
 *   a passkey ceremony, so XSS can no longer read the seed passively — only
 *   during an unlocked window. The 1952-byte public key stays cleartext, so
 *   enrollment status and the on-chain commitment are still readable without a
 *   ceremony; only *signing* needs an unlock.
 *
 * Because passkey protection re-couples the seed to the very passkey the
 * backstop hedges against, a mnemonic export (`seedToMnemonic`) is the
 * device-independent backup and the only recovery path if the passkey is lost.
 */

import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** FIPS 204 context string — must match the contract's `SIG_CONTEXT`. */
export const ML_DSA_CONTEXT: Uint8Array = new TextEncoder().encode("nido-mldsa-v1");

export const SEED_LEN = 32;
/** ML-DSA-65 encoded public key length (bytes). */
export const PK_LEN = 1952;
/** ML-DSA-65 signature length (bytes). */
export const SIG_LEN = 3309;

/** localStorage slot for the backstop key record. */
export const STORAGE_KEY = "nido:mldsa-backstop:v1";

/** HKDF `info` binding the derived AES key to this purpose. */
const HKDF_INFO = new TextEncoder().encode("nido-mldsa-seed-wrap-v1");

export type Protection = "plain" | "passkey";

/** The seed encrypted at rest under a passkey-derived key. */
export interface WrappedSeed {
  /** AES-GCM ciphertext of the 32-byte seed. */
  ciphertext: Uint8Array;
  /** 12-byte AES-GCM IV. */
  iv: Uint8Array;
  /** PRF `eval.first` input — the WebAuthn secret is a function of it. */
  salt: Uint8Array;
  /** The passkey credential the seed is encrypted against. */
  credentialId: Uint8Array;
}

export interface BackstopKey {
  /** 1952-byte encoded ML-DSA-65 public key (always cleartext). */
  publicKey: Uint8Array;
  /** 32-byte SHA-256 commitment to the public key = on-chain `key_data`. */
  commitment: Uint8Array;
  /** Unix ms when the key was generated (0 when unknown). */
  createdAt: number;
  /** How the seed is stored. */
  protection: Protection;
  /** Present only for `plain` protection — the raw 32-byte seed. */
  seed?: Uint8Array;
  /** Present only for `passkey` protection — the encrypted seed. */
  wrapped?: WrappedSeed;
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
 * Generate a backstop keypair (unprotected). Pass a fixed `seed` for
 * deterministic output (tests); omit it to draw 32 fresh CSPRNG bytes.
 */
export function generateBackstopKey(seed?: Uint8Array, now: number = Date.now()): BackstopKey {
  const s = seed ?? crypto.getRandomValues(new Uint8Array(SEED_LEN));
  if (s.length !== SEED_LEN) throw new Error(`seed must be ${SEED_LEN} bytes`);
  const { publicKey } = ml_dsa65.keygen(s);
  return {
    publicKey,
    commitment: keyCommitment(publicKey),
    createdAt: now,
    protection: "plain",
    seed: s,
  };
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

// --- mnemonic backup --------------------------------------------------

/** 24-word BIP39 mnemonic encoding the 32-byte seed (the offline backup). */
export function seedToMnemonic(seed: Uint8Array): string {
  if (seed.length !== SEED_LEN) throw new Error(`seed must be ${SEED_LEN} bytes`);
  return entropyToMnemonic(seed, wordlist);
}

/** Recover a seed from its mnemonic. Throws on an invalid phrase. */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  const trimmed = mnemonic.trim().replace(/\s+/g, " ");
  if (!validateMnemonic(trimmed, wordlist)) {
    throw new Error("Invalid recovery phrase.");
  }
  const seed = mnemonicToEntropy(trimmed, wordlist);
  if (seed.length !== SEED_LEN) {
    throw new Error(`recovery phrase must encode ${SEED_LEN} bytes`);
  }
  return seed;
}

// --- at-rest encryption (pure WebCrypto; PRF output injected) ----------

/** Derive the AES-GCM key from a 32-byte PRF secret via HKDF-SHA256. */
async function aesKeyFromPrf(prfOutput: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", toBuf(prfOutput), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: toBuf(HKDF_INFO) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a seed under a PRF secret. `salt`/`credentialId` are carried into
 *  the stored record so the same secret can be re-derived to decrypt. */
export async function wrapSeed(
  seed: Uint8Array,
  prfOutput: Uint8Array,
  salt: Uint8Array,
  credentialId: Uint8Array,
): Promise<WrappedSeed> {
  const key = await aesKeyFromPrf(prfOutput);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toBuf(iv) }, key, toBuf(seed));
  return { ciphertext: new Uint8Array(ct), iv, salt, credentialId };
}

/** Decrypt a wrapped seed given the re-derived PRF secret. Throws (AES-GCM
 *  auth failure) if the secret is wrong. */
export async function unwrapSeed(wrapped: WrappedSeed, prfOutput: Uint8Array): Promise<Uint8Array> {
  const key = await aesKeyFromPrf(prfOutput);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBuf(wrapped.iv) },
    key,
    toBuf(wrapped.ciphertext),
  );
  const seed = new Uint8Array(pt);
  if (seed.length !== SEED_LEN) throw new Error("decrypted seed has wrong length");
  return seed;
}

// --- storage ----------------------------------------------------------

interface PlainRecord {
  v: 1;
  mode?: "plain";
  seedHex: string;
  publicKeyHex: string;
  createdAt: number;
}
interface PasskeyRecord {
  v: 1;
  mode: "passkey";
  ciphertextHex: string;
  ivHex: string;
  saltHex: string;
  credentialIdHex: string;
  publicKeyHex: string;
  createdAt: number;
}
type StoredRecord = PlainRecord | PasskeyRecord;

/** Persist an unprotected (plain-seed) key. */
export function saveBackstopKey(key: BackstopKey, store: KeyStore): void {
  if (!key.seed) throw new Error("saveBackstopKey requires a plaintext seed");
  const record: PlainRecord = {
    v: 1,
    mode: "plain",
    seedHex: bytesToHex(key.seed),
    publicKeyHex: bytesToHex(key.publicKey),
    createdAt: key.createdAt,
  };
  store.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** Persist a passkey-encrypted key (seed never written in the clear). */
export function saveProtectedKey(
  publicKey: Uint8Array,
  wrapped: WrappedSeed,
  createdAt: number,
  store: KeyStore,
): void {
  const record: PasskeyRecord = {
    v: 1,
    mode: "passkey",
    ciphertextHex: bytesToHex(wrapped.ciphertext),
    ivHex: bytesToHex(wrapped.iv),
    saltHex: bytesToHex(wrapped.salt),
    credentialIdHex: bytesToHex(wrapped.credentialId),
    publicKeyHex: bytesToHex(publicKey),
    createdAt,
  };
  store.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** Load the stored key metadata, or null when absent/corrupt. For `passkey`
 *  protection the seed is NOT returned — call `unlockSeed` to decrypt it. */
export function loadBackstopKey(store: KeyStore): BackstopKey | null {
  const raw = store.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw) as StoredRecord;
    if (record.v !== 1 || !record.publicKeyHex) return null;
    const publicKey = hexToBytes(record.publicKeyHex);
    if (publicKey.length !== PK_LEN) return null;
    const createdAt = typeof record.createdAt === "number" ? record.createdAt : 0;
    const base = { publicKey, commitment: keyCommitment(publicKey), createdAt };

    if (record.mode === "passkey") {
      if (!record.ciphertextHex || !record.ivHex || !record.saltHex || !record.credentialIdHex) {
        return null;
      }
      return {
        ...base,
        protection: "passkey",
        wrapped: {
          ciphertext: hexToBytes(record.ciphertextHex),
          iv: hexToBytes(record.ivHex),
          salt: hexToBytes(record.saltHex),
          credentialId: hexToBytes(record.credentialIdHex),
        },
      };
    }

    // Plain (or legacy record with no `mode`).
    if (!record.seedHex) return null;
    const seed = hexToBytes(record.seedHex);
    if (seed.length !== SEED_LEN) return null;
    return { ...base, protection: "plain", seed };
  } catch {
    return null;
  }
}

export function clearBackstopKey(store: KeyStore): void {
  store.removeItem(STORAGE_KEY);
}

// --- WebAuthn PRF ceremony (the untestable boundary) ------------------

/** Result of probing / running a PRF ceremony. */
export interface PrfResult {
  ok: boolean;
  /** 32-byte PRF secret when `ok`. */
  output?: Uint8Array;
}

/**
 * Run a passkey assertion carrying a PRF `eval` and return the secret. The
 * `challenge` is arbitrary when we only want PRF; in paranoid mode the signer
 * passes the auth digest so ONE ceremony yields both the P-256 signature and
 * this secret (see `prfFromAssertionResults`).
 *
 * Returns `{ ok: false }` when the platform/credential doesn't support PRF, so
 * callers can fall back to plaintext storage or a mnemonic path.
 */
export async function evalPrf(opts: {
  credentialId: Uint8Array;
  salt: Uint8Array;
  challenge?: Uint8Array;
  rpId?: string;
}): Promise<PrfResult> {
  const challenge = opts.challenge ?? crypto.getRandomValues(new Uint8Array(32));
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(challenge),
        rpId: opts.rpId ?? window.location.hostname,
        allowCredentials: [
          { id: opts.credentialId as unknown as Uint8Array<ArrayBuffer>, type: "public-key" },
        ],
        userVerification: "required",
        timeout: 60000,
        // PRF is a WebAuthn L3 extension not yet in the DOM lib types.
        extensions: { prf: { eval: { first: toBuf(opts.salt) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch {
    return { ok: false };
  }
  if (!assertion) return { ok: false };
  return prfFromAssertionResults(assertion);
}

/** Extract the PRF secret from an assertion produced by any ceremony whose
 *  `get` options included the `prf.eval.first` input. */
export function prfFromAssertionResults(assertion: PublicKeyCredential): PrfResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = assertion.getClientExtensionResults() as any;
  const first = ext?.prf?.results?.first as ArrayBuffer | undefined;
  if (!first) return { ok: false };
  const output = new Uint8Array(first);
  if (output.length < 32) return { ok: false };
  return { ok: true, output: output.slice(0, 32) };
}

/** The `prf.eval.first` input to add to a signing ceremony's `get` options so
 *  the same assertion also unlocks a passkey-protected seed. Returns null when
 *  the key isn't passkey-protected. */
export function prfEvalForKey(key: BackstopKey): { prf: { eval: { first: BufferSource } } } | null {
  if (key.protection !== "passkey" || !key.wrapped) return null;
  return { prf: { eval: { first: toBuf(key.wrapped.salt) } } };
}

/**
 * Return the plaintext seed for signing. For `plain` keys this is immediate.
 * For `passkey` keys: if `prfOutput` is supplied (from a paired signing
 * ceremony) it decrypts directly; otherwise it runs its own PRF ceremony
 * against the wrapping credential.
 *
 * Throws a user-facing error when a passkey-protected seed can't be unlocked
 * (e.g. the wrapping passkey is gone) — the recovery path is a mnemonic
 * restore.
 */
export async function unlockSeed(
  key: BackstopKey,
  opts: { prfOutput?: Uint8Array } = {},
): Promise<Uint8Array> {
  if (key.protection === "plain") {
    if (!key.seed) throw new Error("plain backstop key is missing its seed");
    return key.seed;
  }
  if (!key.wrapped) throw new Error("passkey-protected key is missing its wrapped seed");

  // Try a supplied PRF secret (from a paired signing ceremony) first; if it
  // doesn't decrypt — e.g. it came from a different credential than the seed
  // was wrapped against — fall back to a dedicated ceremony against the
  // wrapping credential rather than failing closed.
  if (opts.prfOutput) {
    try {
      return await unwrapSeed(key.wrapped, opts.prfOutput);
    } catch {
      // fall through to a dedicated ceremony below
    }
  }
  const prf = await evalPrf({ credentialId: key.wrapped.credentialId, salt: key.wrapped.salt });
  if (!prf.ok || !prf.output) {
    throw new Error(
      "Couldn't unlock the backstop key with your passkey. If your passkey is " +
        "unavailable, restore the key from its recovery phrase.",
    );
  }
  try {
    return await unwrapSeed(key.wrapped, prf.output);
  } catch {
    throw new Error("Couldn't decrypt the backstop key (wrong passkey or corrupted data).");
  }
}

/**
 * Encrypt an existing plain key's seed under a passkey and re-persist it as a
 * `passkey` record. Returns false (leaving the plain record untouched) when
 * the platform/credential can't produce a PRF secret, so the UI can fall back.
 */
export async function protectWithPasskey(
  key: BackstopKey,
  credentialId: Uint8Array,
  store: KeyStore,
): Promise<boolean> {
  if (!key.seed) throw new Error("protectWithPasskey needs a plaintext seed");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const prf = await evalPrf({ credentialId, salt });
  if (!prf.ok || !prf.output) return false;
  const wrapped = await wrapSeed(key.seed, prf.output, salt, credentialId);
  // Verify the ciphertext decrypts back to the exact seed BEFORE overwriting
  // the plaintext record — a bad wrap must never silently replace a good key.
  const roundTrip = await unwrapSeed(wrapped, prf.output);
  if (!bytesEqual(roundTrip, key.seed)) {
    throw new Error("Encryption self-check failed; leaving the key unprotected.");
  }
  saveProtectedKey(key.publicKey, wrapped, key.createdAt, store);
  // Best-effort scrub of the now-persisted-encrypted seed from this in-memory
  // copy (the page reloads from storage, dropping this object anyway).
  key.seed.fill(0);
  roundTrip.fill(0);
  return true;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toBuf(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}
