import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { p256 } from '@noble/curves/nist.js';
import {
  PasskeyRegistrationError,
  isOnP256Curve,
  parseAttestedCredential,
  parseRegistration,
  publicKeyFromSpki,
} from './webauthn.js';
import { base64url2buf } from './encoding.js';

/** Real registrations; `_sources` says where each came from. */
const fixtures = JSON.parse(
  readFileSync(new URL('./testdata/registrations.json', import.meta.url), 'utf8'),
) as Record<'chrome' | 'apple' | 'android', { rawId: string; attestationObject: string; spki: string }>;

const buf = (b: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(b.byteLength);
  new Uint8Array(out).set(b);
  return out;
};

function credential(rawId: Uint8Array, attestationObject: Uint8Array, spki?: Uint8Array | null) {
  return {
    rawId: buf(rawId),
    response: {
      attestationObject: buf(attestationObject),
      ...(spki === undefined ? {} : { getPublicKey: () => (spki ? buf(spki) : null) }),
    },
  };
}

const SPKI_HEADER = Uint8Array.from(
  Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
);
const spkiOf = (point: Uint8Array) => Uint8Array.from([...SPKI_HEADER, ...point]);

/** A `fmt: "none"` attestation object for `credentialId`, with `cose` as
 *  its credential public key. */
function attestation(credentialId: Uint8Array, cose: number[], flags = 0x45): Uint8Array {
  const authData = [
    ...new Array(32).fill(0),
    flags,
    0, 0, 0, 0,
    ...new Array(16).fill(0),
    credentialId.length >> 8,
    credentialId.length & 0xff,
    ...credentialId,
    ...cose,
  ];
  const text = (s: string) => [0x60 | s.length, ...Buffer.from(s)];
  return Uint8Array.from([
    0xa3,
    ...text('fmt'), ...text('none'),
    ...text('attStmt'), 0xa0,
    ...text('authData'), 0x59, authData.length >> 8, authData.length & 0xff, ...authData,
  ]);
}

/** COSE_Key {1: kty, 3: alg, -1: crv, -2: x, -3: y}. */
function cose(point: Uint8Array, header = { kty: 0x02, alg: 0x26, crv: 0x01 }): number[] {
  return [
    0xa5,
    0x01, header.kty,
    0x03, header.alg,
    0x20, header.crv,
    0x21, 0x58, 0x20, ...point.slice(1, 33),
    0x22, 0x58, 0x20, ...point.slice(33, 65),
  ];
}

const newPoint = () => p256.getPublicKey(p256.utils.randomSecretKey(), false);
const CRED_ID = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);

describe('parseRegistration on real registrations', () => {
  for (const name of ['chrome', 'apple', 'android'] as const) {
    const f = fixtures[name];
    const rawId = base64url2buf(f.rawId);
    const ao = base64url2buf(f.attestationObject);
    const spki = base64url2buf(f.spki);

    it(`${name}: reads the attested key, which equals the SPKI key`, () => {
      const reg = parseRegistration(credential(rawId, ao, spki));
      expect(reg.credentialId).toEqual(rawId);
      expect(reg.publicKey).toEqual(publicKeyFromSpki(spki));
      expect(isOnP256Curve(reg.publicKey)).toBe(true);
    });

    it(`${name}: reads the attested key where the browser has no getPublicKey()`, () => {
      expect(parseRegistration(credential(rawId, ao)).publicKey).toEqual(publicKeyFromSpki(spki));
    });
  }
});

describe('parseRegistration refuses keys that fail their checks', () => {
  it('refuses an off-curve SPKI key', () => {
    const point = newPoint();
    const offCurve = point.slice();
    offCurve[64] ^= 0x01;
    expect(() => parseRegistration(credential(CRED_ID, attestation(CRED_ID, cose(point)), spkiOf(offCurve)))).toThrow(
      PasskeyRegistrationError,
    );
  });

  it('refuses an SPKI key that differs from the attested key', () => {
    const point = newPoint();
    expect(() =>
      parseRegistration(credential(CRED_ID, attestation(CRED_ID, cose(point)), spkiOf(newPoint()))),
    ).toThrow(/attested key differ/);
  });

  it("refuses an attested credential id that is not the credential's", () => {
    const point = newPoint();
    const other = Uint8Array.from([1, 1, 1, 1]);
    expect(() => parseRegistration(credential(CRED_ID, attestation(other, cose(point)), spkiOf(point)))).toThrow(
      /credential id/,
    );
  });

  it('refuses an off-curve attested key', () => {
    const offCurve = newPoint();
    offCurve[64] ^= 0x01;
    expect(() => parseRegistration(credential(CRED_ID, attestation(CRED_ID, cose(offCurve))))).toThrow(
      /not on the P-256 curve/,
    );
  });

  it.each([
    ['an RSA kty', { kty: 0x03, alg: 0x26, crv: 0x01 }],
    ['EdDSA', { kty: 0x02, alg: 0x27, crv: 0x01 }],
    ['the P-384 curve', { kty: 0x02, alg: 0x26, crv: 0x02 }],
  ])('refuses a COSE key with %s', (_, header) => {
    const point = newPoint();
    expect(() => parseRegistration(credential(CRED_ID, attestation(CRED_ID, cose(point, header))))).toThrow(
      /not an ES256 P-256 key/,
    );
  });

  it('refuses authData that attests no credential', () => {
    const point = newPoint();
    expect(() => parseRegistration(credential(CRED_ID, attestation(CRED_ID, cose(point), 0x05))))
      .toThrow(/attests no credential/);
  });

  it('refuses a truncated attestation object', () => {
    const ao = attestation(CRED_ID, cose(newPoint()));
    expect(() => parseAttestedCredential(ao.slice(0, ao.length - 10))).toThrow(PasskeyRegistrationError);
  });

  it('refuses trailing bytes after the COSE key', () => {
    const point = newPoint();
    expect(() => parseAttestedCredential(attestation(CRED_ID, [...cose(point), 0x00]))).toThrow(
      PasskeyRegistrationError,
    );
  });

  it('refuses an SPKI for another curve or algorithm', () => {
    const spki = spkiOf(newPoint());
    spki[20] ^= 0x01; // the curve OID
    expect(() => publicKeyFromSpki(spki)).toThrow(/not a P-256 key/);
  });

  it('refuses an SPKI carrying a compressed point', () => {
    const compressed = p256.getPublicKey(p256.utils.randomSecretKey(), true);
    const spki = Uint8Array.from([
      0x30, 0x39, ...SPKI_HEADER.slice(2, 23), 0x03, 0x22, 0x00, ...compressed,
    ]);
    expect(() => publicKeyFromSpki(spki)).toThrow(/not a P-256 key/);
  });
});

describe('isOnP256Curve', () => {
  it('accepts a real key and refuses a mangled one', () => {
    const point = newPoint();
    expect(isOnP256Curve(point)).toBe(true);
    const bad = point.slice();
    bad[40] ^= 0x01;
    expect(isOnP256Curve(bad)).toBe(false);
    expect(isOnP256Curve(point.slice(0, 64))).toBe(false);
    expect(isOnP256Curve(new Uint8Array(65))).toBe(false);
  });
});
