/** Encode a 64-byte compact (r‖s) ECDSA signature as ASN.1 DER — the form a
 *  real authenticator returns. The app calls derToCompact() on
 *  response.signature, which throws unless the first byte is 0x30. P-256 DER
 *  is always < 128 bytes, so single-byte lengths suffice. */
export function compactToDer(rs: Uint8Array): Uint8Array {
  if (rs.length !== 64) throw new Error('compactToDer: expected 64-byte r||s');
  const derInt = (int: Uint8Array): number[] => {
    let i = 0;
    while (i < int.length - 1 && int[i] === 0) i++; // strip leading zeros
    let bytes = Array.from(int.slice(i));
    if (bytes[0] & 0x80) bytes = [0x00, ...bytes]; // keep positive
    return [0x02, bytes.length, ...bytes];
  };
  const body = [...derInt(rs.slice(0, 32)), ...derInt(rs.slice(32, 64))];
  return new Uint8Array([0x30, body.length, ...body]);
}
