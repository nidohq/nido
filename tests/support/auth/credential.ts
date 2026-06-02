import { credentialIdForLabel, privateKeyForCredentialId, publicKeyFromPrivate } from './vault';
import { buildSpki } from './spki';
import { buildAttestationObject } from './attestation';
import { makeAssertion } from './assertion';
import { compactToDer } from './der';

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function b64u(u: Uint8Array): string {
  let s = btoa(String.fromCharCode(...u));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a registration PublicKeyCredential for a logical identity label. */
export async function makeCredential(seed: Uint8Array, label: string) {
  const credentialId = await credentialIdForLabel(seed, label);
  const d = await privateKeyForCredentialId(seed, credentialId);
  const pub = publicKeyFromPrivate(d);
  const spki = toArrayBuffer(buildSpki(pub));
  const attObj = toArrayBuffer(buildAttestationObject(credentialId, pub));
  const rawId = toArrayBuffer(credentialId);
  return {
    id: b64u(credentialId),
    rawId,
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    response: {
      getPublicKey: () => spki,
      getPublicKeyAlgorithm: () => -7,
      getAuthenticatorData: () => attObj,
      getTransports: () => ['internal'],
      attestationObject: attObj,
      clientDataJSON: toArrayBuffer(
        new TextEncoder().encode('{"type":"webauthn.create"}'),
      ),
    },
    getClientExtensionResults: () => ({}),
  };
}

/** Build an authentication PublicKeyCredential for a credentialId+challenge. */
export async function makeAssertionCredential(
  seed: Uint8Array,
  credentialId: Uint8Array,
  challenge32: Uint8Array,
) {
  const a = await makeAssertion(seed, credentialId, challenge32);
  return {
    id: b64u(credentialId),
    rawId: toArrayBuffer(credentialId),
    type: 'public-key' as const,
    authenticatorAttachment: 'platform' as const,
    response: {
      authenticatorData: toArrayBuffer(a.authenticatorData),
      clientDataJSON: toArrayBuffer(a.clientDataJSON),
      // DER-encoded (real authenticators return DER; app calls derToCompact).
      signature: toArrayBuffer(compactToDer(a.signature)),
      userHandle: null,
    },
    getClientExtensionResults: () => ({}),
  };
}
