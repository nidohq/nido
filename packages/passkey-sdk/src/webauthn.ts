/**
 * The public key a new passkey enrolls with, read from its registration and
 * checked before anything deploys or enrolls it.
 *
 * A registration carries the key twice: the attested COSE key inside
 * `attestationObject.authData`, and (where the browser supports it) the
 * SubjectPublicKeyInfo from `response.getPublicKey()`. {@link parseRegistration}
 * reads the COSE key with a bounds-checked CBOR reader and requires:
 *
 * - an ES256 key: `kty` EC2 (2), `alg` ES256 (-7), `crv` P-256 (1), and
 *   32-byte `x` and `y`;
 * - a point on the P-256 curve;
 * - the attested credential id equal to the credential's `rawId`;
 * - when `getPublicKey()` returns a key, that key equal to the COSE key.
 *
 * Any failure throws {@link PasskeyRegistrationError}, so a key no signature
 * could satisfy is never deployed as an account signer or enrolled.
 *
 * The curve check and the ES256 COSE header check follow passkey-kit's
 * `isOnP256Curve` and `extractPublicKeyFromAttestation`
 * (https://github.com/stellar/passkey-kit, `src/utils.ts` at 66dff89, MIT,
 * Copyright (c) 2024 Tyler van der Hoeven; licence text in
 * `assertionVerify.ts`). The curve check here uses `@noble/curves`.
 */

import { p256 } from "@noble/curves/nist.js";
import type { PasskeyRegistration } from "./types.js";
import { base64url2buf } from "./encoding.js";

// Minimal WebAuthn type declarations so this module compiles without DOM lib.
// At runtime, these are the browser-native types.
interface WebAuthnAttestationResponse {
  getPublicKey?(): ArrayBuffer | null;
  attestationObject: ArrayBuffer;
}

interface WebAuthnCredential {
  rawId: ArrayBuffer;
  response: WebAuthnAttestationResponse;
}

/** A registration whose public key can't be read and checked. */
export class PasskeyRegistrationError extends Error {
  constructor(detail: string) {
    super(`This passkey's public key didn't pass its checks, so it wasn't used: ${detail}.`);
    this.name = "PasskeyRegistrationError";
  }
}

/** Whether `publicKey` is a 65-byte uncompressed (`0x04 || x || y`) point
 *  on the P-256 curve. */
export function isOnP256Curve(publicKey: Uint8Array): boolean {
  if (publicKey.byteLength !== 65 || publicKey[0] !== 0x04) return false;
  try {
    p256.Point.fromBytes(publicKey);
    return true;
  } catch {
    return false;
  }
}

/** `AlgorithmIdentifier { id-ecPublicKey, prime256v1 }` as DER. */
const P256_ALGORITHM_ID = new Uint8Array([
  0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48,
  0xce, 0x3d, 0x03, 0x01, 0x07,
]);

/**
 * The uncompressed P-256 key in a SubjectPublicKeyInfo: `SEQUENCE {
 * AlgorithmIdentifier { id-ecPublicKey, prime256v1 }, BIT STRING point }`,
 * exactly, with the point on the curve. A compressed point is accepted and
 * returned uncompressed.
 */
export function publicKeyFromSpki(spki: Uint8Array): Uint8Array {
  const header = 2 + P256_ALGORITHM_ID.byteLength;
  const pointLen = spki.byteLength - header - 3;
  if (
    (pointLen !== 65 && pointLen !== 33) ||
    spki[0] !== 0x30 ||
    spki[1] !== spki.byteLength - 2 ||
    !bytesEqual(spki.subarray(2, header), P256_ALGORITHM_ID) ||
    spki[header] !== 0x03 ||
    spki[header + 1] !== pointLen + 1 ||
    spki[header + 2] !== 0x00
  ) {
    throw new PasskeyRegistrationError("its SubjectPublicKeyInfo is not a P-256 key");
  }
  let point: InstanceType<typeof p256.Point>;
  try {
    point = p256.Point.fromBytes(spki.subarray(header + 3));
  } catch {
    throw new PasskeyRegistrationError("its SubjectPublicKeyInfo key is not on the P-256 curve");
  }
  return point.toBytes(false);
}

/**
 * The key `response.getPublicKey()` returns, checked (see
 * {@link publicKeyFromSpki}).
 */
export function extractPublicKey(response: WebAuthnAttestationResponse): Uint8Array {
  const spki = response.getPublicKey?.();
  if (!spki) throw new PasskeyRegistrationError("the browser returned no public key");
  return publicKeyFromSpki(new Uint8Array(spki));
}

/** The credential id and ES256 public key an attestation object attests. */
export interface AttestedCredential {
  credentialId: Uint8Array;
  /** 65-byte uncompressed P-256 point, on the curve. */
  publicKey: Uint8Array;
}

/** {@link parseAttestedCredential} of a base64url attestation object; the key. */
export function parseAttestationObject(attestationObjectB64u: string): Uint8Array {
  return parseAttestedCredential(base64url2buf(attestationObjectB64u)).publicKey;
}

/**
 * The attested credential in a CBOR attestation object
 * (`{fmt, attStmt, authData}`): its `authData` must carry attested
 * credential data whose COSE key is an on-curve ES256 P-256 key.
 */
export function parseAttestedCredential(attestationObject: Uint8Array): AttestedCredential {
  const top = new Cbor(attestationObject);
  let authData: Uint8Array | undefined;
  const entries = top.mapLength();
  for (let i = 0; i < entries; i++) {
    const key = top.peekMajor() === 3 ? top.text() : (top.skip(), undefined);
    if (key === "authData") {
      if (authData) throw new PasskeyRegistrationError("its attestation object repeats authData");
      authData = top.bytes();
    } else {
      top.skip();
    }
  }
  top.end();
  if (!authData) throw new PasskeyRegistrationError("its attestation object has no authData");
  return parseAuthData(authData);
}

const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

/** `rpIdHash(32) | flags(1) | signCount(4) | aaguid(16) | credIdLen(2) |
 *  credId | COSE key | [extensions]`. */
function parseAuthData(authData: Uint8Array): AttestedCredential {
  const fixed = 32 + 1 + 4 + 16 + 2;
  if (authData.byteLength < fixed) {
    throw new PasskeyRegistrationError("its authData is too short to attest a credential");
  }
  const flags = authData[32];
  if (!(flags & FLAG_AT)) {
    throw new PasskeyRegistrationError("its authData attests no credential");
  }
  const credIdLen = (authData[53] << 8) | authData[54];
  if (credIdLen === 0 || fixed + credIdLen > authData.byteLength) {
    throw new PasskeyRegistrationError("its attested credential id is out of bounds");
  }
  const credentialId = authData.slice(fixed, fixed + credIdLen);

  const cbor = new Cbor(authData, fixed + credIdLen);
  const publicKey = readEs256CoseKey(cbor);
  if (flags & FLAG_ED) cbor.skip(); // extensions map
  cbor.end();
  return { credentialId, publicKey };
}

/** COSE key labels and the ES256 / P-256 values Nido accepts. */
const COSE_KTY = 1;
const COSE_ALG = 3;
const COSE_CRV = -1;
const COSE_X = -2;
const COSE_Y = -3;

function readEs256CoseKey(cbor: Cbor): Uint8Array {
  const fields = new Map<number, number | Uint8Array>();
  const entries = cbor.mapLength();
  for (let i = 0; i < entries; i++) {
    const label = cbor.int();
    if (fields.has(label)) throw new PasskeyRegistrationError("its COSE key repeats a label");
    const major = cbor.peekMajor();
    if (major === 0 || major === 1) fields.set(label, cbor.int());
    else if (major === 2) fields.set(label, cbor.bytes());
    else cbor.skip();
  }
  const x = fields.get(COSE_X);
  const y = fields.get(COSE_Y);
  if (
    fields.get(COSE_KTY) !== 2 ||
    fields.get(COSE_ALG) !== -7 ||
    fields.get(COSE_CRV) !== 1 ||
    !(x instanceof Uint8Array) ||
    !(y instanceof Uint8Array) ||
    x.byteLength !== 32 ||
    y.byteLength !== 32
  ) {
    throw new PasskeyRegistrationError("its COSE key is not an ES256 P-256 key");
  }
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 33);
  if (!isOnP256Curve(publicKey)) {
    throw new PasskeyRegistrationError("its COSE key is not on the P-256 curve");
  }
  return publicKey;
}

/**
 * The checked public key and credential id of a WebAuthn registration
 * (`navigator.credentials.create()`). See the module comment for what is
 * checked; throws {@link PasskeyRegistrationError} on any failure.
 */
export function parseRegistration(credential: WebAuthnCredential): PasskeyRegistration {
  const credentialId = new Uint8Array(credential.rawId);
  const attested = parseAttestedCredential(new Uint8Array(credential.response.attestationObject));
  if (!bytesEqual(attested.credentialId, credentialId)) {
    throw new PasskeyRegistrationError("the attested credential id is not this credential's id");
  }

  // Not every WebView implements getPublicKey(); the COSE key stands alone
  // there. Where it answers, the two must agree.
  let spki: ArrayBuffer | null = null;
  try {
    spki = credential.response.getPublicKey?.() ?? null;
  } catch {
    spki = null;
  }
  if (spki && !bytesEqual(publicKeyFromSpki(new Uint8Array(spki)), attested.publicKey)) {
    throw new PasskeyRegistrationError("the browser's public key and the attested key differ");
  }

  return { publicKey: attested.publicKey, credentialId };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- Bounds-checked CBOR reader ------------------------------------------
//
// Just the definite-length subset attestation objects and COSE keys use:
// integers, byte and text strings, arrays, maps, and simple values. Every
// read is checked against the end of the buffer.

class Cbor {
  constructor(
    private readonly data: Uint8Array,
    private offset = 0,
  ) {}

  private fail(): never {
    throw new PasskeyRegistrationError("its attestation data is malformed");
  }

  private byte(): number {
    if (this.offset >= this.data.byteLength) this.fail();
    return this.data[this.offset++];
  }

  peekMajor(): number {
    if (this.offset >= this.data.byteLength) this.fail();
    return this.data[this.offset] >> 5;
  }

  /** The head's major type and argument. */
  private head(): { major: number; arg: number } {
    const initial = this.byte();
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (info < 24) return { major, arg: info };
    const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 0;
    if (width === 0) this.fail(); // 64-bit and indefinite lengths: not in attestations
    let arg = 0;
    for (let i = 0; i < width; i++) arg = arg * 256 + this.byte();
    return { major, arg };
  }

  private take(len: number): Uint8Array {
    if (len > this.data.byteLength - this.offset) this.fail();
    const out = this.data.slice(this.offset, this.offset + len);
    this.offset += len;
    return out;
  }

  mapLength(): number {
    const { major, arg } = this.head();
    if (major !== 5) this.fail();
    return arg;
  }

  int(): number {
    const { major, arg } = this.head();
    if (major === 0) return arg;
    if (major === 1) return -1 - arg;
    return this.fail();
  }

  bytes(): Uint8Array {
    const { major, arg } = this.head();
    if (major !== 2) this.fail();
    return this.take(arg);
  }

  text(): string {
    const { major, arg } = this.head();
    if (major !== 3) this.fail();
    return new TextDecoder().decode(this.take(arg));
  }

  /** Skip one item, however nested. */
  skip(depth = 0): void {
    if (depth > 16) this.fail();
    const { major, arg } = this.head();
    switch (major) {
      case 0:
      case 1:
      case 7:
        return;
      case 2:
      case 3:
        this.take(arg);
        return;
      case 4:
        for (let i = 0; i < arg; i++) this.skip(depth + 1);
        return;
      case 5:
        for (let i = 0; i < arg * 2; i++) this.skip(depth + 1);
        return;
      default:
        this.fail(); // tags
    }
  }

  /** Require that every byte was read. */
  end(): void {
    if (this.offset !== this.data.byteLength) this.fail();
  }
}
