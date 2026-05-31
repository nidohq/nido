import { parseRegistration } from './webauthn.js';
import { parseAssertionResponse } from './auth.js';
import { buf2base64url, base64url2buf } from './encoding.js';
export async function generateSessionKey() {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    // X, Y, D are base64url-encoded 32-byte big-endian field elements.
    const x = b64uToBytes(jwk.x);
    const y = b64uToBytes(jwk.y);
    const d = b64uToBytes(jwk.d);
    const publicKey = new Uint8Array(65);
    publicKey[0] = 0x04;
    publicKey.set(x, 1);
    publicKey.set(y, 33);
    const credentialId = 'sk-' + bytesToHex(crypto.getRandomValues(new Uint8Array(8)));
    return { publicKey, privateKey: d, credentialId };
}
function b64uToBytes(s) {
    const pad = (4 - (s.length % 4)) % 4;
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        u[i] = bin.charCodeAt(i);
    return u;
}
function bytesToHex(b) {
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
/**
 * Create a resident WebAuthn credential at the current origin to act as a
 * scoped session key for a dApp.
 */
export async function createSessionPasskey(opts) {
    const userId = opts.userId ?? crypto.getRandomValues(new Uint8Array(16));
    // The challenge is irrelevant — we don't validate the attestation — but
    // some authenticators reject an empty challenge.
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = (await navigator.credentials.create({
        publicKey: {
            challenge: challenge.buffer,
            rp: { id: opts.rpId, name: opts.rpName },
            user: {
                id: userId.buffer,
                name: opts.userName ?? 'session',
                displayName: opts.userName ?? 'Session key',
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256 / P-256
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
            timeout: 60000,
        },
    }));
    if (!credential)
        throw new Error('Session passkey creation was cancelled.');
    const { publicKey, credentialId } = parseRegistration({
        rawId: credential.rawId,
        response: credential.response,
    });
    return {
        publicKey,
        credentialId: buf2base64url(credentialId),
    };
}
/**
 * Run the in-page WebAuthn `get` ceremony for a stored session passkey
 * and return the parsed assertion in the shape consumed by
 * `injectPasskeySignature`.
 *
 * `credentialId` is the base64url form stored in `SessionKeyMaterial`.
 * `payload` is the 32-byte auth-hash the user is being asked to sign.
 */
export async function signWithSessionPasskey(credentialId, payload) {
    if (payload.byteLength !== 32) {
        throw new Error('signWithSessionPasskey: payload must be 32 bytes');
    }
    const challenge = new ArrayBuffer(32);
    new Uint8Array(challenge).set(payload);
    const credIdBuf = base64url2buf(credentialId).buffer;
    const assertion = (await navigator.credentials.get({
        publicKey: {
            challenge,
            rpId: window.location.hostname,
            allowCredentials: [{ id: credIdBuf, type: 'public-key' }],
            userVerification: 'preferred',
            timeout: 60000,
        },
    }));
    if (!assertion)
        throw new Error('Session passkey signing was cancelled.');
    const response = assertion.response;
    return parseAssertionResponse({
        authenticatorData: response.authenticatorData,
        clientDataJSON: response.clientDataJSON,
        signature: response.signature,
    });
}
//# sourceMappingURL=sessionKey.js.map