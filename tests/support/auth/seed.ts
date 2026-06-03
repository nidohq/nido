import type { Page } from '@playwright/test';
import { credentialIdForLabel, privateKeyForCredentialId, publicKeyFromPrivate } from './vault';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function b64u(u: Uint8Array): string {
  return Buffer.from(u).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function hex(u: Uint8Array): string {
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The shim's deterministic credential for `label` (same derivation the shim
 *  uses), in the storage encodings the app expects:
 *  credentialId → base64url, publicKey → hex. */
export async function credentialFor(seedHex: string, label: string) {
  const seed = hexToBytes(seedHex);
  const credId = await credentialIdForLabel(seed, label);
  const pub = publicKeyFromPrivate(await privateKeyForCredentialId(seed, credId));
  return { credentialIdB64u: b64u(credId), publicKeyHex: hex(pub) };
}

/** Seed the primary-passkey credential into an account's localStorage on the
 *  current page's origin (so signing flows find it via loadCredential, without
 *  running the registration UI first). Call after navigating to the account
 *  origin. Storage keys match packages/passkey-sdk/src/storage.ts. */
export async function seedCredential(page: Page, account: string, seedHex: string, label = 'default') {
  const cred = await credentialFor(seedHex, label);
  await page.evaluate(
    ([acc, cid, pk]) => {
      localStorage.setItem(`passkey:${acc}:credentialId`, cid);
      localStorage.setItem(`passkey:${acc}:publicKey`, pk);
    },
    [account, cred.credentialIdB64u, cred.publicKeyHex] as const,
  );
}
