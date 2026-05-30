import { p256 } from '@noble/curves/nist.js';
export async function buildSyntheticAssertion(privateKeyD, payload32) {
    if (payload32.byteLength !== 32) {
        throw new Error('buildSyntheticAssertion: payload must be 32 bytes');
    }
    const challenge = bytesToB64u(payload32);
    const clientDataJSON = new TextEncoder().encode(`{"type":"webauthn.get","challenge":"${challenge}","origin":"https://example.com","crossOrigin":false}`);
    // authenticatorData: 32-byte rpIdHash (zero — verifier skips this check) +
    // 1 flags byte (UP|UV|BE|BS = 0x1D) + 4 zero counter bytes = 37 bytes.
    const authenticatorData = new Uint8Array(37);
    authenticatorData[32] = 0x1d;
    const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
    const msg = new Uint8Array(authenticatorData.byteLength + cdHash.byteLength);
    msg.set(authenticatorData, 0);
    msg.set(cdHash, authenticatorData.byteLength);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', msg));
    // RFC-6979 prehash sign with low-S enforcement.
    // @noble/curves v2 returns a 64-byte Uint8Array (r||s) directly. The
    // `prehash: false` is critical: the input IS already the message digest;
    // without it noble would hash again.
    const signature = p256.sign(digest, privateKeyD, { prehash: false, lowS: true });
    return { authenticatorData, clientDataJSON, signature };
}
function bytesToB64u(b) {
    let s = btoa(String.fromCharCode(...b));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
//# sourceMappingURL=syntheticAssertion.js.map