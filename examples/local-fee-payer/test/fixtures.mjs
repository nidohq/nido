import { Buffer } from 'buffer';
import { b64, concat, sha256, utf8 } from '../src/webauthn.mjs';

export async function fakeAuthenticator() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const registration = { credentialId: b64(crypto.getRandomValues(new Uint8Array(24))), spki: new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)), origin: 'http://localhost:5198', rpId: 'localhost' };
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  async function assertion(challenge, overrides = {}) {
    const authenticatorData = concat(await sha256(utf8(overrides.rpId ?? registration.rpId)), new Uint8Array([overrides.flags ?? 5, 0, 0, 0, 0]));
    const clientDataJSON = utf8(JSON.stringify({ type: 'webauthn.get', challenge: b64(challenge), origin: registration.origin, crossOrigin: false, ...overrides.client }));
    const compact = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, concat(authenticatorData, await sha256(clientDataJSON))));
    const integer = part => {
      let arr = [...part]; while (arr.length > 1 && arr[0] === 0) arr.shift();
      if (arr[0] & 128) arr.unshift(0);
      return [2, arr.length, ...arr];
    };
    const value = [...integer(compact.slice(0, 32)), ...integer(compact.slice(32))];
    return { credentialId: registration.credentialId, authenticatorData, clientDataJSON, signature: new Uint8Array([48, value.length, ...value]) };
  }
  return { registration, publicKey, assertion };
}
