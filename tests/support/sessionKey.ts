import type { Page } from '@playwright/test';
import { credentialFor } from './auth/seed';

/**
 * Seed the `SessionKeyMaterial` the dApp's in-page session-sign path reads via
 * `loadSessionKeyMaterial(account, target)`.
 *
 * Verified against `packages/passkey-sdk/src/storage.ts`:
 *   - localStorage key template: `nido.${account}.session-key.${target}`
 *     (the `sessionKey(account, target)` helper; `saveSessionKeyMaterial` writes
 *     to exactly this key).
 *   - JSON shape written by `saveSessionKeyMaterial`:
 *       { credentialId: string, publicKey: string (hex, 65 bytes), label?: string }
 *     `privateKey` is only emitted for the deprecated synthetic-key flow; the
 *     passkey-backed path never writes it, so we omit it.
 *
 * `credentialFor(seedHex, label)` reproduces the shim's deterministic session
 * credential — `credentialIdB64u` (base64url) and `publicKeyHex` (65-byte SEC1
 * uncompressed, `04 || x || y`). The shim's `navigator.credentials.get`
 * re-derives the private key from the credentialId it receives, so a `get`
 * with this credentialId signs with the SAME session key whose public half was
 * installed on chain at delegation time.
 *
 * Call AFTER navigating to the origin that runs the session path (the
 * status-message dApp origin — `loadSessionKeyMaterial` reads localStorage on
 * whatever origin the page lives on), then reload so the page picks it up.
 */
export async function seedSessionKey(
  page: Page,
  account: string,
  target: string,
  seedHex: string,
  label = 'session',
): Promise<{ credentialIdB64u: string; publicKeyHex: string }> {
  const cred = await credentialFor(seedHex, label);
  await page.evaluate(
    ([acc, tgt, cid, pk, lbl]) => {
      // Mirrors `sessionKey(account, target)` + `saveSessionKeyMaterial` shape.
      const key = `nido.${acc}.session-key.${tgt}`;
      localStorage.setItem(
        key,
        JSON.stringify({ credentialId: cid, publicKey: pk, label: lbl }),
      );
    },
    [account, target, cred.credentialIdB64u, cred.publicKeyHex, label] as const,
  );
  return cred;
}
