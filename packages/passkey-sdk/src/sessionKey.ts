/** A fresh P-256 keypair used as a scoped session key.
 *
 *  In v1 the key is generated via SubtleCrypto (not as a resident WebAuthn
 *  credential). The caller is expected to persist the private bytes via
 *  `saveSessionKeyMaterial` immediately. The pubkey is SEC1-uncompressed
 *  (0x04 || X || Y, 65 bytes) so it slots directly into the smart account's
 *  `External(verifier, pubkey)` signer.
 */
export interface GeneratedSessionKey {
  publicKey: Uint8Array;   // 65 bytes
  privateKey: Uint8Array;  // 32-byte raw scalar (d)
  credentialId: string;    // synthetic id used to namespace storage
}

export async function generateSessionKey(): Promise<GeneratedSessionKey> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  // X, Y, D are base64url-encoded 32-byte big-endian field elements.
  const x = b64uToBytes(jwk.x!);
  const y = b64uToBytes(jwk.y!);
  const d = b64uToBytes(jwk.d!);
  const publicKey = new Uint8Array(65);
  publicKey[0] = 0x04;
  publicKey.set(x, 1);
  publicKey.set(y, 33);

  const credentialId = 'sk-' + bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
  return { publicKey, privateKey: d, credentialId };
}

function b64uToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
