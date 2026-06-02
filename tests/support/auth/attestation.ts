/** Build authData: rpIdHash(32) | flags(1, AT|UV|UP) | signCount(4) |
 *  AAGUID(16) | credIdLen(2 BE) | credId | COSE key (77 bytes for P-256). */
function buildAuthData(credentialId: Uint8Array, point65: Uint8Array): Uint8Array {
  const x = point65.slice(1, 33);
  const y = point65.slice(33, 65);

  // COSE_Key: {1:2(EC2), 3:-7(ES256), -1:1(P-256), -2:x, -3:y}
  const cose = new Uint8Array([
    0xa5, // map(5)
    0x01, 0x02, // kty: EC2
    0x03, 0x26, // alg: ES256 (-7)
    0x20, 0x01, // crv (-1): P-256 (1)
    0x21, 0x58, 0x20, ...x, // x (-2): bstr(32)
    0x22, 0x58, 0x20, ...y, // y (-3): bstr(32)
  ]);

  const credLen = credentialId.length;
  const out = new Uint8Array(32 + 1 + 4 + 16 + 2 + credLen + cose.length);
  let o = 0;
  o += 32;                       // rpIdHash (zeros; SDK ignores value)
  out[o++] = 0x45;               // flags: UP(0x01)|UV(0x04)|AT(0x40)
  o += 4;                        // signCount (zeros)
  o += 16;                       // AAGUID (zeros)
  out[o++] = (credLen >> 8) & 0xff;
  out[o++] = credLen & 0xff;
  out.set(credentialId, o); o += credLen;
  out.set(cose, o);
  return out;
}

function textKey(s: string): number[] {
  const b = new TextEncoder().encode(s);
  return [0x60 | b.length, ...b]; // text string, len < 24
}

/** attestationObject CBOR: {fmt:"none", attStmt:{}, authData:<bytes>}. */
export function buildAttestationObject(
  credentialId: Uint8Array,
  point65: Uint8Array,
): Uint8Array {
  const authData = buildAuthData(credentialId, point65);
  if (authData.length >= 0x10000) throw new Error('authData too long');

  const head: number[] = [
    0xa3, // map(3)
    ...textKey('fmt'), ...textKey('none'),
    ...textKey('attStmt'), 0xa0, // empty map
    ...textKey('authData'),
  ];
  // authData byte string: len needs 1 or 2 length bytes.
  const lenBytes =
    authData.length < 24
      ? [0x40 | authData.length]
      : authData.length < 256
        ? [0x58, authData.length]
        : [0x59, (authData.length >> 8) & 0xff, authData.length & 0xff];

  const out = new Uint8Array(head.length + lenBytes.length + authData.length);
  out.set(head, 0);
  out.set(lenBytes, head.length);
  out.set(authData, head.length + lenBytes.length);
  return out;
}
