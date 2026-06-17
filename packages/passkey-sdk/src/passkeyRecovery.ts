import { p256 } from "@noble/curves/nist.js";
import { buf2hex, hex2buf } from "./encoding.js";

/**
 * Recover a passkey's P-256 public key from WebAuthn assertions alone.
 *
 * A WebAuthn assertion (`navigator.credentials.get()`) returns the credential
 * id and an ECDSA signature, but NOT the public key — only registration
 * (`create()`) exposes it. To finish setting up a smart account after the
 * registration response was lost (e.g. the user left mid-flow, or is on a
 * fresh device), we recover the key from the signature instead.
 *
 * ECDSA public-key recovery yields up to two candidate keys per signature (the
 * recovery bit is not transmitted, so we try both). A single assertion is
 * therefore ambiguous. Two assertions over different challenges each produce a
 * candidate set containing the true key; their intersection is the unique key.
 *
 * The recovered key is encoded as 65-byte SEC1 uncompressed (`0x04 || X || Y`),
 * byte-identical to what the factory hashes when deriving the account salt
 * (`salt = sha256(key)`), so the recomputed address matches the original.
 */

const SHA256 = "SHA-256";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(SHA256, data));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

/**
 * The 32-byte digest a WebAuthn authenticator actually signs:
 * `SHA-256(authenticatorData || SHA-256(clientDataJSON))`.
 */
export async function webauthnSignedDigest(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
): Promise<Uint8Array> {
  const cdHash = await sha256(clientDataJSON);
  return sha256(concat(authenticatorData, cdHash));
}

/**
 * Recover the candidate P-256 public keys (65-byte SEC1 uncompressed) from a
 * single assertion. `compactSig` is the 64-byte `r || s` form — convert a
 * browser's DER signature with {@link derToCompact} first.
 *
 * Returns up to two candidates; the true key is one of them.
 */
export async function recoverP256PublicKeys(
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  compactSig: Uint8Array,
): Promise<Uint8Array[]> {
  if (compactSig.byteLength !== 64) {
    throw new Error(
      `recoverP256PublicKeys: expected 64-byte compact signature, got ${compactSig.byteLength}`,
    );
  }
  const digest = await webauthnSignedDigest(authenticatorData, clientDataJSON);
  const sig = p256.Signature.fromBytes(compactSig, "compact");

  const candidates: Uint8Array[] = [];
  const seen = new Set<string>();
  for (const bit of [0, 1]) {
    let key: Uint8Array;
    try {
      key = sig.addRecoveryBit(bit).recoverPublicKey(digest).toBytes(false);
    } catch {
      continue; // recovery bit invalid for this signature
    }
    const hex = buf2hex(key);
    if (!seen.has(hex)) {
      seen.add(hex);
      candidates.push(key);
    }
  }
  return candidates;
}

/**
 * Intersect candidate sets from two or more assertions down to the single key
 * common to all of them. Returns the 65-byte key, or `null` if the
 * intersection is not exactly one key (need another assertion to disambiguate).
 */
export function intersectCandidates(sets: Uint8Array[][]): Uint8Array | null {
  if (sets.length === 0) return null;
  let common = sets[0].map(buf2hex);
  for (const set of sets.slice(1)) {
    const hexes = new Set(set.map(buf2hex));
    common = common.filter((h) => hexes.has(h));
  }
  const unique = Array.from(new Set(common));
  return unique.length === 1 ? hex2buf(unique[0]) : null;
}
