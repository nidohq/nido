import { buf2hex } from "@nidohq/passkey-sdk";

/**
 * A fresh, random 32-byte setup salt, hex-encoded — the same shape
 * `createNido()` generates for the normal "Get started" button, just
 * triggered by landing on `/demo/start` instead. Never reused, never sent
 * anywhere: the caller keeps it in memory only long enough to predict the
 * account's address and build the redirect into `new-account/`.
 */
export function generateSaltHex(): string {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return buf2hex(salt);
}
