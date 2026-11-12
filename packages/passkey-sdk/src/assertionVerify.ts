/**
 * Check a fresh WebAuthn assertion in the browser, before anything trusts it.
 *
 * The on-chain verifier checks the signature, the challenge, the `type`, and
 * the UP/UV flags, but not the relying party or the origin (the browser's
 * job). When the wallet uses an assertion locally, as proof that the user
 * holds a passkey for this account rather than as a transaction signature,
 * nothing on chain runs, so this module checks all of it:
 *
 * - `clientDataJSON`: `type == "webauthn.get"`, the exact challenge, the
 *   page's origin, and not `crossOrigin`;
 * - `authenticatorData`: at least 37 bytes, `rpIdHash == sha256(rpId)`, and
 *   the User Present and User Verified flags (UV is always required, as on
 *   chain);
 * - the P-256 signature over `authenticatorData || sha256(clientDataJSON)`
 *   (`identifyAssertionSigner`, against the account's candidate keys).
 *
 * Every check returns a result rather than throwing, so a caller can say why
 * an assertion was refused.
 *
 * Adapted from passkey-kit's `src/kit/webauthn-verify.ts` (`verifyAssertion`),
 * https://github.com/stellar/passkey-kit at 66dff89:
 *
 *   MIT License
 *
 *   Copyright (c) 2024 Tyler van der Hoeven
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *
 *   The above copyright notice and this permission notice shall be included
 *   in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 *   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 *   USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { buf2base64url } from './encoding.js';
import type { PasskeySignature } from './types.js';

/** Which check refused an assertion. */
export type AssertionFailure =
  | 'client_data'
  | 'type'
  | 'challenge'
  | 'origin'
  | 'cross_origin'
  | 'authenticator_data'
  | 'rp_id'
  | 'user_presence'
  | 'user_verification';

export type AssertionCheck =
  | { ok: true }
  | { ok: false; reason: AssertionFailure; detail: string };

/** What a fresh assertion must carry. */
export interface AssertionExpectation {
  /** The challenge passed to `navigator.credentials.get()`. */
  challenge: Uint8Array;
  /** The relying party id the ceremony ran under (the page hostname). */
  rpId: string;
  /** The page origin, e.g. `https://<c-address>.nido.fyi`. */
  origin: string;
}

const AUTHENTICATOR_DATA_MIN_LEN = 37;
const RP_ID_HASH_LEN = 32;
const FLAGS_INDEX = 32;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;

function fail(reason: AssertionFailure, detail: string): AssertionCheck {
  return { ok: false, reason, detail };
}

/**
 * Every check except the signature: the client data and the authenticator
 * data. Use it with `identifyAssertionSigner`, which checks the signature
 * against the candidate keys.
 */
export async function checkAssertionContext(
  sig: PasskeySignature,
  expected: AssertionExpectation,
): Promise<AssertionCheck> {
  let clientData: unknown;
  try {
    clientData = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sig.clientDataJson));
  } catch {
    return fail('client_data', 'clientDataJSON is not valid UTF-8 JSON');
  }
  if (typeof clientData !== 'object' || clientData === null) {
    return fail('client_data', 'clientDataJSON is not an object');
  }
  const cd = clientData as { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  if (cd.type !== 'webauthn.get') {
    return fail('type', 'clientDataJSON.type must be "webauthn.get"');
  }
  if (cd.challenge !== buf2base64url(expected.challenge)) {
    return fail('challenge', 'clientDataJSON.challenge does not match the expected challenge');
  }
  if (cd.origin !== expected.origin) {
    return fail('origin', 'clientDataJSON.origin is not this page');
  }
  if (cd.crossOrigin === true) {
    return fail('cross_origin', 'the assertion was made in a cross-origin frame');
  }

  const authData = sig.authenticatorData;
  if (authData.byteLength < AUTHENTICATOR_DATA_MIN_LEN) {
    return fail('authenticator_data', 'authenticatorData is shorter than 37 bytes');
  }
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected.rpId)),
  );
  if (!bytesEqual(authData.subarray(0, RP_ID_HASH_LEN), rpIdHash)) {
    return fail('rp_id', 'authenticatorData.rpIdHash does not match the relying party id');
  }
  const flags = authData[FLAGS_INDEX];
  if ((flags & FLAG_USER_PRESENT) === 0) {
    return fail('user_presence', 'User Present flag is not set');
  }
  if ((flags & FLAG_USER_VERIFIED) === 0) {
    return fail('user_verification', 'User Verified flag is not set');
  }
  return { ok: true };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}
