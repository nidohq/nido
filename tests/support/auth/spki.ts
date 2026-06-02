// DER SubjectPublicKeyInfo prefix for an uncompressed P-256 (prime256v1) key.
// SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING (00 || point) }
const P256_SPKI_PREFIX = new Uint8Array([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
]);

/** Wrap a 65-byte uncompressed point in DER SPKI (91 bytes total). */
export function buildSpki(point65: Uint8Array): Uint8Array {
  if (point65.length !== 65 || point65[0] !== 0x04) {
    throw new Error('buildSpki: expected 65-byte uncompressed point');
  }
  const out = new Uint8Array(P256_SPKI_PREFIX.length + 65);
  out.set(P256_SPKI_PREFIX, 0);
  out.set(point65, P256_SPKI_PREFIX.length);
  return out;
}
