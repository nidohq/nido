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
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    credentialId: string;
}
export declare function generateSessionKey(): Promise<GeneratedSessionKey>;
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
    publicKey: Uint8Array;
    credentialId: string;
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
export declare function createSessionPasskey(opts: CreateSessionPasskeyOptions): Promise<CreatedSessionPasskey>;
/**
 * Run the in-page WebAuthn `get` ceremony for a stored session passkey
 * and return the parsed assertion in the shape consumed by
 * `injectPasskeySignature`.
 *
 * `credentialId` is the base64url form stored in `SessionKeyMaterial`.
 * `payload` is the 32-byte auth-hash the user is being asked to sign.
 */
export declare function signWithSessionPasskey(credentialId: string, payload: Uint8Array): Promise<PasskeySignature>;
export {};
//# sourceMappingURL=sessionKey.d.ts.map