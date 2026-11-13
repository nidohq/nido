import { Buffer } from 'buffer';

export const bytes = value => new Uint8Array(value);
export const b64 = value => Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64 = value => new Uint8Array(Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
export const utf8 = value => new TextEncoder().encode(value);
export const concat = (...parts) => new Uint8Array(Buffer.concat(parts.map(p => Buffer.from(p))));
export const sha256 = async value => bytes(await crypto.subtle.digest('SHA-256', value));
export const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

// WebAuthn carries ASN.1 DER, WebCrypto verifies fixed-width r || s.
// Reject non-canonical, negative, zero, oversized and out-of-range integers.
export function derToCompact(input, lowS = false) {
  const d = bytes(input);
  if (d.length < 8 || d[0] !== 0x30 || d[1] !== d.length - 2 || d[1] >= 128) throw Error('Invalid DER sequence');
  let pos = 2;
  const integer = () => {
    if (d[pos++] !== 2) throw Error('Invalid DER integer');
    const n = d[pos++];
    if (n < 1 || n > 33 || pos + n > d.length) throw Error('Invalid DER length');
    let v = d.slice(pos, pos + n); pos += n;
    if (v[0] & 0x80 || (n > 1 && v[0] === 0 && !(v[1] & 0x80))) throw Error('Non-canonical DER integer');
    if (v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw Error('Oversized P-256 integer');
    const num = BigInt('0x' + (Buffer.from(v).toString('hex') || '0'));
    if (num <= 0n || num >= order) throw Error('P-256 integer out of range');
    return num;
  };
  const r = integer(); let s = integer();
  if (pos !== d.length) throw Error('Trailing DER data');
  if (lowS && s > order / 2n) s = order - s;
  return bytes(Buffer.from(r.toString(16).padStart(64, '0') + s.toString(16).padStart(64, '0'), 'hex'));
}

export function packAssertion(credential) {
  return {
    credentialId: credential.id,
    authenticatorData: bytes(credential.response.authenticatorData),
    clientDataJSON: bytes(credential.response.clientDataJSON),
    signature: bytes(credential.response.signature),
  };
}

export async function verifyAssertion(assertion, registration, challenge) {
  if (assertion.credentialId !== registration.credentialId) throw Error('Wrong passkey credential');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(assertion.clientDataJSON));
  if (data.type !== 'webauthn.get' || data.challenge !== b64(challenge)) throw Error('Wrong passkey challenge');
  if (data.origin !== registration.origin || data.crossOrigin === true || data.topOrigin !== undefined) throw Error('Wrong passkey origin');
  const auth = assertion.authenticatorData;
  if (auth.length < 37 || !equal(auth.slice(0, 32), await sha256(utf8(registration.rpId)))) throw Error('Wrong RP ID');
  const flags = auth[32];
  if (!(flags & 1) || !(flags & 4)) throw Error('User presence and verification required');
  if ((flags & 16) && !(flags & 8)) throw Error('Invalid backup flags');
  const key = await crypto.subtle.importKey('spki', registration.spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const message = concat(auth, await sha256(assertion.clientDataJSON));
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToCompact(assertion.signature), message);
  if (!ok) throw Error('Invalid passkey signature');
  // No signing-counter claim: synced passkeys may legitimately report zero.
  return bytes(await crypto.subtle.exportKey('raw', key));
}

export async function registerPasskey(extensions) {
  const rpId = location.hostname;
  const result = await navigator.credentials.create({ publicKey: {
    rp: { id: rpId, name: 'Nido fee-payer lab (demo)' },
    user: { id: crypto.getRandomValues(new Uint8Array(32)), name: 'fee-lab-demo', displayName: 'Nido demo wallet' },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    attestation: 'none', timeout: 60000, extensions,
  } });
  if (!result) throw Error('Passkey registration cancelled');
  const spki = result.response.getPublicKey?.();
  if (!spki || result.response.getPublicKeyAlgorithm() !== -7) throw Error('This demo requires P-256 getPublicKey support');
  // Local demo enrollment pins this key to fixture C. This is not on-chain registration.
  return { credentialId: result.id, spki: bytes(spki), origin: location.origin, rpId };
}

export async function requestAssertion(registration, challenge, extensions) {
  const result = await navigator.credentials.get({ publicKey: {
    rpId: registration.rpId, challenge,
    allowCredentials: [{ type: 'public-key', id: unb64(registration.credentialId) }],
    userVerification: 'required', timeout: 60000, extensions,
  } });
  if (!result) throw Error('Passkey signing cancelled');
  const assertion = packAssertion(result);
  const prf = result.getClientExtensionResults().prf?.results?.first;
  if (prf) assertion.prf = bytes(prf);
  return assertion;
}
