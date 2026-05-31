import { parseRegistration } from './webauthn.js';
import { parseAssertionResponse } from './auth.js';
import { buf2base64url, base64url2buf } from './encoding.js';
import type { PasskeySignature } from './types.js';

/** A fresh P-256 keypair used as a scoped session key.
 *
 *  Generated via SubtleCrypto (not as a resident WebAuthn credential).
 *  Retained as an internal/test-only helper so the synthetic-assertion
 *  fixtures keep working — production flows should use
 *  `createSessionPasskey` instead, which puts the private key in the
 *  authenticator's secure element and never persists raw bytes.
 *
 *  The pubkey is SEC1-uncompressed (0x04 || X || Y, 65 bytes) so it slots
 *  directly into the smart account's `External(verifier, pubkey)` signer.
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

// ---------------------------------------------------------------------------
// WebAuthn-backed session passkey (production path)
// ---------------------------------------------------------------------------

// Minimal DOM shims so this file compiles without `lib: ["DOM"]`. At runtime
// these resolve to the browser-native interfaces. Mirrors the convention used
// in `webauthn.ts`.
declare const navigator: {
  credentials: {
    create(options: unknown): Promise<unknown | null>;
    get(options: unknown): Promise<unknown | null>;
  };
};
declare const window: {
  location: { hostname: string };
};
interface PublicKeyCredential {
  rawId: ArrayBuffer;
  response: unknown;
}
interface AuthenticatorAssertionResponse {
  authenticatorData: ArrayBuffer;
  clientDataJSON: ArrayBuffer;
  signature: ArrayBuffer;
}

/**
 * A WebAuthn-resident credential ("passkey") created at the dApp's origin
 * to act as a scoped session key. The private key never leaves the
 * authenticator's secure element — signing later goes through
 * `navigator.credentials.get`. No raw private bytes are persisted.
 *
 * `credentialId` is base64url-encoded so it round-trips through JSON.
 * `publicKey` is the same 65-byte SEC1 form used by the wallet's primary
 * passkey, so on-chain `External(verifier, pubkey)` doesn't care whether
 * the key came from a synthetic key or a real authenticator.
 */
export interface CreatedSessionPasskey {
  publicKey: Uint8Array;   // 65 bytes
  credentialId: string;    // base64url, the WebAuthn credential.rawId
}

interface CreateSessionPasskeyOptions {
  /** Hostname the credential will be bound to. Typically `window.location.hostname`. */
  rpId: string;
  /** Human-visible name shown in the OS passkey UI. */
  rpName: string;
  /** Display name for the credential (e.g. "session-key for CAAB…"). */
  userName?: string;
  /** Stable 1-64 byte user id. Random if omitted. */
  userId?: Uint8Array;
}

/**
 * Create a resident WebAuthn credential at the current origin to act as a
 * scoped session key for a dApp.
 */
export async function createSessionPasskey(
  opts: CreateSessionPasskeyOptions,
): Promise<CreatedSessionPasskey> {
  const userId = opts.userId ?? crypto.getRandomValues(new Uint8Array(16));
  // The challenge is irrelevant — we don't validate the attestation — but
  // some authenticators reject an empty challenge.
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge.buffer as ArrayBuffer,
      rp: { id: opts.rpId, name: opts.rpName },
      user: {
        id: userId.buffer as ArrayBuffer,
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
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Session passkey creation was cancelled.');

  const { publicKey, credentialId } = parseRegistration({
    rawId: credential.rawId,
    response: credential.response as unknown as {
      getPublicKey(): ArrayBuffer | null;
      attestationObject: ArrayBuffer;
    },
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
export async function signWithSessionPasskey(
  credentialId: string,
  payload: Uint8Array,
): Promise<PasskeySignature> {
  if (payload.byteLength !== 32) {
    throw new Error('signWithSessionPasskey: payload must be 32 bytes');
  }
  const challenge = new ArrayBuffer(32);
  new Uint8Array(challenge).set(payload);
  const credIdBuf = base64url2buf(credentialId).buffer as ArrayBuffer;

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [{ id: credIdBuf, type: 'public-key' }],
      userVerification: 'preferred',
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Session passkey signing was cancelled.');

  const response = assertion.response as AuthenticatorAssertionResponse;
  return parseAssertionResponse({
    authenticatorData: response.authenticatorData,
    clientDataJSON: response.clientDataJSON,
    signature: response.signature,
  });
}
